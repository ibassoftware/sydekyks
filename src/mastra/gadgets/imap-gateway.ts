import { createHash } from 'node:crypto'
import { ImapFlow } from 'imapflow'
import type {
  ImapCredentials,
  ImapPublicStatus,
  InboundEmailRecord,
  MissionRecord
} from '../domain/schemas'
import { appStore } from '../lib/app-store'
import { dispatchEmailAutomationSpecs } from '../automations/spec-service'
import {
  ingestInboundEmail,
  recordInboundEmailFailure,
  syncInboundEmailForLedgerMission
} from '../sydekyks/ledger/inbound-email'

const maxMessageBytes = 35 * 1024 * 1024

interface SyncCursor {
  uidValidity: string
  lastUid: number
}

export interface ImapSyncResult {
  processed: number
  duplicates: number
  failed: number
}

const disconnectedStatus = (): ImapPublicStatus => ({
  configured: false,
  connected: false,
  syncing: false,
  label: 'IMAP not connected'
})

const publicStatusFor = (
  credentials: ImapCredentials,
  update: Partial<ImapPublicStatus> = {}
): ImapPublicStatus => ({
  configured: true,
  connected: true,
  syncing: false,
  label: credentials.username,
  host: credentials.host,
  port: credentials.port,
  secure: credentials.secure,
  username: credentials.username,
  mailbox: credentials.mailbox,
  pollIntervalMinutes: credentials.pollIntervalMinutes,
  processedMailbox: credentials.processedMailbox,
  ...update
})

class ImapGadget {
  private credentials?: ImapCredentials
  private status: ImapPublicStatus = disconnectedStatus()
  private poller?: NodeJS.Timeout
  private syncing = false

  async initialize(): Promise<void> {
    const saved = await appStore.getImapStatus()
    if (!saved?.configured) return
    this.status = {
      ...saved,
      connected: false,
      syncing: false,
      label: saved.username ? `${saved.username} · locked` : 'IMAP credentials locked'
    }
  }

  getStatus(): ImapPublicStatus {
    return { ...this.status }
  }

  async setPollInterval(pollIntervalMinutes: number): Promise<ImapPublicStatus> {
    if (!this.credentials || !this.status.configured) {
      throw new Error('Connect the Email inbox Gadget before changing how often it checks for mail')
    }
    this.credentials = { ...this.credentials, pollIntervalMinutes }
    this.status = { ...this.status, pollIntervalMinutes }
    await appStore.saveImapStatus(this.status)
    this.schedule()
    return this.getStatus()
  }

  private client(credentials = this.credentials): ImapFlow {
    if (!credentials) throw new Error('Connect the IMAP Gadget before syncing email')
    return new ImapFlow({
      host: credentials.host,
      port: credentials.port,
      secure: credentials.secure,
      auth: { user: credentials.username, pass: credentials.password },
      logger: false,
      connectionTimeout: 20_000,
      greetingTimeout: 12_000,
      socketTimeout: 60_000,
      maxLiteralSize: maxMessageBytes + 1024
    })
  }

  private cursorKey(credentials: ImapCredentials): string {
    const account = createHash('sha256')
      .update(`${credentials.host}\0${credentials.username}\0${credentials.mailbox}`)
      .digest('hex')
      .slice(0, 24)
    return `imap.cursor.${account}`
  }

  private schedule(): void {
    if (this.poller) clearInterval(this.poller)
    if (!this.credentials) return
    this.poller = setInterval(
      () => void this.syncNow().catch(() => undefined),
      this.credentials.pollIntervalMinutes * 60_000
    )
    this.poller.unref()
  }

  async connect(credentials: ImapCredentials): Promise<ImapPublicStatus> {
    const client = this.client(credentials)
    try {
      await client.connect()
      const lock = await client.getMailboxLock(credentials.mailbox, {
        readOnly: true,
        acquireTimeout: 10_000
      })
      lock.release()
      this.credentials = credentials
      this.status = publicStatusFor(credentials, {
        connectedAt: new Date().toISOString(),
        lastSyncedAt: this.status.lastSyncedAt
      })
      await appStore.saveImapStatus(this.status)
      this.schedule()
      return this.getStatus()
    } finally {
      if (client.usable) await client.logout().catch(() => client.close())
      else client.close()
    }
  }

  async disconnect(): Promise<ImapPublicStatus> {
    if (this.poller) clearInterval(this.poller)
    this.poller = undefined
    this.credentials = undefined
    this.status = disconnectedStatus()
    await appStore.saveImapStatus(this.status)
    return this.getStatus()
  }

  async syncNow(): Promise<ImapSyncResult> {
    const credentials = this.credentials
    if (!credentials) throw new Error('Connect the IMAP Gadget before syncing email')
    if (this.syncing) throw new Error('The IMAP Gadget is already syncing')
    this.syncing = true
    this.status = { ...this.status, syncing: true, lastError: undefined }
    await appStore.saveImapStatus(this.status)

    const result: ImapSyncResult = { processed: 0, duplicates: 0, failed: 0 }
    const client = this.client(credentials)
    try {
      await client.connect()
      const lock = await client.getMailboxLock(credentials.mailbox, {
        readOnly: false,
        acquireTimeout: 10_000
      })
      const completedEmails: InboundEmailRecord[] = []
      try {
        if (!client.mailbox) throw new Error(`Mailbox ${credentials.mailbox} could not be opened`)
        const uidValidity = client.mailbox.uidValidity.toString()
        const cursorKey = this.cursorKey(credentials)
        const savedCursor = await appStore.getSetting<SyncCursor>(cursorKey)
        let lastUid = savedCursor?.uidValidity === uidValidity ? savedCursor.lastUid : 0
        const matches = await client.search({ uid: `${Math.max(1, lastUid + 1)}:*` }, { uid: true })
        const uids = (matches || [])
          .filter((uid) => uid > lastUid)
          .sort((a, b) => a - b)
          .slice(0, 25)

        for (const uid of uids) {
          const metadata = await client.fetchOne(
            uid,
            { uid: true, size: true, envelope: true, internalDate: true },
            { uid: true }
          )
          try {
            if (!metadata) throw new Error('The IMAP message disappeared while syncing')
            if ((metadata.size ?? 0) > maxMessageBytes) {
              await recordInboundEmailFailure({
                sourceHash: `imap:${credentials.host}:${uidValidity}:${uid}`,
                messageId: metadata.envelope?.messageId,
                mailbox: credentials.mailbox,
                uid,
                fromAddress: metadata.envelope?.from?.[0]?.address ?? 'unknown',
                fromName: metadata.envelope?.from?.[0]?.name,
                subject: metadata.envelope?.subject ?? 'Oversized inbound email',
                receivedAt: new Date(metadata.internalDate ?? Date.now()).toISOString(),
                error: 'This email exceeds the 35 MB local ingestion limit.'
              })
              result.failed += 1
            } else {
              const message = await client.fetchOne(uid, { source: true }, { uid: true })
              if (message === false || !message.source) {
                throw new Error('The IMAP server did not return the message body')
              }
              const ingested = await ingestInboundEmail({
                source: message.source,
                mailbox: credentials.mailbox,
                uid
              })
              if (ingested.duplicate) result.duplicates += 1
              else result.processed += 1
              if (!ingested.duplicate) await dispatchEmailAutomationSpecs(ingested.email)
              if (!ingested.duplicate && ingested.email.status === 'completed') {
                completedEmails.push(ingested.email)
              }
              await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true, silent: true })
            }
          } catch (error) {
            result.failed += 1
            const safeMetadata = metadata === false ? undefined : metadata
            await recordInboundEmailFailure({
              sourceHash: `imap:${credentials.host}:${uidValidity}:${uid}`,
              messageId: safeMetadata?.envelope?.messageId,
              mailbox: credentials.mailbox,
              uid,
              fromAddress: safeMetadata?.envelope?.from?.[0]?.address ?? 'unknown',
              fromName: safeMetadata?.envelope?.from?.[0]?.name,
              subject: safeMetadata?.envelope?.subject ?? 'Unreadable inbound email',
              receivedAt: new Date(safeMetadata?.internalDate ?? Date.now()).toISOString(),
              error: error instanceof Error ? error.message : 'Email ingestion failed'
            })
          }
          lastUid = uid
          await appStore.setSetting(cursorKey, { uidValidity, lastUid } satisfies SyncCursor)
        }
      } finally {
        lock.release()
      }
      for (const email of completedEmails) await this.moveProcessed(email)
      this.status = publicStatusFor(credentials, {
        connectedAt: this.status.connectedAt,
        lastSyncedAt: new Date().toISOString()
      })
      return result
    } catch (error) {
      this.status = publicStatusFor(credentials, {
        connected: false,
        connectedAt: this.status.connectedAt,
        lastSyncedAt: this.status.lastSyncedAt,
        lastError: error instanceof Error ? error.message : 'IMAP sync failed'
      })
      throw error
    } finally {
      this.syncing = false
      this.status = { ...this.status, syncing: false }
      await appStore.saveImapStatus(this.status)
      if (client.usable) await client.logout().catch(() => client.close())
      else client.close()
    }
  }

  async reconcileMission(mission: MissionRecord): Promise<InboundEmailRecord | undefined> {
    const email = await syncInboundEmailForLedgerMission(mission)
    if (email && mission.status === 'completed') await this.moveProcessed(email)
    return email
  }

  private async moveProcessed(email: InboundEmailRecord): Promise<void> {
    const credentials = this.credentials
    if (!credentials || email.uid === undefined || email.mailbox !== credentials.mailbox) return
    const client = this.client(credentials)
    try {
      await client.connect()
      await client.mailboxCreate(credentials.processedMailbox)
      const lock = await client.getMailboxLock(email.mailbox, { readOnly: false })
      try {
        await client.messageMove(email.uid, credentials.processedMailbox, { uid: true })
      } finally {
        lock.release()
      }
    } catch (error) {
      await appStore.updateInboundEmail(email.id, {
        error: `Ledger completed, but the email could not be moved: ${error instanceof Error ? error.message : 'unknown IMAP error'}`
      })
    } finally {
      if (client.usable) await client.logout().catch(() => client.close())
      else client.close()
    }
  }
}

export const imapGadget = new ImapGadget()
export const imapGadgetReady = imapGadget.initialize()
