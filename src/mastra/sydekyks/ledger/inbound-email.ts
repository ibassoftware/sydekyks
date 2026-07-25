import { readFile } from 'node:fs/promises'
import type { InboundEmailRecord, LedgerBillInput, MissionRecord } from '../../domain/schemas'
import { ledgerBillInputSchema } from '../../domain/schemas'
import { appStore } from '../../lib/app-store'
import { parseInboundEmail } from '../../services/inbound-email-parser'
import { parseDocument, requiredBillFields } from '../../services/document-parser'
import { getInboundReviewPolicy } from '../registry'
import { analyzeBillDocument } from './intelligence-service'
import { startLedgerMission } from './service'

export interface InboundEmailSource {
  source: Buffer
  mailbox: string
  uid?: number
}

export interface IngestResult {
  email: InboundEmailRecord
  duplicate: boolean
}

export interface InboundEmailFailureInput {
  sourceHash: string
  messageId?: string
  mailbox: string
  uid?: number
  fromAddress: string
  fromName?: string
  subject: string
  receivedAt: string
  error: string
}

const automaticLedgerBill = async (
  email: InboundEmailRecord
): Promise<LedgerBillInput | undefined> => {
  if (!email.intelligence?.isBill || email.intelligence.documentType !== 'vendor_bill') {
    return undefined
  }
  const policy = await getInboundReviewPolicy('ledger')
  if (!policy || policy.reviewMode === 'always' || email.missingFields.length > 0) return undefined

  const parsed = ledgerBillInputSchema.safeParse({
    ...email.extracted,
    confirmWrite: true
  })
  if (!parsed.success) return undefined
  if (policy.reviewMode === 'automatic') return parsed.data

  const uncertainField = requiredBillFields.some(
    (field) => (email.intelligence?.fieldConfidence[field] ?? 0) < policy.confidenceThreshold
  )
  if (
    email.intelligence.confidence < policy.confidenceThreshold ||
    uncertainField ||
    email.intelligence.warnings.length > 0
  ) {
    return undefined
  }
  return parsed.data
}

const maybeAutoHandoffToLedger = async (
  email: InboundEmailRecord
): Promise<{ email: InboundEmailRecord; mission: MissionRecord } | undefined> => {
  const bill = await automaticLedgerBill(email)
  if (!bill) return undefined
  if (email.reviewMissionId) {
    await appStore.updateMission(email.reviewMissionId, {
      status: 'running',
      summary: 'Ledger inbound policy accepted the complete bill. Starting automatically.'
    })
  }
  return handoffInboundEmailToLedger(email.id, bill, { automatic: true })
}

export const recordInboundEmailFailure = async (
  input: InboundEmailFailureInput
): Promise<InboundEmailRecord> => {
  const existing = await appStore.findInboundEmail(input.messageId, input.sourceHash)
  if (existing) return existing
  const email = await appStore.createInboundEmail({
    ...input,
    sourceType: 'email',
    status: 'failed',
    attachments: [],
    extracted: {},
    missingFields: [
      'vendorName',
      'invoiceNumber',
      'invoiceDate',
      'currency',
      'untaxedAmount',
      'taxAmount',
      'totalAmount',
      'description'
    ]
  })
  const mission = await appStore.createMission({
    kind: 'email.inbound',
    sydekyk: 'Ledger',
    title: `Needs attention · ${email.subject}`,
    summary: input.error,
    status: 'needs_attention',
    payload: { emailId: email.id, fromAddress: email.fromAddress, subject: email.subject }
  })
  await appStore.updateInboundEmail(email.id, { reviewMissionId: mission.id })
  return (await appStore.getInboundEmail(email.id)) as InboundEmailRecord
}

export const ingestParsedLedgerDocument = async (
  parsed: Awaited<ReturnType<typeof parseInboundEmail>>,
  input:
    | { mailbox: string; uid?: number; sourceType: 'email' }
    | { mailbox: string; uid?: number; sourceType: 'chat'; chatSessionId: string },
  options: { allowAutomaticHandoff?: boolean } = {}
): Promise<IngestResult> => {
  const sourceLabel = input.sourceType === 'chat' ? 'document' : 'email'
  const billLabel = input.sourceType === 'chat' ? 'Chat bill' : 'Inbound bill'
  const exactDuplicate = await appStore.findInboundEmail(parsed.messageId, parsed.sourceHash)
  const attachmentDuplicate = await appStore.findInboundEmailByAttachmentHashes(
    parsed.attachments.map((attachment) => attachment.sha256)
  )
  const duplicate = exactDuplicate ?? attachmentDuplicate
  if (duplicate) {
    return {
      email:
        input.sourceType === 'chat'
          ? await appStore.linkInboundEmailToChatSession(duplicate.id, input.chatSessionId)
          : duplicate,
      duplicate: true
    }
  }

  let analyzed: Awaited<ReturnType<typeof analyzeBillDocument>>
  try {
    analyzed = await analyzeBillDocument({
      fromAddress: parsed.fromAddress,
      subject: parsed.subject,
      filenames: parsed.attachments.map((attachment) => attachment.filename),
      text: parsed.analysisText,
      parserHints: parsed.extracted,
      media: parsed.media
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI bill analysis failed'
    const email = await appStore.createInboundEmail({
      sourceType: input.sourceType,
      chatSessionIds: input.sourceType === 'chat' ? [input.chatSessionId] : [],
      messageId: parsed.messageId,
      sourceHash: parsed.sourceHash,
      sourcePath: parsed.sourcePath,
      mailbox: input.mailbox,
      uid: input.uid,
      fromAddress: parsed.fromAddress,
      fromName: parsed.fromName,
      subject: parsed.subject,
      status: 'ai_required',
      attachments: parsed.attachments,
      extracted: {},
      missingFields: [...requiredBillFields],
      error: message,
      receivedAt: parsed.receivedAt
    })
    const mission = await appStore.createMission({
      kind: input.sourceType === 'chat' ? 'document.inbound' : 'email.inbound',
      sydekyk: 'Ledger',
      title: `AI required · ${email.subject}`,
      summary: `${message} Configure an AI provider in Gadgets, then analyze this ${sourceLabel} again.`,
      status: 'needs_attention',
      payload: { emailId: email.id, fromAddress: email.fromAddress, subject: email.subject }
    })
    await appStore.updateInboundEmail(email.id, { reviewMissionId: mission.id })
    return {
      email: (await appStore.getInboundEmail(email.id)) as InboundEmailRecord,
      duplicate: false
    }
  }
  const missingFields = requiredBillFields.filter(
    (field) => analyzed.extracted[field] === undefined
  )
  const status = analyzed.intelligence.isBill ? 'needs_review' : 'not_bill'

  const email = await appStore.createInboundEmail({
    sourceType: input.sourceType,
    chatSessionIds: input.sourceType === 'chat' ? [input.chatSessionId] : [],
    messageId: parsed.messageId,
    sourceHash: parsed.sourceHash,
    sourcePath: parsed.sourcePath,
    mailbox: input.mailbox,
    uid: input.uid,
    fromAddress: parsed.fromAddress,
    fromName: parsed.fromName,
    subject: parsed.subject,
    status,
    attachments: parsed.attachments,
    extracted: analyzed.extracted,
    intelligence: analyzed.intelligence,
    missingFields,
    receivedAt: parsed.receivedAt
  })
  const mission = await appStore.createMission({
    kind: input.sourceType === 'chat' ? 'document.inbound' : 'email.inbound',
    sydekyk: 'Ledger',
    title: `${email.intelligence?.isBill ? billLabel : 'Not a bill?'} · ${email.subject}`,
    summary: !email.intelligence?.isBill
      ? `Ledger Intelligence classified this as ${email.intelligence?.documentType.replaceAll('_', ' ')} with ${Math.round((email.intelligence?.confidence ?? 0) * 100)}% confidence. Review it if that looks wrong.`
      : email.missingFields.length > 0
        ? `Ledger Intelligence found a bill and needs ${email.missingFields.length} field${email.missingFields.length === 1 ? '' : 's'} checked.`
        : input.sourceType === 'chat'
          ? 'Ledger Intelligence found a bill and extracted its fields. Review them before the Ledger handoff.'
          : "Ledger Intelligence found a bill and extracted its fields. Ledger's inbound policy decides the next step.",
    status: 'needs_attention',
    payload: {
      emailId: email.id,
      fromAddress: email.fromAddress,
      subject: email.subject,
      attachments: email.attachments.map(({ filename, contentType, size, sha256 }) => ({
        filename,
        contentType,
        size,
        sha256
      })),
      extracted: email.extracted,
      missingFields: email.missingFields,
      intelligence: email.intelligence
    }
  })
  await appStore.updateInboundEmail(email.id, { reviewMissionId: mission.id })
  const refreshed = (await appStore.getInboundEmail(email.id)) as InboundEmailRecord
  const automatic = options.allowAutomaticHandoff
    ? await maybeAutoHandoffToLedger(refreshed)
    : undefined
  return {
    email: automatic?.email ?? refreshed,
    duplicate: false
  }
}

export const ingestInboundEmail = async (input: InboundEmailSource): Promise<IngestResult> =>
  ingestParsedLedgerDocument(
    await parseInboundEmail(input.source),
    { mailbox: input.mailbox, uid: input.uid, sourceType: 'email' },
    { allowAutomaticHandoff: true }
  )

const emailStatusForMission = (mission: MissionRecord): InboundEmailRecord['status'] => {
  if (mission.status === 'waiting_approval') return 'waiting_approval'
  if (mission.status === 'completed') return 'completed'
  if (mission.status === 'declined') return 'declined'
  if (mission.status === 'failed' || mission.status === 'needs_attention') return 'failed'
  return 'processing'
}

export const handoffInboundEmailToLedger = async (
  emailId: string,
  bill: LedgerBillInput,
  options: { automatic?: boolean } = {}
): Promise<{ email: InboundEmailRecord; mission: MissionRecord }> => {
  const email = await appStore.getInboundEmail(emailId)
  if (!email) throw new Error('The Ledger document was not found')
  const sourceLabel = email.sourceType === 'chat' ? 'document' : 'email'
  if (email.ledgerMissionId) {
    const previousMission = await appStore.getMission(email.ledgerMissionId)
    if (
      previousMission &&
      !['failed', 'needs_attention', 'declined'].includes(previousMission.status)
    ) {
      throw new Error(`This ${sourceLabel} already has an active or completed Ledger mission`)
    }
  }
  if (!['needs_review', 'not_bill', 'failed', 'declined'].includes(email.status)) {
    throw new Error(`This ${sourceLabel} is not waiting for review`)
  }

  const enrichedBill: LedgerBillInput = {
    ...bill,
    taxHint: bill.taxHint ?? (email.intelligence?.taxClues.join('; ') || undefined),
    lineItemHints:
      bill.lineItemHints ??
      email.intelligence?.lineItems.map((line) =>
        [line.description, line.taxLabel].filter(Boolean).join(' · ')
      )
  }

  await appStore.updateInboundEmail(email.id, {
    status: 'processing',
    extracted: enrichedBill,
    missingFields: [],
    error: undefined
  })
  if (email.reviewMissionId) {
    await appStore.updateMission(email.reviewMissionId, {
      status: 'running',
      summary: options.automatic
        ? 'Inbound policy accepted the extracted fields. Ledger is starting automatically.'
        : 'Verification received. Ledger is starting the vendor-bill workflow.'
    })
  }

  const mission = await startLedgerMission(enrichedBill, {
    type: email.sourceType === 'chat' ? 'chat' : 'inbound-email',
    ...(email.sourceType === 'chat' ? { documentId: email.id } : { emailId: email.id }),
    fromAddress: email.fromAddress,
    subject: email.subject
  })
  await appStore.updateInboundEmail(email.id, {
    status: emailStatusForMission(mission),
    ledgerMissionId: mission.id,
    processedAt: mission.status === 'completed' ? new Date().toISOString() : undefined,
    error:
      mission.status === 'failed' || mission.status === 'needs_attention'
        ? mission.summary
        : undefined
  })
  if (email.reviewMissionId) {
    await appStore.updateMission(email.reviewMissionId, {
      status: 'completed',
      summary: options.automatic
        ? `Automatically handed to Ledger as ${mission.title}.`
        : `Verified and handed to Ledger as ${mission.title}.`,
      result: {
        emailId: email.id,
        ledgerMissionId: mission.id,
        handoff: options.automatic ? 'automatic-policy' : 'user-verification'
      }
    })
  }
  return {
    email: (await appStore.getInboundEmail(email.id)) as InboundEmailRecord,
    mission
  }
}

export const reanalyzeInboundEmail = async (emailId: string): Promise<InboundEmailRecord> => {
  const email = await appStore.getInboundEmail(emailId)
  if (!email?.sourcePath)
    throw new Error('The stored source document is unavailable for AI analysis')
  if (email.ledgerMissionId) throw new Error('This document has already been handed to Ledger')
  const parsed =
    email.sourceType === 'chat'
      ? await (async () => {
          const attachment = email.attachments[0]
          if (!attachment) throw new Error('The stored chat document is unavailable')
          const document = await parseDocument({
            content: await readFile(email.sourcePath as string),
            contentType: attachment.contentType,
            filename: attachment.filename,
            strict: true
          })
          const analysisText = [email.subject, document.extractedText].filter(Boolean).join('\n\n')
          return {
            ...email,
            analysisText,
            attachments: [document.attachment],
            extracted: document.extracted,
            media: document.media ? [document.media] : []
          }
        })()
      : await parseInboundEmail(await readFile(email.sourcePath))
  const analyzed = await analyzeBillDocument({
    fromAddress: parsed.fromAddress,
    subject: parsed.subject,
    filenames: parsed.attachments.map((attachment) => attachment.filename),
    text: parsed.analysisText,
    parserHints: parsed.extracted,
    media: parsed.media
  })
  const missingFields = requiredBillFields.filter(
    (field) => analyzed.extracted[field] === undefined
  )
  await appStore.updateInboundEmail(email.id, {
    status: analyzed.intelligence.isBill ? 'needs_review' : 'not_bill',
    attachments: parsed.attachments,
    extracted: analyzed.extracted,
    intelligence: analyzed.intelligence,
    missingFields,
    error: undefined
  })
  if (email.reviewMissionId) {
    await appStore.updateMission(email.reviewMissionId, {
      status: 'needs_attention',
      summary: analyzed.intelligence.isBill
        ? `Ledger Intelligence analyzed the stored ${email.sourceType === 'chat' ? 'document' : 'email'}. Review the extracted bill fields.`
        : `Ledger Intelligence classified this as ${analyzed.intelligence.documentType.replaceAll('_', ' ')}. Review it if that looks wrong.`
    })
  }
  const refreshed = (await appStore.getInboundEmail(email.id)) as InboundEmailRecord
  return email.sourceType === 'email'
    ? ((await maybeAutoHandoffToLedger(refreshed))?.email ?? refreshed)
    : refreshed
}

export const syncInboundEmailForLedgerMission = async (
  mission: MissionRecord
): Promise<InboundEmailRecord | undefined> => {
  const email = await appStore.getInboundEmailByLedgerMission(mission.id)
  if (!email) return undefined
  await appStore.updateInboundEmail(email.id, {
    status: emailStatusForMission(mission),
    processedAt: mission.status === 'completed' ? new Date().toISOString() : email.processedAt,
    error:
      mission.status === 'failed' || mission.status === 'needs_attention'
        ? mission.summary
        : undefined
  })
  return appStore.getInboundEmail(email.id)
}

export const createSampleInboundEmail = async (): Promise<IngestResult> => {
  const serial = Date.now().toString().slice(-7)
  const boundary = `sydekyks-sample-${serial}`
  const billText = [
    'Vendor: Wayne Office Goods',
    `Invoice Number: WAYNE-${serial}`,
    `Invoice Date: ${new Date().toISOString().slice(0, 10)}`,
    'Currency: EUR',
    'Description: Office supplies',
    'Account: Office Supplies',
    'Untaxed Amount: 100.00',
    'Tax Amount: 12.00',
    'Total Amount: 112.00'
  ].join('\r\n')
  const source = Buffer.from(
    [
      `Message-ID: <sample-${serial}@sydekyks.local>`,
      'From: Accounts Payable Demo <bills@example.test>',
      'To: ledger@sydekyks.local',
      `Date: ${new Date().toUTCString()}`,
      `Subject: Vendor bill WAYNE-${serial}`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Please review and process the attached vendor bill.',
      `--${boundary}`,
      `Content-Type: text/plain; name="WAYNE-${serial}.txt"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="WAYNE-${serial}.txt"`,
      '',
      Buffer.from(billText).toString('base64'),
      `--${boundary}--`
    ].join('\r\n')
  )
  return ingestInboundEmail({ source, mailbox: 'Sample inbox' })
}
