import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses } from 'ai'
import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { agentWorkReportSchema, type AgentWorkReport } from '../../../shared/agent-activity'
import type { AiPublicStatus, OdooPublicStatus } from '../../../shared/ipc'
import {
  decideLedgerApproval,
  getServiceConnection,
  loadChatSession,
  uploadChatDocument
} from '../lib/api'
import { friendlyError } from '../lib/errors'
import { odooRecordRefsFromOutput } from '../lib/odoo-links'
import { portraitFor, sydekykPortraits } from '../lib/sydekyk-portraits'
import type { Automation, InboundEmail, Mission } from '../lib/types'
import { Icon } from '../components/Icon'
import { LedgerDocumentReviewCard } from '../components/LedgerDocumentReviewCard'
import { OdooRecordLink } from '../components/OdooRecordLink'

const localTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone
const sydChatResourceId = 'local-user-syd'

const chatTransport = new DefaultChatTransport({
  api: '/chat/syd',
  prepareSendMessagesRequest: async ({ id, messages, body, trigger, messageId }) => {
    const connection = await getServiceConnection()
    const requestBody = (body ?? {}) as Record<string, unknown>
    const sessionId = requestBody.sessionId
    if (typeof sessionId !== 'string' || !sessionId) {
      throw new Error('Choose a chat session before messaging Syd')
    }
    const forwardBody = { ...requestBody }
    delete forwardBody.sessionId
    return {
      api: `${connection.baseUrl}/chat/syd`,
      headers: { authorization: `Bearer ${connection.token}` },
      body: {
        ...forwardBody,
        id,
        // Mastra loads earlier turns from memory; resending them would duplicate history.
        messages: messages.slice(-1),
        trigger,
        messageId,
        memory: {
          resource: sydChatResourceId,
          thread: { id: sessionId }
        }
      }
    }
  },
  prepareReconnectToStreamRequest: async () => {
    const connection = await getServiceConnection()
    return {
      api: `${connection.baseUrl}/chat/syd`,
      headers: { authorization: `Bearer ${connection.token}` }
    }
  }
})

const prompts = [
  'Help me process a vendor bill with Ledger.',
  'Ask Nudge which opportunities need attention.',
  'Ask Mirror to scan Odoo for duplicate vendor bills.',
  'Have Shield assess and brief me on AP fraud risk.',
  `Have Mirror scan for duplicates every 3 days at 9:00 (${localTimezone}).`
]

const workReportFromOutput = (output: unknown): AgentWorkReport | undefined => {
  if (!output || typeof output !== 'object' || !('workReport' in output)) return undefined
  const parsed = agentWorkReportSchema.safeParse(output.workReport)
  if (!parsed.success) return undefined
  if (parsed.data.actions.length > 0 || parsed.data.activities.length === 0) return parsed.data
  return {
    ...parsed.data,
    actions: parsed.data.activities.map((activity) => ({
      ...activity,
      kind: 'performed' as const
    }))
  }
}

function FailedSpecialistReport({
  specialist,
  workReport
}: {
  specialist: string
  workReport: AgentWorkReport
}): React.JSX.Element {
  const diagnostic = workReport.diagnostic
  return (
    <div className="handoff-failure-body">
      <section className="handoff-failure-alert" role="alert">
        <span aria-hidden="true" className="handoff-failure-icon">
          <Icon name="alert" size={17} />
        </span>
        <div>
          <span>Stopped at {workReport.currentStage.label}</span>
          <strong>{specialist} could not finish this review</strong>
          <p>{workReport.why}</p>
        </div>
      </section>

      <div className="handoff-failure-next">
        <span>Next step</span>
        <p>
          {diagnostic?.nextStep ??
            `Ask Syd to retry ${specialist}. If it stops again, open the technical details below.`}
        </p>
      </div>

      {diagnostic && (
        <details className="handoff-diagnostics">
          <summary>
            <span>Technical details</span>
            <Icon name="chevron-down" size={14} />
          </summary>
          <div>
            <dl>
              <div>
                <dt>Code</dt>
                <dd>{diagnostic.code}</dd>
              </div>
              <div>
                <dt>Stage</dt>
                <dd>{diagnostic.stage}</dd>
              </div>
              {diagnostic.model && (
                <div>
                  <dt>AI setup</dt>
                  <dd>{diagnostic.model}</dd>
                </div>
              )}
              <div>
                <dt>Details</dt>
                <dd>{diagnostic.message}</dd>
              </div>
            </dl>
            {workReport.dataSources.length > 0 && (
              <p>
                <strong>Data read:</strong>{' '}
                {workReport.dataSources.map((source) => source.name).join(', ')}
              </p>
            )}
          </div>
        </details>
      )}
    </div>
  )
}

const activityStatusLabel = (status: AgentWorkReport['actions'][number]['status']): string => {
  if (status === 'failed') return 'Failed'
  if (status === 'needs-attention') return 'Needs attention'
  if (status === 'proposed') return 'Proposed'
  return 'Completed'
}

const reportStatusLabel = (status: AgentWorkReport['currentStage']['status']): string => {
  if (status === 'needs-attention') return 'Needs attention'
  return `${status[0].toLocaleUpperCase()}${status.slice(1)}`
}

const confidenceLabel = (report: AgentWorkReport): string => {
  if (report.confidence.score !== undefined) {
    return `${Math.round(report.confidence.score * 100)}% · ${report.confidence.level}`
  }
  return report.confidence.level === 'not-applicable'
    ? 'Not scored'
    : `${report.confidence.level[0].toLocaleUpperCase()}${report.confidence.level.slice(1)}`
}

const approvalLabel = (report: AgentWorkReport): string => {
  if (!report.approval.required) return 'Not required'
  if (report.approval.status === 'approved') return 'Approved'
  if (report.approval.status === 'declined') return 'Declined'
  return 'Required'
}

const approvalPayload = (mission: Mission): Record<string, unknown> | undefined => {
  const payloads = mission.result?.suspendPayload
  return payloads ? Object.values(payloads)[0] : undefined
}

interface ChatToolPart {
  type: string
  state?: string
  input?: unknown
  output?: unknown
  errorText?: string
  approval?: {
    id: string
    approved?: boolean
    reason?: string
  }
}

interface AutomationSummary {
  id: string
  name: string
  ownerSydekykId: Automation['ownerSydekykId']
  status: Automation['status']
  scheduleLabel: string
}

const recordFrom = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined

const odooLookupFailureMessage = (errorText: string | undefined): string => {
  const normalized = errorText?.toLocaleLowerCase() ?? ''
  if (normalized.includes('too_big') && normalized.includes('limit')) {
    return 'The requested result window was larger than the safe lookup limit.'
  }
  if (normalized.includes('not available for business-data reads')) {
    return 'Syd selected an internal Odoo area that is not available for business lookups.'
  }
  return 'The lookup stopped before returning records. Retry it once; if it stops again, check the application logs.'
}

const automationIdsFromInput = (input: unknown): string[] => {
  const automationIds = recordFrom(input)?.automationIds
  return Array.isArray(automationIds)
    ? automationIds.filter((id): id is string => typeof id === 'string')
    : []
}

const automationSummariesFromOutput = (output: unknown): AutomationSummary[] => {
  const value = recordFrom(output)
  const items = value?.automations ?? value?.deleted
  if (!Array.isArray(items)) return []
  return items.flatMap((item) => {
    const automation = recordFrom(item)
    if (
      !automation ||
      typeof automation.id !== 'string' ||
      typeof automation.name !== 'string' ||
      !['nudge', 'mirror', 'shield'].includes(String(automation.ownerSydekykId)) ||
      !['draft', 'active', 'paused', 'error'].includes(String(automation.status)) ||
      typeof automation.scheduleLabel !== 'string'
    ) {
      return []
    }
    return [automation as unknown as AutomationSummary]
  })
}

const normalizedToolType = (type: string): string => type.toLocaleLowerCase().replace(/[^a-z]/g, '')

export function ChatView({
  missions,
  automations,
  emails,
  gadget,
  onChanged,
  ai,
  onOpenGadgets,
  onBusyChange,
  onSessionChanged,
  sessionId
}: {
  missions: Mission[]
  automations: Automation[]
  emails: InboundEmail[]
  gadget: OdooPublicStatus
  onChanged: () => Promise<void>
  ai: AiPublicStatus
  onOpenGadgets: () => void
  onBusyChange: (busy: boolean) => void
  onSessionChanged: () => Promise<void>
  sessionId: string
}): React.JSX.Element {
  const [input, setInput] = useState('')
  const [approvalBusy, setApprovalBusy] = useState<string>()
  const [approvalError, setApprovalError] = useState<string>()
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [recentDocuments, setRecentDocuments] = useState<InboundEmail[]>([])
  const [uploadingFiles, setUploadingFiles] = useState<string[]>([])
  const [uploadError, setUploadError] = useState<string>()
  const [dragging, setDragging] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyError, setHistoryError] = useState<string>()
  const conversationRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const followChatOutput = useRef(true)
  const responseWasBusy = useRef(false)
  const automationRefreshPending = useRef(false)
  const { messages, sendMessage, setMessages, status, error, stop, addToolApprovalResponse } =
    useChat({
      id: sessionId,
      transport: chatTransport,
      sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses
    })
  const knownAutomations = useMemo(() => {
    const known = new Map<string, AutomationSummary>(
      automations.map((automation) => [automation.id, automation])
    )
    for (const message of messages) {
      for (const part of message.parts) {
        if (!part.type.startsWith('tool-')) continue
        const toolPart = part as unknown as ChatToolPart
        for (const automation of automationSummariesFromOutput(toolPart.output)) {
          known.set(automation.id, automation)
        }
      }
    }
    return known
  }, [automations, messages])
  const responding = status === 'submitted' || status === 'streaming'
  const busy = responding || historyLoading
  const intelligenceReady = ai.connected
  const waitingApprovals = missions.filter((mission) => mission.status === 'waiting_approval')
  const chatDocuments = useMemo(() => {
    const documents = [...recentDocuments, ...emails].filter((document) =>
      document.chatSessionIds.includes(sessionId)
    )
    return [...new Map(documents.map((document) => [document.id, document])).values()].sort(
      (a, b) => b.updatedAt.localeCompare(a.updatedAt)
    )
  }, [emails, recentDocuments, sessionId])
  const uploading = uploadingFiles.length > 0
  const hasConversation = messages.length > 0 || chatDocuments.length > 0 || uploading

  useEffect(() => {
    let cancelled = false
    void loadChatSession(sessionId)
      .then((detail) => {
        if (!cancelled) setMessages(detail.messages)
      })
      .catch((cause) => {
        if (!cancelled) setHistoryError(friendlyError(cause, 'Chat history could not be loaded.'))
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false)
      })
    return () => {
      cancelled = true
      void stop()
    }
  }, [sessionId, setMessages, stop])

  useEffect(() => {
    onBusyChange(busy || uploading)
    return () => onBusyChange(false)
  }, [busy, onBusyChange, uploading])

  useEffect(() => {
    if (responding) {
      responseWasBusy.current = true
      return
    }
    if (!responseWasBusy.current) return
    responseWasBusy.current = false
    void onSessionChanged()
    if (automationRefreshPending.current) {
      automationRefreshPending.current = false
      void onChanged()
    }
    const earlyTitleRefresh = window.setTimeout(() => void onSessionChanged(), 1_800)
    const finalTitleRefresh = window.setTimeout(() => void onSessionChanged(), 4_500)
    return () => {
      window.clearTimeout(earlyTitleRefresh)
      window.clearTimeout(finalTitleRefresh)
    }
  }, [onChanged, onSessionChanged, responding])

  useEffect(() => {
    const region = conversationRef.current
    if (region && followChatOutput.current) region.scrollTop = region.scrollHeight
  }, [messages, status])

  const rememberConversationPosition = (): void => {
    const region = conversationRef.current
    if (!region) return
    const distanceFromBottom = region.scrollHeight - region.scrollTop - region.clientHeight
    followChatOutput.current = distanceFromBottom < 96
  }

  const addFiles = (incoming: FileList | File[]): void => {
    setUploadError(undefined)
    const accepted = Array.from(incoming).filter((file) => {
      const extension = file.name.split('.').pop()?.toLocaleLowerCase()
      return (
        ['application/pdf', 'image/png', 'image/jpeg'].includes(file.type) ||
        ['pdf', 'png', 'jpg', 'jpeg'].includes(extension ?? '')
      )
    })
    const tooLarge = accepted.find((file) => file.size > 15 * 1024 * 1024)
    if (tooLarge) {
      setUploadError(`${tooLarge.name} is larger than 15 MB.`)
      return
    }
    if (accepted.length !== Array.from(incoming).length) {
      setUploadError('Ledger accepts PDF, PNG, and JPEG documents.')
    }
    setPendingFiles((current) => {
      const merged = [...current, ...accepted]
      return [
        ...new Map(
          merged.map((file) => [`${file.name}:${file.size}:${file.lastModified}`, file])
        ).values()
      ].slice(0, 5)
    })
  }

  const submit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const text = input.trim()
    if ((!text && pendingFiles.length === 0) || busy || uploading || !intelligenceReady) return
    if (pendingFiles.length === 0) {
      followChatOutput.current = true
      void sendMessage({ text }, { body: { sessionId } })
      setInput('')
      return
    }
    const files = [...pendingFiles]
    setPendingFiles([])
    setUploadingFiles(files.map((file) => file.name))
    setUploadError(undefined)
    setInput('')
    void (async () => {
      try {
        const uploaded: InboundEmail[] = []
        for (const file of files) {
          const result = await uploadChatDocument(file, sessionId, text || undefined)
          uploaded.push(result.document)
        }
        setRecentDocuments((current) => [...uploaded, ...current])
        await onChanged()
      } catch (cause) {
        setUploadError(friendlyError(cause, 'Ledger could not accept the document.'))
        setPendingFiles(files)
      } finally {
        setUploadingFiles([])
      }
    })()
  }

  const sendPrompt = (text: string): void => {
    if (busy || !intelligenceReady) return
    followChatOutput.current = true
    void sendMessage({ text }, { body: { sessionId } })
  }

  const decide = async (mission: Mission, approved: boolean, remember: boolean): Promise<void> => {
    setApprovalBusy(mission.id)
    setApprovalError(undefined)
    try {
      await decideLedgerApproval(mission.id, approved, remember)
      await onChanged()
    } catch (cause) {
      setApprovalError(friendlyError(cause, 'The approval could not be saved.'))
    } finally {
      setApprovalBusy(undefined)
    }
  }

  const decideAutomationDeletion = async (approvalId: string, approved: boolean): Promise<void> => {
    setApprovalBusy(approvalId)
    setApprovalError(undefined)
    if (approved) automationRefreshPending.current = true
    try {
      await addToolApprovalResponse({
        id: approvalId,
        approved,
        reason: approved ? 'Confirmed in Syd chat' : 'Kept by the user',
        options: { body: { sessionId } }
      })
    } catch (cause) {
      automationRefreshPending.current = false
      setApprovalError(friendlyError(cause, 'The automation decision could not be saved.'))
    } finally {
      setApprovalBusy(undefined)
    }
  }

  return (
    <section className="chat-view page-view" aria-labelledby="chat-title">
      <header className="view-header chat-header">
        <div>
          <p className="eyebrow">Your steward</p>
          <h1 id="chat-title">Syd</h1>
          <p>One conversation. The right Sydekyk when you need one.</p>
        </div>
        <div className="agent-presence">
          <span className="presence-orbit">
            <img alt="" src={sydekykPortraits.syd} />
          </span>
          <div>
            <strong>{intelligenceReady ? 'Ready' : 'Setup required'}</strong>
            <span>
              {intelligenceReady
                ? 'Ledger, Nudge, Mirror, and Shield are ready'
                : 'Connect an AI provider'}
            </span>
          </div>
        </div>
      </header>

      <div
        aria-live="polite"
        className="conversation"
        onScroll={rememberConversationPosition}
        ref={conversationRef}
      >
        {historyLoading ? (
          <div className="session-loading" role="status">
            <span className="handoff-pulse" />
            <span>Loading this session…</span>
          </div>
        ) : !hasConversation ? (
          <div className="chat-empty">
            <div className="syd-emblem">
              <img alt="Syd" src={sydekykPortraits.syd} />
            </div>
            <h2>What are we taking care of?</h2>
            <p>
              Syd can hand each mission to the specialist with the right intelligence and Odoo
              scope.
            </p>
            <div className="prompt-grid">
              {prompts.map((prompt) => (
                <button
                  disabled={!intelligenceReady}
                  key={prompt}
                  onClick={() => sendPrompt(prompt)}
                  type="button"
                >
                  <Icon name="chat" size={18} />
                  <span>{prompt}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="message-list">
            {messages.map((message) => (
              <article className={`message-row ${message.role}`} key={message.id}>
                <div className="message-meta">
                  {message.role !== 'user' && <img alt="" src={sydekykPortraits.syd} />}
                  <span>{message.role === 'user' ? 'You' : 'Syd'}</span>
                </div>
                <div className="message-bubble">
                  {message.parts.map((part, index) => {
                    if (part.type === 'text') {
                      return (
                        <div className="markdown" key={`${message.id}-${index}`}>
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{part.text}</ReactMarkdown>
                        </div>
                      )
                    }
                    const toolPart = part as unknown as ChatToolPart
                    if (toolPart.type.startsWith('tool-')) {
                      const toolType = normalizedToolType(toolPart.type)
                      const isAutomationList =
                        toolType.includes('listautomations') ||
                        toolType.includes('listsydautomations')
                      const isAutomationDeletion =
                        toolType.includes('deleteautomations') ||
                        toolType.includes('deletesydautomations')
                      if (isAutomationList || isAutomationDeletion) {
                        const inputIds = automationIdsFromInput(toolPart.input)
                        const outputAutomations = automationSummariesFromOutput(toolPart.output)
                        const targets =
                          outputAutomations.length > 0
                            ? outputAutomations
                            : inputIds.map(
                                (id) =>
                                  knownAutomations.get(id) ?? {
                                    id,
                                    name: id,
                                    ownerSydekykId: 'nudge' as const,
                                    status: 'draft' as const,
                                    scheduleLabel: 'Current schedule'
                                  }
                              )
                        const output = recordFrom(toolPart.output)
                        const requested = toolPart.state === 'approval-requested'
                        const responded = toolPart.state === 'approval-responded'
                        const denied =
                          toolPart.state === 'output-denied' ||
                          (responded && toolPart.approval?.approved === false)
                        const failed = toolPart.state === 'output-error'
                        const completed = toolPart.state === 'output-available'
                        const approvalId = requested ? toolPart.approval?.id : undefined
                        const count = isAutomationList
                          ? Number(output?.totalMatches ?? outputAutomations.length)
                          : Number(output?.deletedCount ?? targets.length)
                        return (
                          <div
                            className={`automation-tool-card${requested ? ' approval-needed' : ''}${failed ? ' failed' : ''}`}
                            key={`${message.id}-${index}`}
                          >
                            <div className="automation-tool-heading">
                              <span className="automation-tool-icon">
                                <Icon name={isAutomationDeletion ? 'trash' : 'clock'} size={17} />
                              </span>
                              <div>
                                <strong>
                                  {isAutomationDeletion
                                    ? requested
                                      ? 'Confirm automation deletion'
                                      : 'Automation deletion'
                                    : 'Automation inventory'}
                                </strong>
                                <span>
                                  {failed
                                    ? 'Syd could not complete this operation'
                                    : denied
                                      ? 'Nothing was removed'
                                      : completed
                                        ? isAutomationDeletion
                                          ? `${count} ${count === 1 ? 'automation' : 'automations'} deleted`
                                          : `${count} matching ${count === 1 ? 'automation' : 'automations'} found`
                                        : responded
                                          ? 'Your decision is being applied'
                                          : requested
                                            ? 'Deletion is paused until you decide'
                                            : isAutomationDeletion
                                              ? 'Preparing the exact deletion set'
                                              : 'Checking current local records'}
                                </span>
                              </div>
                            </div>
                            {isAutomationDeletion && targets.length > 0 && (
                              <ul className="automation-tool-targets">
                                {targets.map((automation) => (
                                  <li key={automation.id}>
                                    <span>{automation.name}</span>
                                    <small>
                                      {automation.ownerSydekykId} · {automation.status}
                                    </small>
                                  </li>
                                ))}
                              </ul>
                            )}
                            {failed && toolPart.errorText && (
                              <p className="automation-tool-error">{toolPart.errorText}</p>
                            )}
                            {requested && approvalId && (
                              <div className="automation-tool-actions">
                                <button
                                  className="ghost-button"
                                  disabled={approvalBusy === approvalId}
                                  onClick={() => void decideAutomationDeletion(approvalId, false)}
                                  type="button"
                                >
                                  Keep automations
                                </button>
                                <button
                                  className="primary-button danger-button"
                                  disabled={approvalBusy === approvalId}
                                  onClick={() => void decideAutomationDeletion(approvalId, true)}
                                  type="button"
                                >
                                  Delete {targets.length === 1 ? 'automation' : 'automations'}
                                </button>
                              </div>
                            )}
                          </div>
                        )
                      }
                      const isOdooBusinessRead =
                        toolType.includes('readodoobusinessdata') ||
                        toolType.includes('readodoobusiness')
                      if (isOdooBusinessRead) {
                        const operation = recordFrom(toolPart.input)?.operation
                        const failed = toolPart.state === 'output-error'
                        const completed = toolPart.state === 'output-available'
                        if (
                          completed &&
                          (operation === 'fieldsGet' ||
                            operation === 'discoverFields' ||
                            operation === 'discoverModels')
                        ) {
                          return null
                        }
                        const records = completed ? odooRecordRefsFromOutput(toolPart.output) : []
                        return (
                          <div
                            className={`odoo-lookup-card${failed ? ' failed' : ''}`}
                            key={`${message.id}-${index}`}
                          >
                            <span className="odoo-lookup-icon" aria-hidden="true">
                              <Icon name={failed ? 'alert' : 'database'} size={16} />
                            </span>
                            <div>
                              <strong>Odoo lookup</strong>
                              <span>
                                {failed
                                  ? 'Syd could not read this Odoo area'
                                  : completed
                                    ? `${records.length} ${records.length === 1 ? 'record' : 'records'} read`
                                    : 'Syd is checking Odoo'}
                              </span>
                            </div>
                            {records.length > 0 && (
                              <div className="odoo-record-links">
                                {records.slice(0, 6).map((record) => (
                                  <OdooRecordLink
                                    gadget={gadget}
                                    key={`${record.model}-${record.id}`}
                                    record={record}
                                  />
                                ))}
                                {records.length > 6 && (
                                  <span className="odoo-record-overflow">
                                    +{records.length - 6} more
                                  </span>
                                )}
                              </div>
                            )}
                            {failed && (
                              <details className="odoo-lookup-error">
                                <summary>Error details</summary>
                                <p>{odooLookupFailureMessage(toolPart.errorText)}</p>
                              </details>
                            )}
                          </div>
                        )
                      }
                      const handoffType = toolPart.type.toLocaleLowerCase()
                      const specialist = handoffType.includes('nudge')
                        ? 'Nudge'
                        : handoffType.includes('mirror')
                          ? 'Mirror'
                          : handoffType.includes('shield')
                            ? 'Shield'
                            : 'Ledger'
                      const failed = toolPart.state === 'output-error'
                      const completed = toolPart.state === 'output-available'
                      const workReport = completed
                        ? workReportFromOutput(toolPart.output)
                        : undefined
                      const reportFailed = workReport?.currentStage.status === 'failed'
                      const handoffFailed = failed || reportFailed
                      const handoffCompleted = completed && !reportFailed
                      const odooRecords = completed ? odooRecordRefsFromOutput(toolPart.output) : []
                      return (
                        <div
                          className={`handoff-card ${specialist.toLocaleLowerCase()}-handoff`}
                          key={`${message.id}-${index}`}
                        >
                          <div className="handoff-heading">
                            <img
                              alt=""
                              className="handoff-portrait"
                              src={portraitFor(specialist)}
                            />
                            <span
                              aria-hidden="true"
                              className={`handoff-status-mark${handoffCompleted ? ' complete' : handoffFailed ? ' failed' : ''}`}
                            >
                              {handoffCompleted && <Icon name="check" size={12} />}
                              {handoffFailed && <Icon name="alert" size={12} />}
                            </span>
                            <div className="handoff-heading-copy">
                              <strong>{specialist} handoff</strong>
                              <span>
                                {handoffFailed
                                  ? `${specialist} stopped before completing the review`
                                  : handoffCompleted
                                    ? `${specialist} reported back`
                                    : `${specialist} is working`}
                              </span>
                            </div>
                          </div>
                          {!completed && !failed && (
                            <div className="handoff-live-stage" role="status">
                              <span>Current stage</span>
                              <strong>{specialist} specialist run</strong>
                              <small>Working</small>
                            </div>
                          )}
                          {odooRecords.length > 0 && (
                            <div className="odoo-record-links" aria-label="Related Odoo records">
                              {odooRecords.slice(0, 6).map((record) => (
                                <OdooRecordLink
                                  gadget={gadget}
                                  key={`${record.model}-${record.id}`}
                                  record={record}
                                />
                              ))}
                              {odooRecords.length > 6 && (
                                <span className="odoo-record-overflow">
                                  +{odooRecords.length - 6} more in Mission Control
                                </span>
                              )}
                            </div>
                          )}
                          {workReport && (
                            <details className="handoff-report">
                              <summary>
                                <span>Specialist report</span>
                                <span className="handoff-report-count">
                                  {reportStatusLabel(workReport.currentStage.status)}
                                </span>
                                <Icon name="chevron-down" size={15} />
                              </summary>
                              <div className="handoff-report-body">
                                {reportFailed ? (
                                  <FailedSpecialistReport
                                    specialist={specialist}
                                    workReport={workReport}
                                  />
                                ) : (
                                  <>
                                    <div className="handoff-report-overview">
                                      <div>
                                        <span>Current stage</span>
                                        <strong>{workReport.currentStage.label}</strong>
                                        <small>
                                          {reportStatusLabel(workReport.currentStage.status)}
                                        </small>
                                      </div>
                                      <div>
                                        <span>Confidence</span>
                                        <strong>{confidenceLabel(workReport)}</strong>
                                        <small>{workReport.confidence.summary}</small>
                                      </div>
                                      <div>
                                        <span>Approval</span>
                                        <strong>{approvalLabel(workReport)}</strong>
                                        <small>{workReport.approval.summary}</small>
                                      </div>
                                    </div>
                                    {workReport.currentStage.detail && (
                                      <p className="handoff-stage-detail">
                                        {workReport.currentStage.detail}
                                      </p>
                                    )}
                                    {workReport.dataSources.length > 0 && (
                                      <section className="handoff-report-section">
                                        <h4>Tools and data sources</h4>
                                        <ul className="handoff-source-list">
                                          {workReport.dataSources.map((source) => (
                                            <li key={`${source.name}-${source.detail ?? ''}`}>
                                              <strong>{source.name}</strong>
                                              {source.detail && <span>{source.detail}</span>}
                                            </li>
                                          ))}
                                        </ul>
                                      </section>
                                    )}
                                    {workReport.facts.length > 0 && (
                                      <section className="handoff-report-section">
                                        <h4>Important facts discovered</h4>
                                        <ul className="handoff-fact-list">
                                          {workReport.facts.map((fact) => (
                                            <li key={fact}>{fact}</li>
                                          ))}
                                        </ul>
                                      </section>
                                    )}
                                    {workReport.actions.length > 0 && (
                                      <section className="handoff-report-section">
                                        <h4>Actions performed or proposed</h4>
                                        <ol className="handoff-activity-list">
                                          {workReport.actions.map((activity) => (
                                            <li key={activity.id}>
                                              <span
                                                aria-hidden="true"
                                                className={`handoff-activity-icon ${activity.status}`}
                                              >
                                                <Icon
                                                  name={
                                                    activity.status === 'completed'
                                                      ? 'check'
                                                      : activity.status === 'proposed'
                                                        ? 'clock'
                                                        : 'alert'
                                                  }
                                                  size={11}
                                                />
                                              </span>
                                              <div>
                                                <strong>{activity.label}</strong>
                                                <span>
                                                  {activity.kind === 'proposed'
                                                    ? 'Proposed'
                                                    : activityStatusLabel(activity.status)}
                                                </span>
                                                {activity.detail && <p>{activity.detail}</p>}
                                              </div>
                                            </li>
                                          ))}
                                        </ol>
                                      </section>
                                    )}
                                    <section className="handoff-report-section handoff-why">
                                      <h4>Why this conclusion?</h4>
                                      <p>{workReport.why}</p>
                                    </section>
                                    {workReport.uncertainties.length > 0 && (
                                      <section className="handoff-report-section handoff-uncertainty">
                                        <h4>Uncertainty and warnings</h4>
                                        <ul className="handoff-fact-list">
                                          {workReport.uncertainties.map((uncertainty) => (
                                            <li key={uncertainty}>{uncertainty}</li>
                                          ))}
                                        </ul>
                                      </section>
                                    )}
                                    <section className="handoff-report-section handoff-final-report">
                                      <h4>Final specialist report</h4>
                                      <div className="markdown">
                                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                          {workReport.finalReport}
                                        </ReactMarkdown>
                                      </div>
                                    </section>
                                  </>
                                )}
                              </div>
                            </details>
                          )}
                        </div>
                      )
                    }
                    return null
                  })}
                </div>
              </article>
            ))}
            {uploading && (
              <div className="ledger-document-thread" role="status">
                <div className="message-row user chat-file-message">
                  <div className="message-meta">
                    <span>You</span>
                  </div>
                  <div className="message-bubble attachment-bubble">
                    <Icon name="paperclip" size={16} />
                    <span>{uploadingFiles.join(', ')}</span>
                  </div>
                </div>
                <div className="handoff-card ledger-upload-handoff">
                  <img alt="" className="handoff-portrait" src={sydekykPortraits.ledger} />
                  <span className="handoff-pulse" />
                  <div>
                    <strong>Ledger handoff</strong>
                    <span>Reading and analyzing your document</span>
                  </div>
                </div>
              </div>
            )}
            {chatDocuments.map((document) => {
              const ledgerMission = missions.find(
                (mission) => mission.id === document.ledgerMissionId
              )
              const odooRecords = odooRecordRefsFromOutput(ledgerMission?.result)
              return (
                <div className="ledger-document-thread" key={document.id}>
                  <div className="message-row user chat-file-message">
                    <div className="message-meta">
                      <span>You</span>
                    </div>
                    <div className="message-bubble attachment-bubble">
                      <Icon name="paperclip" size={16} />
                      <span>{document.attachments[0]?.filename ?? document.subject}</span>
                    </div>
                  </div>
                  <div className="handoff-card ledger-upload-handoff complete">
                    <img alt="" className="handoff-portrait" src={sydekykPortraits.ledger} />
                    <span className="handoff-pulse" />
                    <div>
                      <strong>Ledger handoff</strong>
                      <span>Ledger reported back</span>
                    </div>
                  </div>
                  <LedgerDocumentReviewCard
                    compact
                    document={document}
                    key={document.updatedAt}
                    onChanged={onChanged}
                  />
                  {odooRecords.length > 0 && (
                    <div
                      className="odoo-record-links document-record-links"
                      aria-label="Created Odoo records"
                    >
                      {odooRecords.map((record) => (
                        <OdooRecordLink
                          gadget={gadget}
                          key={`${record.model}-${record.id}`}
                          record={record}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
            {busy && (
              <div className="thinking-row" role="status">
                <span />
                <span />
                <span />
                <span className="sr-only">Syd is thinking</span>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="composer-zone">
        {!intelligenceReady && (
          <div className="ai-setup-banner" role="status">
            <span className="ai-mark">
              <Icon name="sparkles" size={17} />
            </span>
            <div>
              <strong>Choose Syd’s intelligence</strong>
              <span>Connect your OpenAI, Anthropic, Google, or Ollama Cloud API key to begin.</span>
            </div>
            <button className="secondary-button" onClick={onOpenGadgets} type="button">
              Configure AI Gadget
            </button>
          </div>
        )}
        {waitingApprovals.map((mission) => {
          const approval = approvalPayload(mission)
          return (
            <aside className="chat-approval-card" key={mission.id} aria-label="Approval needed">
              <div className="approval-icon">
                <Icon name="shield" />
              </div>
              <div>
                <strong>{String(approval?.title ?? 'Ledger needs approval')}</strong>
                <p>{String(approval?.message ?? mission.summary)}</p>
              </div>
              <div className="approval-actions">
                <button
                  className="ghost-button danger"
                  disabled={approvalBusy === mission.id}
                  onClick={() => void decide(mission, false, false)}
                  type="button"
                >
                  Decline
                </button>
                <button
                  className="secondary-button"
                  disabled={approvalBusy === mission.id}
                  onClick={() => void decide(mission, true, false)}
                  type="button"
                >
                  Allow once
                </button>
                <button
                  className="primary-button"
                  disabled={approvalBusy === mission.id}
                  onClick={() => void decide(mission, true, true)}
                  type="button"
                >
                  Allow & remember
                </button>
              </div>
            </aside>
          )
        })}
        {approvalError && (
          <p className="inline-error" role="alert">
            {approvalError}
          </p>
        )}
        {error && (
          <p className="inline-error" role="alert">
            {friendlyError(error)}
          </p>
        )}
        {historyError && (
          <p className="inline-error" role="alert">
            {historyError}
          </p>
        )}
        {pendingFiles.length > 0 && (
          <ul className="composer-attachments" aria-label="Documents ready to attach">
            {pendingFiles.map((file, index) => (
              <li key={`${file.name}-${file.lastModified}`}>
                <Icon name="document" size={16} />
                <span>{file.name}</span>
                <button
                  aria-label={`Remove ${file.name}`}
                  onClick={() =>
                    setPendingFiles((files) => files.filter((_, fileIndex) => fileIndex !== index))
                  }
                  type="button"
                >
                  <Icon name="close" size={15} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {uploadError && (
          <p className="inline-error" role="alert">
            {uploadError}
          </p>
        )}
        <form
          className={`chat-composer${dragging ? ' dragging' : ''}`}
          onDragEnter={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false)
          }}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault()
            setDragging(false)
            addFiles(event.dataTransfer.files)
          }}
          onSubmit={submit}
        >
          <input
            accept="application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg"
            className="sr-only"
            disabled={!intelligenceReady || uploading}
            multiple
            onChange={(event) => {
              if (event.target.files) addFiles(event.target.files)
              event.target.value = ''
            }}
            ref={fileInputRef}
            tabIndex={-1}
            type="file"
          />
          <button
            aria-label="Attach bill documents"
            className="attach-button"
            disabled={!intelligenceReady || uploading || pendingFiles.length >= 5}
            onClick={() => fileInputRef.current?.click()}
            type="button"
          >
            <Icon name="paperclip" />
          </button>
          <label className="sr-only" htmlFor="chat-input">
            Message Syd
          </label>
          <textarea
            disabled={!intelligenceReady || uploading || historyLoading}
            id="chat-input"
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                event.currentTarget.form?.requestSubmit()
              }
            }}
            placeholder={
              intelligenceReady
                ? 'Message Syd or attach a bill…'
                : 'Connect an AI provider to message Syd'
            }
            rows={1}
            value={input}
          />
          {busy ? (
            <button
              aria-label="Stop response"
              className="send-button"
              onClick={() => void stop()}
              type="button"
            >
              <Icon name="stop" />
            </button>
          ) : (
            <button
              aria-label="Send message"
              className="send-button"
              disabled={
                (!input.trim() && pendingFiles.length === 0) || !intelligenceReady || uploading
              }
              type="submit"
            >
              <Icon name="send" />
            </button>
          )}
        </form>
        <p className="composer-caption">Syd can make mistakes. Review every live Odoo write.</p>
      </div>
    </section>
  )
}
