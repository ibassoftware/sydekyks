import type { AiPublicStatus, ImapPublicStatus, OdooPublicStatus } from '../../../shared/ipc'
import type { UIMessage } from 'ai'

export type ViewId = 'chat' | 'missions' | 'roster' | 'gadgets'

export interface ChatSession {
  id: string
  title: string
  titlePending: boolean
  createdAt: string
  updatedAt: string
}

export interface ChatSessionDetail {
  session: ChatSession
  messages: UIMessage[]
}

export interface RosterMember {
  id: string
  name: string
  role: string
  mode: 'companion-operator' | 'companion-only' | 'automation-only'
  kind: 'agent' | 'workflow' | 'hybrid'
  status: string
  description: string
  capabilities: string[]
  gadgets: string[]
  requiredGadgets: string[]
  capabilityGrants: Array<{
    gadget: string
    operations: Array<'read' | 'search' | 'create' | 'write'>
    models?: string[]
  }>
  intelligence: Array<{
    id: string
    purpose: 'classify' | 'extract' | 'recommend' | 'diagnose' | 'synthesize'
    outputSchema: string
    promptVersion: string
    required: true
    reviewBelowConfidence?: number
    allowedCandidateKinds?: string[]
  }>
  triggers: Array<'chat' | 'email' | 'schedule'>
  workflowIds: string[]
  automationCount: number
  inboundPolicy?: InboundReviewPolicy
}

export interface InboundReviewPolicy {
  reviewMode: 'always' | 'when-uncertain' | 'automatic'
  confidenceThreshold: number
}

export type AutomationSchedule =
  | {
      kind: 'interval'
      every: number
      unit: 'days' | 'weeks'
      time: string
      timezone: string
      anchorAt: string
    }
  | {
      kind: 'calendar'
      daysOfWeek: number[]
      time: string
      timezone: string
    }

export interface Automation {
  id: string
  name: string
  ownerSydekykId: 'nudge' | 'mirror' | 'shield'
  workflowId: 'nudge-stale-opportunities' | 'mirror-duplicate-bills' | 'shield-fraud-review'
  schedule: AutomationSchedule
  inputData: {
    staleAfterDays?: number
    lookbackDays?: number
    limit: number
    notifyOnlyWhenAttention: boolean
  }
  missedRunPolicy: 'skip' | 'run-on-start'
  status: 'draft' | 'active' | 'paused' | 'error'
  scheduleLabel: string
  nextRunAt?: string
  lastRunAt?: string
  lastMissionId?: string
  lastError?: string
  createdAt: string
  updatedAt: string
}

export interface Mission {
  id: string
  kind: string
  sydekyk: string
  title: string
  summary: string
  status: 'running' | 'needs_attention' | 'waiting_approval' | 'completed' | 'declined' | 'failed'
  runId?: string
  payload?: Record<string, unknown>
  result?: {
    status?: string
    error?: string
    diagnostic?: {
      code: string
      stage: string
      message: string
      nextStep: string
      model?: string
    }
    result?: Record<string, unknown>
    suspendPayload?: Record<string, Record<string, unknown>>
  }
  acknowledgedAt?: string
  createdAt: string
  updatedAt: string
}

export interface Permission {
  id: string
  capability: string
  scope: string
  granted: boolean
  updatedAt: string
}

export interface InboundAttachment {
  id: string
  filename: string
  contentType: string
  size: number
  sha256: string
  localPath: string
  textExtracted: boolean
}

export interface BillDocumentIntelligence {
  source: 'llm'
  model?: string
  isBill: boolean
  documentType: 'vendor_bill' | 'credit_note' | 'receipt' | 'statement' | 'not_a_bill' | 'unknown'
  confidence: number
  rationale: string
  evidence: string[]
  warnings: string[]
  fieldConfidence: Record<string, number | undefined>
  lineItems: Array<{
    description: string
    quantity?: number
    unitPrice?: number
    netAmount?: number
    taxLabel?: string
  }>
  taxClues: string[]
}

export interface InboundEmail {
  id: string
  sourceType: 'email' | 'chat'
  chatSessionIds: string[]
  messageId?: string
  sourcePath?: string
  mailbox: string
  uid?: number
  fromAddress: string
  fromName?: string
  subject: string
  status:
    | 'needs_review'
    | 'processing'
    | 'waiting_approval'
    | 'completed'
    | 'declined'
    | 'failed'
    | 'not_bill'
    | 'ai_required'
  reviewMissionId?: string
  ledgerMissionId?: string
  attachments: InboundAttachment[]
  extracted: Partial<{
    vendorName: string
    invoiceNumber: string
    invoiceDate: string
    currency: string
    untaxedAmount: number
    taxAmount: number
    totalAmount: number
    description: string
    accountHint: string
    taxHint: string
    lineItemHints: string[]
  }>
  intelligence?: BillDocumentIntelligence
  missingFields: string[]
  error?: string
  receivedAt: string
  processedAt?: string
  createdAt: string
  updatedAt: string
}

export interface BootstrapData {
  app: { name: string; steward: string; localUser: boolean }
  ai: AiPublicStatus
  gadget: OdooPublicStatus
  imap: ImapPublicStatus
  emails: InboundEmail[]
  roster: RosterMember[]
  automations: Automation[]
  missions: Mission[]
  permissions: Permission[]
}

export interface ApiErrorBody {
  error?: string
  details?: unknown
}
