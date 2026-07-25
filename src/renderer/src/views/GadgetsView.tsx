import { useEffect, useState } from 'react'
import type {
  AiPublicStatus,
  OdooCredentialInput,
  ImapPublicStatus,
  OdooPublicStatus,
  OdooSavedConfig,
  SydekyksDesktopApi
} from '../../../shared/ipc'
import { apiRequest } from '../lib/api'
import type { Permission } from '../lib/types'
import { Icon } from '../components/Icon'
import { ImapGadgetPanel } from '../components/ImapGadgetPanel'
import { AiProviderPanel } from '../components/AiProviderPanel'

type GadgetMode = 'demo' | 'live'

interface LiveForm {
  url: string
  database: string
  username: string
  secret: string
  companyId: string
  liveWrites: boolean
}

const desktopApi = (): SydekyksDesktopApi | undefined =>
  (window as typeof window & { api?: SydekyksDesktopApi }).api

export function GadgetsView({
  gadget,
  ai,
  imap,
  permissions,
  onChanged
}: {
  gadget: OdooPublicStatus
  ai: AiPublicStatus
  imap: ImapPublicStatus
  permissions: Permission[]
  onChanged: () => Promise<void>
}): React.JSX.Element {
  const [mode, setMode] = useState<GadgetMode>(gadget.mode)
  const [live, setLive] = useState<LiveForm>({
    url: gadget.url ?? '',
    database: gadget.database ?? '',
    username: gadget.username ?? '',
    secret: '',
    companyId: gadget.companyId ? String(gadget.companyId) : '',
    liveWrites: gadget.liveWrites
  })
  const [storedSecret, setStoredSecret] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [connectionError, setConnectionError] = useState<string>()
  const [connectionMessage, setConnectionMessage] = useState<string>()

  useEffect(() => {
    const api = desktopApi()
    if (!api) return
    void api.odoo.getSavedConfig().then((saved: OdooSavedConfig) => {
      setStoredSecret(saved.hasStoredSecret)
      if (saved.mode === 'live') {
        setLive((current) => ({
          ...current,
          url: saved.url ?? '',
          database: saved.database ?? '',
          username: saved.username ?? '',
          companyId: saved.companyId ? String(saved.companyId) : '',
          liveWrites: saved.liveWrites
        }))
      }
    })
  }, [])

  const connect = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    setConnecting(true)
    setConnectionError(undefined)
    setConnectionMessage(undefined)
    try {
      let credentials: OdooCredentialInput
      if (mode === 'demo') credentials = { mode: 'demo' }
      else {
        if (!live.secret && !storedSecret) throw new Error('Enter an Odoo API key or password')
        if (!live.secret && storedSecret) {
          throw new Error(
            'Re-enter the API key to test changes. The stored secret is never revealed.'
          )
        }
        credentials = {
          mode: 'live',
          url: live.url,
          database: live.database,
          username: live.username,
          secret: live.secret,
          companyId: live.companyId ? Number(live.companyId) : undefined,
          liveWrites: live.liveWrites
        }
      }
      const api = desktopApi()
      const status = api
        ? await api.odoo.saveAndConnect(credentials)
        : await apiRequest<OdooPublicStatus>('/sydekyks/gadgets/odoo/connect', {
            method: 'POST',
            body: JSON.stringify(credentials)
          })
      setStoredSecret(credentials.mode === 'live')
      setLive((current) => ({ ...current, secret: '' }))
      setConnectionMessage(`Connected to ${status.label}.`)
      await onChanged()
    } catch (cause) {
      setConnectionError(
        cause instanceof Error ? cause.message : 'Could not connect the Odoo Gadget'
      )
    } finally {
      setConnecting(false)
    }
  }

  return (
    <section className="page-view scroll-view" aria-labelledby="gadgets-title">
      <header className="view-header">
        <p className="eyebrow">Connections</p>
        <h1 id="gadgets-title">Gadgets</h1>
        <p>Connect external systems once. Sydekyks receive only the operations they need.</p>
      </header>

      <div className="ai-gadget-section">
        <AiProviderPanel ai={ai} onChanged={onChanged} />
      </div>

      <div className="gadget-layout">
        <section className="surface connection-panel" aria-labelledby="odoo-title">
          <div className="surface-heading">
            <div className="gadget-icon">
              <Icon name="database" />
            </div>
            <div>
              <p className="eyebrow">ERP Gadget</p>
              <h2 id="odoo-title">Odoo</h2>
            </div>
            <span className={`connection-badge ${gadget.connected ? 'connected' : ''}`}>
              <span />
              {gadget.connected ? 'Connected' : 'Locked'}
            </span>
          </div>
          <div className="connection-summary">
            <div>
              <span>Workspace</span>
              <strong>{gadget.label}</strong>
            </div>
            <div>
              <span>Mode</span>
              <strong>{gadget.mode === 'live' ? 'Live Odoo' : 'Safe demo'}</strong>
            </div>
            <div>
              <span>Writes</span>
              <strong>
                {gadget.mode === 'demo' ? 'Demo only' : gadget.liveWrites ? 'Enabled' : 'Blocked'}
              </strong>
            </div>
          </div>

          <form className="gadget-form" onSubmit={(event) => void connect(event)}>
            <fieldset className="segmented-control">
              <legend>Connection mode</legend>
              <label>
                <input
                  checked={mode === 'demo'}
                  name="mode"
                  onChange={() => setMode('demo')}
                  type="radio"
                />
                <span>Demo</span>
              </label>
              <label>
                <input
                  checked={mode === 'live'}
                  name="mode"
                  onChange={() => setMode('live')}
                  type="radio"
                />
                <span>Live Odoo</span>
              </label>
            </fieldset>
            {mode === 'demo' ? (
              <div className="demo-explainer">
                <Icon name="shield" />
                <div>
                  <strong>Use isolated sample data</strong>
                  <span>
                    Test searches, writes, Ledger, and approvals without touching an Odoo database.
                  </span>
                </div>
              </div>
            ) : (
              <div className="form-grid live-fields">
                <label className="span-two">
                  <span>Odoo URL</span>
                  <input
                    placeholder="https://company.odoo.com"
                    required
                    type="url"
                    value={live.url}
                    onChange={(e) => setLive({ ...live, url: e.target.value })}
                  />
                </label>
                <label>
                  <span>Database</span>
                  <input
                    required
                    value={live.database}
                    onChange={(e) => setLive({ ...live, database: e.target.value })}
                  />
                </label>
                <label>
                  <span>Username</span>
                  <input
                    autoComplete="username"
                    required
                    value={live.username}
                    onChange={(e) => setLive({ ...live, username: e.target.value })}
                  />
                </label>
                <label>
                  <span>API key or password</span>
                  <input
                    autoComplete="current-password"
                    placeholder={storedSecret ? 'Stored securely · re-enter to change' : ''}
                    required={!storedSecret}
                    type="password"
                    value={live.secret}
                    onChange={(e) => setLive({ ...live, secret: e.target.value })}
                  />
                </label>
                <label>
                  <span>
                    Company ID <small>optional</small>
                  </span>
                  <input
                    min="1"
                    type="number"
                    value={live.companyId}
                    onChange={(e) => setLive({ ...live, companyId: e.target.value })}
                  />
                </label>
                <label className="toggle-field span-two">
                  <input
                    checked={live.liveWrites}
                    onChange={(e) => setLive({ ...live, liveWrites: e.target.checked })}
                    type="checkbox"
                  />
                  <span className="toggle-track" aria-hidden="true">
                    <span />
                  </span>
                  <span>
                    <strong>Permit confirmed live writes</strong>
                    <small>Every write still requires a workflow or console confirmation.</small>
                  </span>
                </label>
              </div>
            )}
            {connectionError && (
              <div className="inline-alert error" role="alert">
                <Icon name="alert" size={18} />
                {connectionError}
              </div>
            )}
            {connectionMessage && (
              <div className="inline-alert success" role="status">
                <Icon name="check" size={18} />
                {connectionMessage}
              </div>
            )}
            <button className="primary-button wide-button" disabled={connecting} type="submit">
              {connecting ? <Icon name="refresh" size={18} /> : <Icon name="plug" size={18} />}
              {connecting
                ? 'Testing connection…'
                : mode === 'demo'
                  ? 'Use demo Gadget'
                  : 'Test & save securely'}
            </button>
            <p className="security-caption">
              <Icon name="shield" size={15} /> Credentials are encrypted by the operating system and
              never stored in the Mastra database.
            </p>
          </form>
        </section>

        <section className="surface permission-panel" aria-labelledby="permission-title">
          <div className="surface-heading compact">
            <div className="gadget-icon secondary">
              <Icon name="shield" />
            </div>
            <div>
              <p className="eyebrow">Remembered decisions</p>
              <h2 id="permission-title">Permissions</h2>
            </div>
          </div>
          {permissions.length === 0 ? (
            <p className="muted-copy">
              No permissions remembered yet. Try the missing-vendor Ledger example.
            </p>
          ) : (
            <ul className="permission-list">
              {permissions.map((permission) => (
                <li key={permission.id}>
                  <Icon name="check" size={16} />
                  <div>
                    <strong>{permission.capability}</strong>
                    <span>{permission.scope}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="inbound-gadget-section">
        <ImapGadgetPanel imap={imap} onChanged={onChanged} />
      </div>
    </section>
  )
}
