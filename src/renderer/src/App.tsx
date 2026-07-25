import { useCallback, useEffect, useRef, useState } from 'react'
import { AppShell } from './components/AppShell'
import {
  clearChatSessions,
  createChatSession,
  deleteChatSession,
  listChatSessions,
  loadBootstrap
} from './lib/api'
import type { BootstrapData, ChatSession, ViewId } from './lib/types'
import { ChatView } from './views/ChatView'
import { GadgetsView } from './views/GadgetsView'
import { MissionControlView } from './views/MissionControlView'
import { RosterView } from './views/RosterView'

function App(): React.JSX.Element {
  const [view, setView] = useState<ViewId>('chat')
  const [menuOpen, setMenuOpen] = useState(false)
  const [missionTab, setMissionTab] = useState<'activity' | 'automations'>('activity')
  const [bootstrap, setBootstrap] = useState<BootstrapData>()
  const [serviceError, setServiceError] = useState<string>()
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([])
  const [activeChatSessionId, setActiveChatSessionId] = useState<string>()
  const [chatSessionActionBusy, setChatSessionActionBusy] = useState(false)
  const [chatStreamingBusy, setChatStreamingBusy] = useState(false)
  const [chatSessionError, setChatSessionError] = useState<string>()
  const notifiedApprovals = useRef(new Set<string>())

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setBootstrap(await loadBootstrap())
      setServiceError(undefined)
    } catch {
      setServiceError(
        'Sydekyks could not reach its private local service. Restart the app; your local data is safe.'
      )
    }
  }, [])

  const refreshChatSessions = useCallback(async (ensureOne = false): Promise<void> => {
    try {
      let sessions = (await listChatSessions()).sessions
      if (ensureOne && sessions.length === 0) sessions = [await createChatSession()]
      setChatSessions(sessions)
      setActiveChatSessionId((current) =>
        current && sessions.some((session) => session.id === current) ? current : sessions[0]?.id
      )
      setChatSessionError(undefined)
    } catch {
      setChatSessionError('Chat history is temporarily unavailable.')
    }
  }, [])

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0)
    const timer = window.setInterval(() => void refresh(), 4_000)
    return () => {
      window.clearTimeout(initial)
      window.clearInterval(timer)
    }
  }, [refresh])

  useEffect(() => {
    const initial = window.setTimeout(() => void refreshChatSessions(true), 0)
    return () => window.clearTimeout(initial)
  }, [refreshChatSessions])

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [])

  useEffect(() => {
    return window.api?.notifications.onOpenApproval(() => setView('missions'))
  }, [])

  useEffect(() => {
    return window.api?.notifications.onOpenMission(() => {
      setMissionTab('activity')
      setView('missions')
    })
  }, [])

  useEffect(() => {
    for (const mission of bootstrap?.missions ?? []) {
      if (mission.status !== 'waiting_approval' || notifiedApprovals.current.has(mission.id))
        continue
      notifiedApprovals.current.add(mission.id)
      void window.api?.notifications.showApproval({
        missionId: mission.id,
        title: 'Sydekyks needs your approval',
        body: `${mission.sydekyk}: ${mission.summary}`
      })
    }
  }, [bootstrap?.missions])

  const gadget = bootstrap?.gadget ?? {
    mode: 'demo' as const,
    connected: false,
    label: 'Starting…',
    liveWrites: false
  }
  const imap = bootstrap?.imap ?? {
    configured: false,
    connected: false,
    syncing: false,
    label: 'IMAP not connected'
  }
  const ai = bootstrap?.ai ?? {
    configured: false,
    connected: false,
    label: 'AI not configured'
  }
  const chatSessionBusy = chatSessionActionBusy || chatStreamingBusy

  const startNewChatSession = async (): Promise<void> => {
    if (chatSessionBusy) return
    setChatSessionActionBusy(true)
    setChatSessionError(undefined)
    try {
      const session = await createChatSession()
      setChatSessions((current) => [session, ...current])
      setActiveChatSessionId(session.id)
      setView('chat')
      setMenuOpen(false)
    } catch {
      setChatSessionError('Syd could not start a new session.')
    } finally {
      setChatSessionActionBusy(false)
    }
  }

  const removeChatSession = async (session: ChatSession): Promise<void> => {
    if (chatSessionBusy) return
    const confirmed = window.confirm(
      `Delete “${session.title}”?\n\nThis removes its local message history and cannot be undone.`
    )
    if (!confirmed) return
    setChatSessionActionBusy(true)
    setChatSessionError(undefined)
    try {
      await deleteChatSession(session.id)
      await refreshChatSessions(true)
    } catch {
      setChatSessionError('The chat session could not be deleted.')
    } finally {
      setChatSessionActionBusy(false)
    }
  }

  const clearAllChatSessions = async (): Promise<boolean> => {
    if (chatSessionBusy || chatSessions.length === 0) return false
    setChatSessionActionBusy(true)
    setChatSessionError(undefined)
    try {
      const { session } = await clearChatSessions()
      setChatSessions([session])
      setActiveChatSessionId(session.id)
      setView('chat')
      return true
    } catch {
      await refreshChatSessions(false)
      setChatSessionError(
        'Syd could not clear every chat session. The current session list was refreshed.'
      )
      return false
    } finally {
      setChatSessionActionBusy(false)
    }
  }

  return (
    <AppShell
      bootstrap={bootstrap}
      activeChatSessionId={activeChatSessionId}
      chatSessionBusy={chatSessionBusy}
      chatSessionError={chatSessionError}
      chatSessions={chatSessions}
      currentView={view}
      menuOpen={menuOpen}
      onClearChatSessions={clearAllChatSessions}
      onCreateChatSession={() => void startNewChatSession()}
      onDeleteChatSession={(session) => void removeChatSession(session)}
      onMenuChange={setMenuOpen}
      onNavigate={(nextView) => {
        if (nextView === 'missions') setMissionTab('activity')
        setView(nextView)
      }}
      onSelectChatSession={(sessionId) => {
        if (chatSessionBusy && sessionId !== activeChatSessionId) return
        setActiveChatSessionId(sessionId)
        setView('chat')
      }}
      serviceError={serviceError}
    >
      {view === 'chat' && activeChatSessionId && (
        <ChatView
          ai={ai}
          automations={bootstrap?.automations ?? []}
          emails={bootstrap?.emails ?? []}
          gadget={gadget}
          key={activeChatSessionId}
          missions={bootstrap?.missions ?? []}
          onBusyChange={setChatStreamingBusy}
          onChanged={refresh}
          onOpenGadgets={() => setView('gadgets')}
          onSessionChanged={refreshChatSessions}
          sessionId={activeChatSessionId}
        />
      )}
      {view === 'chat' && !activeChatSessionId && (
        <section className="chat-unavailable page-view" role="status">
          <div>
            <h1>Starting Syd…</h1>
            <p>{chatSessionError ?? 'Preparing your first local chat session.'}</p>
            {chatSessionError && (
              <button className="primary-button" onClick={() => void startNewChatSession()}>
                Try again
              </button>
            )}
          </div>
        </section>
      )}
      {view === 'missions' && (
        <MissionControlView
          automations={bootstrap?.automations ?? []}
          gadget={gadget}
          emails={bootstrap?.emails ?? []}
          initialTab={missionTab}
          missions={bootstrap?.missions ?? []}
          onChanged={refresh}
        />
      )}
      {view === 'roster' && (
        <RosterView
          gadget={gadget}
          onOpenAutomations={() => {
            setMissionTab('automations')
            setView('missions')
          }}
          sidekicks={bootstrap?.sidekicks ?? []}
        />
      )}
      {view === 'gadgets' && (
        <GadgetsView
          ai={ai}
          gadget={gadget}
          imap={imap}
          onChanged={refresh}
          permissions={bootstrap?.permissions ?? []}
        />
      )}
    </AppShell>
  )
}

export default App
