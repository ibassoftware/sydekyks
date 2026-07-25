import { useEffect, useState } from 'react'
import type {
  ImapCredentialInput,
  ImapPublicStatus,
  ImapSavedConfig,
  SydekyksDesktopApi
} from '../../../shared/ipc'
import { apiRequest, createSampleInboundEmail } from '../lib/api'
import { Icon } from './Icon'

interface ImapForm {
  host: string
  port: string
  secure: boolean
  username: string
  password: string
  mailbox: string
  pollIntervalMinutes: string
  processedMailbox: string
}

const desktopApi = (): SydekyksDesktopApi | undefined =>
  (window as typeof window & { api?: SydekyksDesktopApi }).api

export function ImapGadgetPanel({
  imap,
  onChanged
}: {
  imap: ImapPublicStatus
  onChanged: () => Promise<void>
}): React.JSX.Element {
  const [form, setForm] = useState<ImapForm>({
    host: imap.host ?? '',
    port: String(imap.port ?? 993),
    secure: imap.secure ?? true,
    username: imap.username ?? '',
    password: '',
    mailbox: imap.mailbox ?? 'INBOX',
    pollIntervalMinutes: String(imap.pollIntervalMinutes ?? 5),
    processedMailbox: imap.processedMailbox ?? 'Sydekyks/Processed'
  })
  const [storedSecret, setStoredSecret] = useState(false)
  const [busy, setBusy] = useState<'connect' | 'sync' | 'sample' | 'clear'>()
  const [message, setMessage] = useState<string>()
  const [error, setError] = useState<string>()

  useEffect(() => {
    const api = desktopApi()
    if (!api) return
    void api.imap.getSavedConfig().then((saved: ImapSavedConfig) => {
      setStoredSecret(saved.hasStoredSecret)
      setForm((current) => ({
        ...current,
        host: saved.host ?? current.host,
        port: String(saved.port),
        secure: saved.secure,
        username: saved.username ?? current.username,
        mailbox: saved.mailbox,
        pollIntervalMinutes: String(saved.pollIntervalMinutes),
        processedMailbox: saved.processedMailbox
      }))
    })
  }, [])

  const connect = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    setBusy('connect')
    setMessage(undefined)
    setError(undefined)
    try {
      if (!form.password) {
        throw new Error(
          storedSecret
            ? 'Re-enter the app password to test connection changes. The saved password is never revealed.'
            : 'Enter the mailbox password or app password'
        )
      }
      const credentials: ImapCredentialInput = {
        host: form.host,
        port: Number(form.port),
        secure: form.secure,
        username: form.username,
        password: form.password,
        mailbox: form.mailbox,
        pollIntervalMinutes: Number(form.pollIntervalMinutes),
        processedMailbox: form.processedMailbox
      }
      const api = desktopApi()
      const status = api
        ? await api.imap.saveAndConnect(credentials)
        : await apiRequest<ImapPublicStatus>('/sydekyks/gadgets/imap/connect', {
            method: 'POST',
            body: JSON.stringify(credentials)
          })
      setStoredSecret(true)
      setForm((current) => ({ ...current, password: '' }))
      setMessage(`Connected ${status.label}. New mail will be checked automatically.`)
      await onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not connect inbound email')
    } finally {
      setBusy(undefined)
    }
  }

  const sync = async (): Promise<void> => {
    setBusy('sync')
    setMessage(undefined)
    setError(undefined)
    try {
      const api = desktopApi()
      const result = api
        ? await api.imap.syncNow()
        : await apiRequest<{ processed: number; duplicates: number; failed: number }>(
            '/sydekyks/gadgets/imap/sync',
            { method: 'POST' }
          )
      setMessage(
        `Sync complete: ${result.processed} new, ${result.duplicates} duplicate, ${result.failed} failed.`
      )
      await onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Email sync failed')
    } finally {
      setBusy(undefined)
    }
  }

  const sample = async (): Promise<void> => {
    setBusy('sample')
    setMessage(undefined)
    setError(undefined)
    try {
      await createSampleInboundEmail()
      setMessage('A sample vendor bill is ready in Mission Control.')
      await onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The sample email could not be processed')
    } finally {
      setBusy(undefined)
    }
  }

  const clear = async (): Promise<void> => {
    setBusy('clear')
    setMessage(undefined)
    setError(undefined)
    try {
      const api = desktopApi()
      if (api) await api.imap.clear()
      else await apiRequest('/sydekyks/gadgets/imap/disconnect', { method: 'POST' })
      setStoredSecret(false)
      setMessage('Inbound email disconnected and its stored secret removed.')
      await onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not disconnect inbound email')
    } finally {
      setBusy(undefined)
    }
  }

  return (
    <section className="surface connection-panel imap-panel" aria-labelledby="imap-title">
      <div className="surface-heading">
        <div className="gadget-icon mail-gadget-icon">
          <Icon name="mail" />
        </div>
        <div>
          <p className="eyebrow">Inbound Gadget</p>
          <h2 id="imap-title">Email inbox</h2>
        </div>
        <span className={`connection-badge ${imap.connected ? 'connected' : ''}`}>
          <span />
          {imap.connected ? 'Watching' : imap.configured ? 'Locked' : 'Not connected'}
        </span>
      </div>

      <div className="connection-summary">
        <div>
          <span>Mailbox</span>
          <strong>{imap.mailbox ?? 'INBOX'}</strong>
        </div>
        <div>
          <span>Account</span>
          <strong>{imap.username ?? 'Not configured'}</strong>
        </div>
        <div>
          <span>Last sync</span>
          <strong>
            {imap.lastSyncedAt ? new Date(imap.lastSyncedAt).toLocaleString() : 'Never'}
          </strong>
        </div>
      </div>

      <form className="gadget-form" onSubmit={(event) => void connect(event)}>
        <div className="form-grid live-fields">
          <label className="span-two">
            <span>IMAP host</span>
            <input
              placeholder="imap.example.com"
              required
              value={form.host}
              onChange={(e) => setForm({ ...form, host: e.target.value })}
            />
          </label>
          <label>
            <span>Port</span>
            <input
              min="1"
              max="65535"
              required
              type="number"
              value={form.port}
              onChange={(e) => setForm({ ...form, port: e.target.value })}
            />
          </label>
          <label>
            <span>Username</span>
            <input
              autoComplete="username"
              required
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
            />
          </label>
          <label className="span-two">
            <span>Password or app password</span>
            <input
              autoComplete="current-password"
              placeholder={storedSecret ? 'Stored securely · re-enter to change' : ''}
              required={!storedSecret}
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </label>
          <label>
            <span>Source mailbox</span>
            <input
              required
              value={form.mailbox}
              onChange={(e) => setForm({ ...form, mailbox: e.target.value })}
            />
          </label>
          <label>
            <span>Processed mailbox</span>
            <input
              required
              value={form.processedMailbox}
              onChange={(e) => setForm({ ...form, processedMailbox: e.target.value })}
            />
          </label>
          <label>
            <span>
              Check every <small>minutes</small>
            </span>
            <input
              min="1"
              max="1440"
              required
              type="number"
              value={form.pollIntervalMinutes}
              onChange={(e) => setForm({ ...form, pollIntervalMinutes: e.target.value })}
            />
          </label>
          <label className="toggle-field">
            <input
              checked={form.secure}
              onChange={(e) => setForm({ ...form, secure: e.target.checked })}
              type="checkbox"
            />
            <span className="toggle-track" aria-hidden="true">
              <span />
            </span>
            <span>
              <strong>Use TLS</strong>
              <small>Recommended for port 993.</small>
            </span>
          </label>
        </div>
        {error && (
          <div className="inline-alert error" role="alert">
            <Icon name="alert" size={18} />
            {error}
          </div>
        )}
        {message && (
          <div className="inline-alert success" role="status">
            <Icon name="check" size={18} />
            {message}
          </div>
        )}
        <div className="gadget-action-row">
          <button className="primary-button" disabled={Boolean(busy)} type="submit">
            <Icon name={busy === 'connect' ? 'refresh' : 'plug'} size={18} />
            {busy === 'connect' ? 'Testing…' : 'Test & save securely'}
          </button>
          <button
            className="secondary-button"
            disabled={Boolean(busy) || !imap.configured}
            onClick={() => void sync()}
            type="button"
          >
            <Icon name="refresh" size={18} />
            Sync now
          </button>
          <button
            className="secondary-button"
            disabled={Boolean(busy)}
            onClick={() => void sample()}
            type="button"
          >
            <Icon name="mail" size={18} />
            Process sample email
          </button>
          {storedSecret && (
            <button
              className="ghost-button danger"
              disabled={Boolean(busy)}
              onClick={() => void clear()}
              type="button"
            >
              Disconnect
            </button>
          )}
        </div>
        <p className="security-caption">
          <Icon name="shield" size={15} />
          Password encrypted by the operating system. Original attachments stay local; bounded
          extracted text is sent only to your configured AI model for bill analysis. You can ask
          Syd: “Check this inbox daily and have Ledger prepare confident vendor bills as Odoo
          drafts.”
        </p>
      </form>
    </section>
  )
}
