import { useEffect, useRef, useState } from 'react'
import type { BootstrapData, ChatSession, ViewId } from '../lib/types'
import { Icon, type IconName } from './Icon'

const navigation: Array<{ id: ViewId; label: string; icon: IconName }> = [
  { id: 'chat', label: 'Talk to Syd', icon: 'chat' },
  { id: 'missions', label: 'Mission Control', icon: 'bolt' },
  { id: 'roster', label: 'Sidekicks', icon: 'users' },
  { id: 'gadgets', label: 'Gadgets', icon: 'plug' }
]

interface AppShellProps {
  bootstrap?: BootstrapData
  children: React.ReactNode
  currentView: ViewId
  chatSessionBusy: boolean
  chatSessionError?: string
  chatSessions: ChatSession[]
  activeChatSessionId?: string
  menuOpen: boolean
  onCreateChatSession: () => void
  onDeleteChatSession: (session: ChatSession) => void
  onMenuChange: (open: boolean) => void
  onNavigate: (view: ViewId) => void
  onSelectChatSession: (sessionId: string) => void
  serviceError?: string
}

export function AppShell({
  bootstrap,
  children,
  currentView,
  chatSessionBusy,
  chatSessionError,
  chatSessions,
  activeChatSessionId,
  menuOpen,
  onCreateChatSession,
  onDeleteChatSession,
  onMenuChange,
  onNavigate,
  onSelectChatSession,
  serviceError
}: AppShellProps): React.JSX.Element {
  const [compactNavigation, setCompactNavigation] = useState(false)
  const sidebarRef = useRef<HTMLElement>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const menuWasOpen = useRef(false)
  const unseenAttention =
    bootstrap?.missions.filter(
      (mission) =>
        ['needs_attention', 'waiting_approval'].includes(mission.status) && !mission.acknowledgedAt
    ).length ?? 0
  const gadget = bootstrap?.gadget
  const ai = bootstrap?.ai

  useEffect(() => {
    const query = window.matchMedia('(max-width: 900px)')
    const update = (): void => setCompactNavigation(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    if (!compactNavigation) {
      menuWasOpen.current = false
      return
    }
    if (menuOpen) {
      menuWasOpen.current = true
      window.requestAnimationFrame(() => {
        sidebarRef.current
          ?.querySelector<HTMLElement>('button:not([disabled]), [href], [tabindex="0"]')
          ?.focus()
      })
    } else if (menuWasOpen.current) {
      menuWasOpen.current = false
      menuButtonRef.current?.focus()
    }
  }, [compactNavigation, menuOpen])

  const trapDrawerFocus = (event: React.KeyboardEvent<HTMLElement>): void => {
    if (!compactNavigation || !menuOpen || event.key !== 'Tab') return
    const controls = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex="0"]'
      )
    )
    if (controls.length === 0) return
    const first = controls[0]
    const last = controls[controls.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div className={`app-shell ${menuOpen ? 'menu-open' : ''}`}>
      <a
        className="skip-link"
        href="#main-content"
        tabIndex={compactNavigation && menuOpen ? -1 : undefined}
      >
        Skip to content
      </a>
      <aside
        aria-hidden={compactNavigation && !menuOpen ? true : undefined}
        aria-label="Sydekyks navigation"
        aria-modal={compactNavigation && menuOpen ? true : undefined}
        className="sidebar"
        inert={compactNavigation && !menuOpen ? true : undefined}
        onKeyDown={trapDrawerFocus}
        ref={sidebarRef}
        role={compactNavigation ? 'dialog' : undefined}
      >
        <div className="brand-lockup">
          <div aria-hidden="true" className="brand-mark">
            S
          </div>
          <div>
            <strong>Sydekyks</strong>
            <span>Local command desk</span>
          </div>
          <button
            aria-label="Close navigation"
            className="icon-button mobile-close"
            onClick={() => onMenuChange(false)}
            type="button"
          >
            <Icon name="close" />
          </button>
        </div>

        <nav className="primary-navigation">
          {navigation.map((item) => (
            <button
              aria-current={currentView === item.id ? 'page' : undefined}
              className={currentView === item.id ? 'active' : ''}
              key={item.id}
              onClick={() => {
                onNavigate(item.id)
                onMenuChange(false)
              }}
              type="button"
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
              {item.id === 'missions' && unseenAttention > 0 && (
                <span
                  aria-label={`${unseenAttention} unseen Mission Control ${
                    unseenAttention === 1 ? 'notification' : 'notifications'
                  }`}
                  className="nav-count"
                >
                  {unseenAttention}
                </span>
              )}
            </button>
          ))}
        </nav>

        <section aria-labelledby="sessions-title" className="session-navigation">
          <div className="session-navigation-heading">
            <h2 id="sessions-title">Sessions</h2>
            <button
              aria-label="New chat session"
              className="session-new-button"
              disabled={chatSessionBusy}
              onClick={onCreateChatSession}
              title="New chat session"
              type="button"
            >
              <Icon name="plus" size={17} />
            </button>
          </div>
          <div className="session-list">
            {chatSessions.map((session) => (
              <div
                className={`session-row${activeChatSessionId === session.id ? ' active' : ''}`}
                key={session.id}
              >
                <button
                  aria-current={activeChatSessionId === session.id ? 'page' : undefined}
                  className="session-select"
                  disabled={chatSessionBusy && activeChatSessionId !== session.id}
                  onClick={() => {
                    onSelectChatSession(session.id)
                    onMenuChange(false)
                  }}
                  title={session.title}
                  type="button"
                >
                  <span className={`session-title${session.titlePending ? ' pending' : ''}`}>
                    {session.title}
                  </span>
                </button>
                <button
                  aria-label={`Delete ${session.title}`}
                  className="session-delete"
                  disabled={chatSessionBusy}
                  onClick={() => onDeleteChatSession(session)}
                  title={`Delete ${session.title}`}
                  type="button"
                >
                  <Icon name="trash" size={15} />
                </button>
              </div>
            ))}
            {!chatSessionError && chatSessions.length === 0 && (
              <p className="session-empty">Start a new session to talk with Syd.</p>
            )}
            {chatSessionError && (
              <p className="session-error" role="status">
                {chatSessionError}
              </p>
            )}
          </div>
        </section>

        <div className="sidebar-spacer" />
        <div className={`gadget-mini-status ${gadget?.connected ? 'connected' : 'disconnected'}`}>
          <span className="status-light" />
          <div>
            <strong>{gadget?.label ?? 'Odoo Gadget'}</strong>
            <span>{gadget?.mode === 'live' ? 'Live connection' : 'Safe demo mode'}</span>
          </div>
        </div>
        <div className={`gadget-mini-status ${ai?.connected ? 'connected' : 'disconnected'}`}>
          <span className="status-light" />
          <div>
            <strong>{ai?.connected ? ai.label : 'AI setup required'}</strong>
            <span>{ai?.connected ? 'Intelligence ready' : 'Configure in Gadgets'}</span>
          </div>
        </div>
        <div className="local-first-note">
          <Icon name="shield" size={18} />
          <span>Single-user · local-first</span>
        </div>
      </aside>

      <button
        aria-hidden="true"
        aria-label="Close navigation overlay"
        className="sidebar-scrim"
        onClick={() => onMenuChange(false)}
        tabIndex={-1}
        type="button"
      />

      <section className="workspace" inert={compactNavigation && menuOpen ? true : undefined}>
        <div className="mobile-app-bar">
          <button
            aria-expanded={menuOpen}
            aria-label="Open navigation"
            className="icon-button"
            onClick={() => onMenuChange(true)}
            ref={menuButtonRef}
            type="button"
          >
            <Icon name="menu" />
          </button>
          <strong>Sydekyks</strong>
          <span className={`status-light ${serviceError ? 'error' : ''}`} />
        </div>
        {serviceError && (
          <div className="service-banner" role="alert">
            <Icon name="alert" size={18} />
            <span>{serviceError}</span>
          </div>
        )}
        <main id="main-content">{children}</main>
      </section>
    </div>
  )
}
