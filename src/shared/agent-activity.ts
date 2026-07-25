import { z } from 'zod'

export const agentActivityStatusSchema = z.enum(['completed', 'needs-attention', 'failed'])

export const agentReportStatusSchema = z.enum(['working', 'completed', 'needs-attention', 'failed'])

export const agentActivitySchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  detail: z.string().min(1).optional(),
  status: agentActivityStatusSchema
})

export const agentReportActionSchema = agentActivitySchema.extend({
  kind: z.enum(['performed', 'proposed']),
  status: z.enum(['completed', 'proposed', 'needs-attention', 'failed'])
})

export const agentDataSourceSchema = z.object({
  name: z.string().min(1),
  detail: z.string().min(1).optional()
})

export const agentConfidenceSchema = z.object({
  level: z.enum(['high', 'medium', 'low', 'not-applicable']),
  score: z.number().min(0).max(1).optional(),
  summary: z.string().min(1)
})

export const agentApprovalRequirementSchema = z.object({
  required: z.boolean(),
  status: z.enum(['not-required', 'required', 'approved', 'declined']),
  summary: z.string().min(1)
})

export const agentFailureDiagnosticSchema = z.object({
  code: z.string().min(1),
  stage: z.string().min(1),
  message: z.string().min(1),
  nextStep: z.string().min(1),
  model: z.string().min(1).optional()
})

export const agentWorkReportSchema = z.object({
  agent: z.string().min(1),
  currentStage: z
    .object({
      label: z.string().min(1),
      detail: z.string().min(1).optional(),
      status: agentReportStatusSchema
    })
    .default({ label: 'Report ready', status: 'completed' }),
  summary: z.string().min(1),
  dataSources: z.array(agentDataSourceSchema).max(12).default([]),
  facts: z.array(z.string().min(1)).max(16).default([]),
  actions: z.array(agentReportActionSchema).max(20).default([]),
  why: z.string().min(1).default('See the specialist report for the conclusion.'),
  confidence: agentConfidenceSchema.default({
    level: 'not-applicable',
    summary: 'No model confidence score was available for this response.'
  }),
  uncertainties: z.array(z.string().min(1)).max(12).default([]),
  approval: agentApprovalRequirementSchema.default({
    required: false,
    status: 'not-required',
    summary: 'No approval is required.'
  }),
  diagnostic: agentFailureDiagnosticSchema.optional(),
  finalReport: z.string().min(1).max(20_000).default('No specialist narrative was returned.'),
  // Kept for stored chat-session compatibility. New UI uses `actions`.
  activities: z.array(agentActivitySchema).default([])
})

export const agentDelegationOutputSchema = z.object({
  response: z.string(),
  workReport: agentWorkReportSchema
})

export type AgentActivity = z.infer<typeof agentActivitySchema>
export type AgentDataSource = z.infer<typeof agentDataSourceSchema>
export type AgentReportAction = z.infer<typeof agentReportActionSchema>
export type AgentConfidence = z.infer<typeof agentConfidenceSchema>
export type AgentApprovalRequirement = z.infer<typeof agentApprovalRequirementSchema>
export type AgentFailureDiagnostic = z.infer<typeof agentFailureDiagnosticSchema>
export type AgentWorkReport = z.infer<typeof agentWorkReportSchema>
