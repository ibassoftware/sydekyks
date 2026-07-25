import { z } from 'zod'
import { aiProviderModels } from '../../shared/ipc'
import { isOpenAiLlmModelId } from '../../shared/openai-models'

export const aiCredentialSchema = z.discriminatedUnion('provider', [
  z.object({
    provider: z.literal('openai'),
    model: z
      .string()
      .trim()
      .min(2)
      .max(200)
      .refine(isOpenAiLlmModelId, 'Choose an OpenAI text-generation model'),
    apiKey: z.string().trim().min(10)
  }),
  z.object({
    provider: z.literal('anthropic'),
    model: z.enum(aiProviderModels.anthropic),
    apiKey: z.string().trim().min(10)
  }),
  z.object({
    provider: z.literal('google'),
    model: z.enum(aiProviderModels.google),
    apiKey: z.string().trim().min(10)
  }),
  z.object({
    provider: z.literal('ollama-cloud'),
    model: z.enum(aiProviderModels['ollama-cloud']),
    apiKey: z.string().trim().min(10)
  })
])

export type AiCredentials = z.infer<typeof aiCredentialSchema>

export const aiPublicStatusSchema = z.object({
  configured: z.boolean(),
  connected: z.boolean(),
  label: z.string(),
  provider: z.enum(['openai', 'anthropic', 'google', 'ollama-cloud']).optional(),
  model: z.string().optional(),
  connectedAt: z.string().optional(),
  lastError: z.string().optional()
})

export type AiPublicStatus = z.infer<typeof aiPublicStatusSchema>

export const odooCredentialSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('demo')
  }),
  z.object({
    mode: z.literal('live'),
    url: z
      .string()
      .url()
      .refine((value) => ['http:', 'https:'].includes(new URL(value).protocol), {
        message: 'Odoo URL must use http or https'
      }),
    database: z.string().min(1),
    username: z.string().min(1),
    secret: z.string().min(1),
    companyId: z.number().int().positive().optional(),
    liveWrites: z.boolean().default(false)
  })
])

export type OdooCredentials = z.infer<typeof odooCredentialSchema>

export const odooPublicStatusSchema = z.object({
  mode: z.enum(['demo', 'live']),
  connected: z.boolean(),
  label: z.string(),
  url: z.string().optional(),
  database: z.string().optional(),
  username: z.string().optional(),
  companyId: z.number().optional(),
  liveWrites: z.boolean(),
  connectedAt: z.string().optional(),
  serverVersion: z.string().optional()
})

export type OdooPublicStatus = z.infer<typeof odooPublicStatusSchema>

export const imapCredentialSchema = z.object({
  host: z.string().trim().min(1),
  port: z.number().int().min(1).max(65_535),
  secure: z.boolean().default(true),
  username: z.string().trim().min(1),
  password: z.string().min(1),
  mailbox: z.string().trim().min(1).default('INBOX'),
  pollIntervalMinutes: z.number().int().min(1).max(1_440).default(5),
  processedMailbox: z.string().trim().min(1).default('Sydekyks/Processed')
})

export type ImapCredentials = z.infer<typeof imapCredentialSchema>

export const imapPublicStatusSchema = z.object({
  configured: z.boolean(),
  connected: z.boolean(),
  syncing: z.boolean(),
  label: z.string(),
  host: z.string().optional(),
  port: z.number().optional(),
  secure: z.boolean().optional(),
  username: z.string().optional(),
  mailbox: z.string().optional(),
  pollIntervalMinutes: z.number().optional(),
  processedMailbox: z.string().optional(),
  connectedAt: z.string().optional(),
  lastSyncedAt: z.string().optional(),
  lastError: z.string().optional()
})

export type ImapPublicStatus = z.infer<typeof imapPublicStatusSchema>

export const odooDomainSchema = z.array(
  z.union([z.tuple([z.string(), z.string(), z.unknown()]), z.string()])
)

export const genericOdooRequestSchema = z.object({
  operation: z.enum(['fieldsGet', 'search', 'read', 'searchRead', 'create', 'write']),
  model: z.string().min(3),
  domain: odooDomainSchema.optional(),
  ids: z.array(z.number().int().positive()).optional(),
  fields: z.array(z.string().min(1)).optional(),
  values: z.record(z.string(), z.unknown()).optional(),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
  confirmWrite: z.boolean().default(false)
})

export type GenericOdooRequest = z.infer<typeof genericOdooRequestSchema>

export const ledgerBillInputSchema = z
  .object({
    vendorName: z.string().min(2),
    invoiceNumber: z.string().min(1),
    invoiceDate: z.string().date(),
    currency: z
      .string()
      .length(3)
      .transform((value) => value.toUpperCase()),
    untaxedAmount: z.number().nonnegative(),
    taxAmount: z.number().nonnegative(),
    totalAmount: z.number().positive(),
    description: z.string().min(2),
    accountHint: z.string().optional(),
    taxHint: z.string().max(300).optional(),
    lineItemHints: z.array(z.string().min(1).max(500)).max(50).optional(),
    confirmWrite: z.boolean().default(false)
  })
  .superRefine((value, context) => {
    const expected = Number((value.untaxedAmount + value.taxAmount).toFixed(2))
    if (Math.abs(expected - value.totalAmount) > 0.01) {
      context.addIssue({
        code: 'custom',
        message: `Total must equal untaxed amount plus tax (${expected.toFixed(2)})`,
        path: ['totalAmount']
      })
    }
  })

export type LedgerBillInput = z.infer<typeof ledgerBillInputSchema>

export const partialLedgerBillSchema = z.object({
  vendorName: z.string().optional(),
  invoiceNumber: z.string().optional(),
  invoiceDate: z.string().optional(),
  currency: z.string().optional(),
  untaxedAmount: z.number().optional(),
  taxAmount: z.number().optional(),
  totalAmount: z.number().optional(),
  description: z.string().optional(),
  accountHint: z.string().optional(),
  taxHint: z.string().optional(),
  lineItemHints: z.array(z.string()).optional()
})

export type PartialLedgerBill = z.infer<typeof partialLedgerBillSchema>

export const billDocumentTypeSchema = z.enum([
  'vendor_bill',
  'credit_note',
  'receipt',
  'statement',
  'not_a_bill',
  'unknown'
])

export const billFieldConfidenceSchema = z.object({
  vendorName: z.number().min(0).max(1).optional(),
  invoiceNumber: z.number().min(0).max(1).optional(),
  invoiceDate: z.number().min(0).max(1).optional(),
  currency: z.number().min(0).max(1).optional(),
  untaxedAmount: z.number().min(0).max(1).optional(),
  taxAmount: z.number().min(0).max(1).optional(),
  totalAmount: z.number().min(0).max(1).optional(),
  description: z.number().min(0).max(1).optional(),
  accountHint: z.number().min(0).max(1).optional(),
  taxHint: z.number().min(0).max(1).optional()
})

export const billLineInsightSchema = z.object({
  description: z.string(),
  quantity: z.number().optional(),
  unitPrice: z.number().optional(),
  netAmount: z.number().optional(),
  taxLabel: z.string().optional()
})

const billDocumentExtractedModelSchema = z.object({
  vendorName: z.string().nullable().optional(),
  invoiceNumber: z.string().nullable().optional(),
  invoiceDate: z.string().nullable().optional(),
  currency: z.string().nullable().optional(),
  untaxedAmount: z.number().nullable().optional(),
  taxAmount: z.number().nullable().optional(),
  totalAmount: z.number().nullable().optional(),
  description: z.string().nullable().optional(),
  accountHint: z.string().nullable().optional(),
  taxHint: z.string().nullable().optional(),
  lineItemHints: z.array(z.string()).nullable().optional()
})

const billFieldConfidenceModelSchema = z.object({
  vendorName: z.number().min(0).max(1).nullable().optional(),
  invoiceNumber: z.number().min(0).max(1).nullable().optional(),
  invoiceDate: z.number().min(0).max(1).nullable().optional(),
  currency: z.number().min(0).max(1).nullable().optional(),
  untaxedAmount: z.number().min(0).max(1).nullable().optional(),
  taxAmount: z.number().min(0).max(1).nullable().optional(),
  totalAmount: z.number().min(0).max(1).nullable().optional(),
  description: z.number().min(0).max(1).nullable().optional(),
  accountHint: z.number().min(0).max(1).nullable().optional(),
  taxHint: z.number().min(0).max(1).nullable().optional()
})

const billLineInsightModelSchema = z.object({
  description: z.string(),
  quantity: z.number().nullable().optional(),
  unitPrice: z.number().nullable().optional(),
  netAmount: z.number().nullable().optional(),
  taxLabel: z.string().nullable().optional()
})

export const billDocumentModelOutputSchema = z.object({
  isBill: z.boolean(),
  documentType: billDocumentTypeSchema,
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
  evidence: z.array(z.string()).max(24),
  warnings: z.array(z.string()).max(24),
  extracted: billDocumentExtractedModelSchema,
  fieldConfidence: billFieldConfidenceModelSchema,
  lineItems: z.array(billLineInsightModelSchema).max(50),
  taxClues: z.array(z.string()).max(24)
})

export const billDocumentIntelligenceSchema = billDocumentModelOutputSchema
  .omit({ extracted: true })
  .extend({
    fieldConfidence: billFieldConfidenceSchema,
    lineItems: z.array(billLineInsightSchema).max(50),
    source: z.literal('llm'),
    model: z.string().optional()
  })

export type BillDocumentIntelligence = z.infer<typeof billDocumentIntelligenceSchema>

export const accountingIntelligenceModelOutputSchema = z.object({
  account: z.object({
    accountId: z.number().int().positive().nullable(),
    confidence: z.number().min(0).max(1),
    rationale: z.string(),
    matchedHistory: z.boolean(),
    priorAccountIds: z.array(z.number().int().positive()).max(20),
    reviewRecommended: z.boolean()
  }),
  tax: z.object({
    taxId: z.number().int().positive().nullable(),
    confidence: z.number().min(0).max(1),
    rationale: z.string(),
    createRecommended: z.boolean(),
    reviewRecommended: z.boolean()
  }),
  observations: z.array(z.string()).max(24)
})

export const accountingIntelligenceSchema = accountingIntelligenceModelOutputSchema.extend({
  source: z.literal('llm'),
  model: z.string().optional()
})

export type AccountingIntelligence = z.infer<typeof accountingIntelligenceSchema>

export const writeRecoveryModelOutputSchema = z.object({
  action: z.enum(['retry', 'needs_user', 'stop']),
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
  missingFields: z.array(z.string()).max(20),
  patch: z.object({
    journalId: z.number().int().positive().optional(),
    currencyId: z.number().int().positive().optional(),
    companyId: z.number().int().positive().optional()
  }),
  warnings: z.array(z.string()).max(12)
})

export const writeRecoveryIntelligenceSchema = writeRecoveryModelOutputSchema.extend({
  source: z.literal('llm'),
  model: z.string().optional(),
  attemptedRetry: z.boolean(),
  retrySucceeded: z.boolean().optional()
})

export type WriteRecoveryIntelligence = z.infer<typeof writeRecoveryIntelligenceSchema>

export const approvalDecisionSchema = z.object({
  approved: z.boolean(),
  remember: z.boolean().default(false)
})

export type ApprovalDecision = z.infer<typeof approvalDecisionSchema>

const validTimezone = (value: string): boolean => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format()
    return true
  } catch {
    return false
  }
}

export const timeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm')
export const timezoneSchema = z.string().min(1).refine(validTimezone, 'Use an IANA timezone')

export const automationScheduleSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('interval'),
    every: z.number().int().min(1).max(365),
    unit: z.enum(['days', 'weeks']),
    time: timeOfDaySchema,
    timezone: timezoneSchema,
    anchorAt: z.string().datetime({ offset: true })
  }),
  z.object({
    kind: z.literal('calendar'),
    daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    time: timeOfDaySchema,
    timezone: timezoneSchema
  })
])

export type AutomationSchedule = z.infer<typeof automationScheduleSchema>

export const sidekickOperationSchema = z.enum(['read', 'create', 'update', 'archive'])
export type SidekickOperation = z.infer<typeof sidekickOperationSchema>

export const sidekickStatusSchema = z.enum(['active', 'paused'])
export type SidekickStatus = z.infer<typeof sidekickStatusSchema>

export const sidekickCreateSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().min(8).max(500),
  instructions: z.string().trim().min(40).max(30_000),
  status: sidekickStatusSchema.default('active')
})

export const sidekickUpdateSchema = sidekickCreateSchema
  .partial()
  .refine((input) => Object.keys(input).length > 0, 'Provide at least one change')

export const sidekickCapabilitySchema = z.object({
  model: z.string().trim().min(2).max(120),
  label: z.string().trim().min(2).max(120),
  operations: z.array(sidekickOperationSchema).min(1).max(4)
})

export interface SidekickCapability {
  model: string
  label: string
  operations: SidekickOperation[]
}

export interface SidekickRecord {
  id: string
  name: string
  description: string
  instructions: string
  source: 'preset' | 'user'
  status: SidekickStatus
  version: number
  contentHash: string
  capabilities: SidekickCapability[]
  createdAt: string
  updatedAt: string
}

export const automationTriggerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('manual') }),
  z.object({ kind: z.literal('schedule'), schedule: automationScheduleSchema }),
  z.object({
    kind: z.literal('email'),
    mailbox: z.string().trim().min(1).max(200).default('INBOX'),
    fromContains: z.string().trim().min(1).max(200).optional(),
    subjectContains: z.string().trim().min(1).max(200).optional()
  })
])

export type AutomationTrigger = z.infer<typeof automationTriggerSchema>

export const automationSpecCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  sidekickId: z.string().trim().min(2).max(80),
  prompt: z.string().trim().min(10).max(10_000),
  trigger: automationTriggerSchema,
  approvalMode: z.enum(['read-only', 'approval-required']).default('read-only'),
  status: z.enum(['draft', 'active']).default('draft'),
  missedRunPolicy: z.enum(['skip', 'run-on-start']).default('run-on-start')
})

export const automationSpecUpdateSchema = automationSpecCreateSchema
  .omit({ sidekickId: true })
  .partial()
  .extend({
    status: z.enum(['draft', 'active', 'paused']).optional(),
    repinSidekick: z.boolean().optional()
  })
  .refine((input) => Object.keys(input).length > 0, 'Provide at least one change')

export type AutomationSpecCreateInput = z.infer<typeof automationSpecCreateSchema>
export type AutomationSpecUpdateInput = z.infer<typeof automationSpecUpdateSchema>
export type AutomationSpecStatus = 'draft' | 'active' | 'paused' | 'error'

export interface AutomationSpecRecord {
  id: string
  name: string
  sidekickId: string
  sidekickName: string
  sidekickVersion: number
  prompt: string
  trigger: AutomationTrigger
  approvalMode: 'read-only' | 'approval-required'
  status: AutomationSpecStatus
  missedRunPolicy: 'skip' | 'run-on-start'
  triggerLabel: string
  schemaFingerprint?: string
  nextRunAt?: string
  lastRunAt?: string
  lastMissionId?: string
  lastError?: string
  createdAt: string
  updatedAt: string
}

export type MissionStatus =
  'running' | 'needs_attention' | 'waiting_approval' | 'completed' | 'declined' | 'failed'

export interface MissionRecord {
  id: string
  kind: string
  sydekyk: string
  title: string
  summary: string
  status: MissionStatus
  runId?: string
  payload?: unknown
  result?: unknown
  acknowledgedAt?: string
  createdAt: string
  updatedAt: string
}

export interface PermissionRecord {
  id: string
  capability: string
  scope: string
  granted: boolean
  createdAt: string
  updatedAt: string
}

export type InboundEmailStatus =
  | 'needs_review'
  | 'processing'
  | 'waiting_approval'
  | 'completed'
  | 'declined'
  | 'failed'
  | 'not_bill'
  | 'ai_required'

export interface InboundAttachment {
  id: string
  filename: string
  contentType: string
  size: number
  sha256: string
  localPath: string
  textExtracted: boolean
}

export interface InboundEmailRecord {
  id: string
  sourceType: 'email' | 'chat'
  chatSessionIds: string[]
  messageId?: string
  sourceHash: string
  sourcePath?: string
  mailbox: string
  uid?: number
  fromAddress: string
  fromName?: string
  subject: string
  status: InboundEmailStatus
  reviewMissionId?: string
  ledgerMissionId?: string
  attachments: InboundAttachment[]
  extracted: PartialLedgerBill
  intelligence?: BillDocumentIntelligence
  missingFields: string[]
  error?: string
  receivedAt: string
  processedAt?: string
  createdAt: string
  updatedAt: string
}
