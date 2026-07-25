import type {
  ApiErrorBody,
  Automation,
  BootstrapData,
  ChatSession,
  ChatSessionDetail,
  InboundEmail,
  InboundReviewPolicy,
  Mission
} from './types'
import type { ServiceConnection } from '../../../shared/ipc'

let serviceConnection: Promise<ServiceConnection> | undefined

export const getServiceConnection = (): Promise<ServiceConnection> => {
  const previewBaseUrl = import.meta.env.DEV
    ? import.meta.env.VITE_SYDEKYKS_PREVIEW_SERVICE_URL
    : undefined
  const previewToken = import.meta.env.DEV
    ? import.meta.env.VITE_SYDEKYKS_PREVIEW_SESSION_TOKEN
    : undefined
  serviceConnection ??=
    previewBaseUrl && previewToken
      ? Promise.resolve({ baseUrl: previewBaseUrl, token: previewToken })
      : window.api.service.getConnection()
  return serviceConnection
}

export const apiRequest = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const connection = await getServiceConnection()
  const response = await fetch(`${connection.baseUrl}${path}`, {
    ...init,
    headers: {
      ...(init?.body && !(init.body instanceof FormData)
        ? { 'content-type': 'application/json' }
        : {}),
      authorization: `Bearer ${connection.token}`,
      ...init?.headers
    }
  })
  const payload = (await response.json()) as T & ApiErrorBody
  if (!response.ok)
    throw new Error(payload.error ?? `Sydekyks service responded with ${response.status}`)
  return payload
}

export const loadBootstrap = (): Promise<BootstrapData> =>
  apiRequest<BootstrapData>('/sydekyks/bootstrap')

export const listChatSessions = (): Promise<{ sessions: ChatSession[] }> =>
  apiRequest('/sydekyks/chat/sessions')

export const createChatSession = (): Promise<ChatSession> =>
  apiRequest('/sydekyks/chat/sessions', { method: 'POST' })

export const loadChatSession = (sessionId: string): Promise<ChatSessionDetail> =>
  apiRequest(`/sydekyks/chat/sessions/${encodeURIComponent(sessionId)}`)

export const deleteChatSession = (sessionId: string): Promise<{ deleted: boolean }> =>
  apiRequest(`/sydekyks/chat/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' })

export const clearChatSessions = (): Promise<{ deleted: number; session: ChatSession }> =>
  apiRequest('/sydekyks/chat/sessions', { method: 'DELETE' })

export const startLedgerBill = (input: Record<string, unknown>): Promise<Mission> =>
  apiRequest<Mission>('/sydekyks/workflows/ledger/vendor-bill', {
    method: 'POST',
    body: JSON.stringify(input)
  })

export const decideLedgerApproval = (
  missionId: string,
  approved: boolean,
  remember: boolean
): Promise<Mission> =>
  apiRequest<Mission>(`/sydekyks/workflows/ledger/vendor-bill/${missionId}/resume`, {
    method: 'POST',
    body: JSON.stringify({ approved, remember })
  })

export const acknowledgeMissionNotifications = (
  missionIds: string[]
): Promise<{ acknowledged: number }> =>
  apiRequest('/sydekyks/missions/acknowledge', {
    method: 'POST',
    body: JSON.stringify({ missionIds })
  })

export const createSampleInboundEmail = (): Promise<{
  email: InboundEmail
  duplicate: boolean
}> =>
  apiRequest('/sydekyks/inbound-email/sample', {
    method: 'POST'
  })

export const reviewInboundEmail = (
  emailId: string,
  input: Record<string, unknown>
): Promise<{ email: InboundEmail; mission: Mission }> =>
  apiRequest(`/sydekyks/inbound-email/${emailId}/review`, {
    method: 'POST',
    body: JSON.stringify(input)
  })

export const reanalyzeInboundEmail = (emailId: string): Promise<InboundEmail> =>
  apiRequest(`/sydekyks/inbound-email/${emailId}/analyze`, {
    method: 'POST'
  })

export const uploadChatDocument = (
  file: File,
  sessionId: string,
  note?: string
): Promise<{ document: InboundEmail; duplicate: boolean }> => {
  const body = new FormData()
  body.append('file', file)
  body.append('sessionId', sessionId)
  if (note?.trim()) body.append('note', note.trim())
  return apiRequest('/sydekyks/chat/documents', { method: 'POST', body })
}

export const updateInboundReviewPolicy = (
  sydekykId: string,
  policy: InboundReviewPolicy
): Promise<InboundReviewPolicy> =>
  apiRequest(`/sydekyks/${sydekykId}/inbound-policy`, {
    method: 'POST',
    body: JSON.stringify(policy)
  })

export interface AutomationInput {
  name: string
  sidekickId: string
  prompt: string
  trigger: Automation['trigger']
  approvalMode: Automation['approvalMode']
  missedRunPolicy: Automation['missedRunPolicy']
  status: 'draft' | 'active'
}

export const createAutomation = (input: AutomationInput): Promise<Automation> =>
  apiRequest('/sydekyks/automations', {
    method: 'POST',
    body: JSON.stringify(input)
  })

export const updateAutomation = (
  automationId: string,
  input: Partial<AutomationInput>
): Promise<Automation> =>
  apiRequest(`/sydekyks/automations/${automationId}`, {
    method: 'PATCH',
    body: JSON.stringify(input)
  })

export const setAutomationStatus = (
  automationId: string,
  status: 'active' | 'paused'
): Promise<Automation> =>
  apiRequest(`/sydekyks/automations/${automationId}/status`, {
    method: 'POST',
    body: JSON.stringify({ status })
  })

export const runAutomationNow = (automationId: string): Promise<Mission> =>
  apiRequest(`/sydekyks/automations/${automationId}/run`, { method: 'POST' })

export const deleteAutomation = (automationId: string): Promise<{ deleted: boolean }> =>
  apiRequest(`/sydekyks/automations/${automationId}`, { method: 'DELETE' })
