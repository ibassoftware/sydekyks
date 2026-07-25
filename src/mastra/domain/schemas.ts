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

export const nudgeCheckInputSchema = z.object({
  source: z.enum(['chat', 'schedule', 'mission-control']).default('mission-control'),
  staleAfterDays: z.number().int().min(1).max(365).default(2),
  limit: z.number().int().min(1).max(100).default(50),
  notifyOnlyWhenAttention: z.boolean().default(true),
  automationId: z.string().uuid().optional(),
  scheduledFor: z.string().datetime({ offset: true }).optional()
})

export type NudgeCheckInput = z.infer<typeof nudgeCheckInputSchema>

export const nudgeActivityFactSchema = z.object({
  id: z.number().int().positive(),
  deadline: z.string().optional(),
  state: z.string().optional(),
  type: z.string().optional(),
  summary: z.string().optional(),
  owner: z.string().optional()
})

export const nudgeMessageFactSchema = z.object({
  id: z.number().int().positive(),
  date: z.string().optional(),
  subject: z.string().optional(),
  author: z.string().optional(),
  emailFrom: z.string().optional(),
  bodyPreview: z.string().optional()
})

export const nudgeOpportunityFactSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  stage: z.string(),
  owner: z.string().optional(),
  expectedRevenue: z.number().optional(),
  probability: z.number().min(0).max(100).optional(),
  lastUpdatedAt: z.string().optional(),
  stageChangedAt: z.string().optional(),
  daysSinceUpdate: z.number().nonnegative().optional(),
  lastMeaningfulMessageAt: z.string().optional(),
  daysSinceLastMessage: z.number().nonnegative().optional(),
  nextActivityAt: z.string().optional(),
  hasOpenActivity: z.boolean(),
  overdueActivityCount: z.number().int().nonnegative(),
  activities: z.array(nudgeActivityFactSchema),
  messages: z.array(nudgeMessageFactSchema)
})

export type NudgeOpportunityFact = z.infer<typeof nudgeOpportunityFactSchema>

export const nudgeAssessmentModelOutputSchema = z.object({
  summary: z.string(),
  opportunities: z
    .array(
      z.object({
        opportunityId: z.number().int().positive(),
        opportunityName: z.string(),
        stale: z.boolean(),
        priority: z.enum(['high', 'medium', 'low', 'healthy']),
        confidence: z.number().min(0).max(1),
        staleSince: z.string().nullable(),
        reasons: z.array(z.string()).min(1).max(8),
        recommendedAction: z.string()
      })
    )
    .max(100)
})

export const nudgeAssessmentSchema = nudgeAssessmentModelOutputSchema.extend({
  source: z.literal('llm'),
  model: z.string().optional(),
  checkedAt: z.string().datetime({ offset: true })
})

export type NudgeAssessment = z.infer<typeof nudgeAssessmentSchema>

export const nudgeResultSchema = z.object({
  outcome: z.enum(['completed', 'no-opportunities']),
  message: z.string(),
  totalChecked: z.number().int().nonnegative(),
  attentionCount: z.number().int().nonnegative(),
  assessment: nudgeAssessmentSchema.optional()
})

export type NudgeResult = z.infer<typeof nudgeResultSchema>

const sydekykRunSourceSchema = z
  .enum(['chat', 'schedule', 'mission-control'])
  .default('mission-control')

export const accountsPayableLineFactSchema = z.object({
  id: z.number().int().positive(),
  description: z.string().optional(),
  quantity: z.number().optional(),
  unitPrice: z.number().optional(),
  subtotal: z.number().optional(),
  account: z.string().optional()
})

export const accountsPayableBillFactSchema = z.object({
  id: z.number().int().positive(),
  number: z.string(),
  reference: z.string().optional(),
  moveType: z.enum(['in_invoice', 'in_refund']),
  partnerId: z.number().int().positive(),
  partnerName: z.string(),
  taxIdFingerprint: z.string().optional(),
  bankFingerprints: z.array(z.string()).max(20),
  invoiceDate: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  state: z.string(),
  paymentState: z.string().optional(),
  currency: z.string().optional(),
  amountUntaxed: z.number().optional(),
  amountTotal: z.number(),
  lines: z.array(accountsPayableLineFactSchema).max(50)
})

export type AccountsPayableBillFact = z.infer<typeof accountsPayableBillFactSchema>

export const mirrorScanInputSchema = z.object({
  source: sydekykRunSourceSchema,
  lookbackDays: z.number().int().min(1).max(1_825).default(365),
  limit: z.number().int().min(2).max(100).default(50),
  notifyOnlyWhenAttention: z.boolean().default(true),
  automationId: z.string().uuid().optional(),
  scheduledFor: z.string().datetime({ offset: true }).optional()
})

export type MirrorScanInput = z.infer<typeof mirrorScanInputSchema>

export const mirrorScreeningModelOutputSchema = z.object({
  summary: z.string(),
  candidates: z
    .array(
      z.object({
        billIds: z.tuple([z.number().int().positive(), z.number().int().positive()]),
        signals: z
          .array(
            z.enum([
              'reference_collision',
              'same_vendor_amount_date',
              'shared_tax_id',
              'shared_bank_account',
              'resubmission_pattern',
              'other'
            ])
          )
          .min(1)
          .max(6),
        confidence: z.number().min(0).max(1),
        rationale: z.string()
      })
    )
    .max(60),
  warnings: z.array(z.string()).max(16)
})

export const mirrorConfirmationModelOutputSchema = z.object({
  summary: z.string(),
  pairs: z
    .array(
      z.object({
        billIds: z.tuple([z.number().int().positive(), z.number().int().positive()]),
        verdict: z.enum(['likely_duplicate', 'possible_duplicate', 'not_duplicate']),
        priority: z.enum(['high', 'medium', 'low', 'clear']),
        confidence: z.number().min(0).max(1),
        rationale: z.string(),
        evidence: z.array(z.string()).min(1).max(10),
        recommendedAction: z.string(),
        warnings: z.array(z.string()).max(10)
      })
    )
    .max(60)
})

export const mirrorAssessmentSchema = mirrorConfirmationModelOutputSchema.extend({
  source: z.literal('llm'),
  model: z.string().optional(),
  promptVersion: z.literal('mirror-confirm-v1'),
  checkedAt: z.string().datetime({ offset: true }),
  screening: z.object({
    promptVersion: z.literal('mirror-screen-v1'),
    summary: z.string(),
    candidateCount: z.number().int().nonnegative(),
    warnings: z.array(z.string()).max(16)
  })
})

export type MirrorAssessment = z.infer<typeof mirrorAssessmentSchema>

export const mirrorResultSchema = z.object({
  outcome: z.enum(['completed', 'not-enough-bills', 'no-candidates']),
  message: z.string(),
  totalBills: z.number().int().nonnegative(),
  candidateCount: z.number().int().nonnegative(),
  alertCount: z.number().int().nonnegative(),
  assessment: mirrorAssessmentSchema.optional()
})

export type MirrorResult = z.infer<typeof mirrorResultSchema>

export const shieldVendorChangeFactSchema = z.object({
  id: z.string(),
  partnerId: z.number().int().positive(),
  partnerName: z.string(),
  changedAt: z.string().optional(),
  field: z.string(),
  previousValue: z.string().optional(),
  currentValue: z.string().optional(),
  author: z.string().optional(),
  source: z.enum(['tracking', 'record-metadata'])
})

export type ShieldVendorChangeFact = z.infer<typeof shieldVendorChangeFactSchema>

export const shieldScanInputSchema = z.object({
  source: sydekykRunSourceSchema,
  lookbackDays: z.number().int().min(1).max(1_825).default(90),
  limit: z.number().int().min(1).max(100).default(50),
  notifyOnlyWhenAttention: z.boolean().default(true),
  automationId: z.string().uuid().optional(),
  scheduledFor: z.string().datetime({ offset: true }).optional()
})

export type ShieldScanInput = z.infer<typeof shieldScanInputSchema>

export const shieldAssessmentModelOutputSchema = z.object({
  summary: z.string(),
  bills: z
    .array(
      z.object({
        billId: z.number().int().positive(),
        riskScore: z.number().int().min(0).max(100),
        riskLevel: z.enum(['critical', 'high', 'medium', 'low']),
        confidence: z.number().min(0).max(1),
        reviewRecommended: z.boolean(),
        rationale: z.string(),
        indicators: z
          .array(
            z.object({
              signal: z.string(),
              explanation: z.string(),
              evidenceRecordIds: z.array(z.string()).max(12)
            })
          )
          .max(12),
        mitigatingFactors: z.array(z.string()).max(10),
        warnings: z.array(z.string()).max(10)
      })
    )
    .max(100)
})

const shieldBriefFields = {
  headline: z.string(),
  overview: z.string(),
  alerts: z.array(
    z.object({
      billId: z.number().int().positive(),
      title: z.string(),
      brief: z.string(),
      supportingEvidence: z.array(z.string()).min(1),
      auditorQuestions: z.array(z.string())
    })
  )
}

export const shieldBriefGenerationModelOutputSchema = z.object({
  ...shieldBriefFields,
  alerts: shieldBriefFields.alerts.max(100)
})

export type ShieldBriefGenerationModelOutput = z.infer<
  typeof shieldBriefGenerationModelOutputSchema
>

export const shieldBriefModelOutputSchema = z.object({
  ...shieldBriefFields,
  alerts: z
    .array(
      z.object({
        billId: z.number().int().positive(),
        title: z.string(),
        brief: z.string(),
        supportingEvidence: z.array(z.string()).min(1).max(10),
        auditorQuestions: z.array(z.string()).max(8)
      })
    )
    .max(100)
})

export const shieldPhaseSchema = z.object({
  id: z.enum(['watch', 'assess', 'rank', 'brief']),
  label: z.enum(['Watch', 'Assess', 'Rank', 'Brief']),
  status: z.literal('completed'),
  summary: z.string()
})

export const shieldResultSchema = z.object({
  outcome: z.enum(['completed', 'no-bills']),
  message: z.string(),
  totalBills: z.number().int().nonnegative(),
  reviewCount: z.number().int().nonnegative(),
  phases: z.array(shieldPhaseSchema).length(4),
  assessment: shieldAssessmentModelOutputSchema
    .extend({
      source: z.literal('llm'),
      model: z.string().optional(),
      promptVersion: z.literal('shield-assess-v1'),
      checkedAt: z.string().datetime({ offset: true })
    })
    .optional(),
  brief: shieldBriefModelOutputSchema
    .extend({
      source: z.literal('llm'),
      model: z.string().optional(),
      promptVersion: z.literal('shield-brief-v1')
    })
    .optional()
})

export type ShieldResult = z.infer<typeof shieldResultSchema>

export const nudgeAutomationInputDataSchema = z.object({
  staleAfterDays: z.number().int().min(1).max(365).default(2),
  limit: z.number().int().min(1).max(100).default(50),
  notifyOnlyWhenAttention: z.boolean().default(true)
})

export const automationInputDataSchema = nudgeAutomationInputDataSchema

export const mirrorAutomationInputDataSchema = mirrorScanInputSchema.pick({
  lookbackDays: true,
  limit: true,
  notifyOnlyWhenAttention: true
})

export const shieldAutomationInputDataSchema = shieldScanInputSchema.pick({
  lookbackDays: true,
  limit: true,
  notifyOnlyWhenAttention: true
})

const automationBaseSchema = z.object({
  name: z.string().trim().min(2).max(120),
  schedule: automationScheduleSchema,
  missedRunPolicy: z.enum(['skip', 'run-on-start']).default('run-on-start'),
  status: z.enum(['draft', 'active']).default('active')
})

export const automationCreateSchema = z.discriminatedUnion('ownerSydekykId', [
  automationBaseSchema.extend({
    ownerSydekykId: z.literal('nudge'),
    workflowId: z.literal('nudge-stale-opportunities'),
    inputData: nudgeAutomationInputDataSchema
  }),
  automationBaseSchema.extend({
    ownerSydekykId: z.literal('mirror'),
    workflowId: z.literal('mirror-duplicate-bills'),
    inputData: mirrorAutomationInputDataSchema
  }),
  automationBaseSchema.extend({
    ownerSydekykId: z.literal('shield'),
    workflowId: z.literal('shield-fraud-review'),
    inputData: shieldAutomationInputDataSchema
  })
])

export const automationUpdateSchema = z.object({
  name: automationBaseSchema.shape.name.optional(),
  schedule: automationScheduleSchema.optional(),
  // Preserve the submitted patch until the service can validate it against
  // the existing automation owner. A union would apply another Sydekyk's
  // defaults before owner-specific validation.
  inputData: z.record(z.string(), z.unknown()).optional(),
  missedRunPolicy: automationBaseSchema.shape.missedRunPolicy.optional(),
  status: automationBaseSchema.shape.status.optional()
})

export type AutomationCreateInput = z.infer<typeof automationCreateSchema>
export type AutomationUpdateInput = z.infer<typeof automationUpdateSchema>

export type AutomationStatus = 'draft' | 'active' | 'paused' | 'error'

export interface AutomationRecord {
  id: string
  name: string
  ownerSydekykId: 'nudge' | 'mirror' | 'shield'
  workflowId: 'nudge-stale-opportunities' | 'mirror-duplicate-bills' | 'shield-fraud-review'
  schedule: AutomationSchedule
  inputData:
    | z.infer<typeof nudgeAutomationInputDataSchema>
    | z.infer<typeof mirrorAutomationInputDataSchema>
    | z.infer<typeof shieldAutomationInputDataSchema>
  missedRunPolicy: 'skip' | 'run-on-start'
  status: AutomationStatus
  scheduleLabel: string
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
  kind:
    | 'ledger.vendor-bill'
    | 'nudge.stale-opportunities'
    | 'mirror.duplicate-bills'
    | 'shield.fraud-review'
    | 'automation.proposal'
    | 'email.inbound'
    | 'document.inbound'
    | 'odoo.generic'
    | 'gadget.connection'
  sydekyk: 'Ledger' | 'Nudge' | 'Mirror' | 'Shield' | 'Syd'
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
