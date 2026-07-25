import type { AgentConfidence } from '../../shared/agent-activity'
import { accountingIntelligenceSchema, writeRecoveryIntelligenceSchema } from '../domain/schemas'
import type { AgentRunTrace, AgentWorkReportProjection } from './work-report'
import { toolOutputFor } from './work-report'

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined

const asText = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined

const confidenceFrom = (scores: number[], subject: string): AgentConfidence => {
  const score = scores.reduce((total, value) => total + value, 0) / scores.length
  return {
    level: score >= 0.8 ? 'high' : score >= 0.6 ? 'medium' : 'low',
    score,
    summary: `${Math.round(score * 100)}% average model confidence across ${subject}.`
  }
}

export const ledgerReportProjection = (run: AgentRunTrace): AgentWorkReportProjection => {
  const toolOutput = toolOutputFor(run, ['ledgerWorkflowTool', 'start-ledger-vendor-bill'])
  const outer = asRecord(toolOutput)
  if (!outer) return {}
  const persisted = asRecord(outer.result)
  const result = asRecord(persisted?.result)
  const intelligence = accountingIntelligenceSchema.safeParse(result?.intelligence)
  const recovery = writeRecoveryIntelligenceSchema.safeParse(result?.writeRecovery)
  const outcome = asText(result?.outcome)
  const summary = asText(outer.summary) ?? asText(result?.message)
  const waitingApproval = asText(outer.status) === 'waiting_approval'
  const approvalPayloads = asRecord(outer.approval)
  const approval = approvalPayloads
    ? asRecord(Object.values(approvalPayloads).find((value) => asRecord(value)))
    : undefined
  const approvalSummary =
    asText(approval?.message) ?? summary ?? 'Ledger requires approval before it can continue.'
  const checks = Array.isArray(result?.checks)
    ? result.checks.filter(
        (value): value is string => typeof value === 'string' && !value.includes('{')
      )
    : []
  const proposedActions = waitingApproval
    ? [approvalSummary]
    : outcome === 'dry-run'
      ? ['Confirm draft creation if you want Ledger to write the prepared Odoo draft.']
      : outcome === 'needs-review'
        ? ['Review the accounting ambiguity before attempting an Odoo write.']
        : []
  const confidence = intelligence.success
    ? confidenceFrom(
        [intelligence.data.account.confidence, intelligence.data.tax.confidence],
        'the account and tax recommendations'
      )
    : recovery.success
      ? confidenceFrom([recovery.data.confidence], 'the write-recovery recommendation')
      : undefined
  return {
    currentStage: waitingApproval
      ? 'Awaiting approval'
      : outcome === 'created'
        ? 'Verification complete'
        : outcome === 'dry-run'
          ? 'Draft prepared'
          : outcome === 'needs-review'
            ? 'Human review needed'
            : undefined,
    facts: [
      summary,
      ...checks.slice(0, 7),
      ...(intelligence.success ? intelligence.data.observations.slice(0, 5) : [])
    ].filter((value): value is string => Boolean(value)),
    proposedActions,
    why: intelligence.success
      ? `Account: ${intelligence.data.account.rationale} Tax: ${intelligence.data.tax.rationale}`
      : recovery.success
        ? recovery.data.rationale
        : summary,
    confidence,
    uncertainties: [
      ...(intelligence.success && intelligence.data.account.reviewRecommended
        ? ['Ledger Intelligence recommends reviewing the selected account.']
        : []),
      ...(intelligence.success && intelligence.data.tax.reviewRecommended
        ? ['Ledger Intelligence recommends reviewing the tax treatment.']
        : []),
      ...(recovery.success ? recovery.data.warnings : [])
    ],
    approval: waitingApproval
      ? { required: true, status: 'required', summary: approvalSummary }
      : undefined
  }
}
