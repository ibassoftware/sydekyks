import { agentFailureDiagnosticSchema, type AgentConfidence } from '../../shared/agent-activity'
import {
  accountingIntelligenceSchema,
  mirrorResultSchema,
  nudgeResultSchema,
  shieldResultSchema,
  writeRecoveryIntelligenceSchema
} from '../domain/schemas'
import type { AgentRunTrace, AgentWorkReportProjection } from './work-report'
import { toolOutputFor } from './work-report'

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined

const asText = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined

const persistedDomainResult = (toolOutput: unknown): unknown => {
  const outer = asRecord(toolOutput)
  const persisted = asRecord(outer?.result)
  return persisted?.result
}

const confidenceFrom = (scores: number[], subject: string): AgentConfidence => {
  if (scores.length === 0) {
    return {
      level: 'not-applicable',
      summary: `No model confidence score was available for ${subject}.`
    }
  }
  const score = scores.reduce((total, value) => total + value, 0) / scores.length
  return {
    level: score >= 0.8 ? 'high' : score >= 0.6 ? 'medium' : 'low',
    score,
    summary: `${Math.round(score * 100)}% average model confidence across ${scores.length} ${subject}.`
  }
}

const fallbackMissionProjection = (
  toolOutput: unknown,
  currentStage?: string
): AgentWorkReportProjection => {
  const output = asRecord(toolOutput)
  const summary = asText(output?.summary)
  const status = asText(output?.status)?.toLocaleLowerCase()
  const failed =
    status !== undefined &&
    ['failed', 'error', 'needs_attention', 'needs-attention'].includes(status)
  const missionResult = asRecord(output?.result)
  const diagnosticResult = agentFailureDiagnosticSchema.safeParse(missionResult?.diagnostic)
  const diagnostic = diagnosticResult.success ? diagnosticResult.data : undefined
  return {
    currentStage: diagnostic?.stage ?? currentStage,
    stageDetail: failed ? summary : undefined,
    facts: summary && !failed ? [summary] : [],
    why: summary,
    uncertainties: [],
    confidence: failed
      ? {
          level: 'not-applicable',
          summary: 'No business conclusion was saved from this run.'
        }
      : undefined,
    diagnostic
  }
}

const automationProjection = (
  toolOutput: unknown,
  owner: 'Nudge' | 'Mirror' | 'Shield'
): AgentWorkReportProjection => {
  const output = asRecord(toolOutput)
  const name = asText(output?.name) ?? `${owner} automation`
  const schedule = asText(output?.scheduleLabel) ?? 'the requested cadence'
  if (output?.outcome === 'existing') {
    const status = asText(output.status) ?? 'existing'
    return {
      currentStage: 'Equivalent automation found',
      facts: [
        `No new draft was created.`,
        `“${name}” already has this job and cadence (${schedule}); current status: ${status}.`
      ],
      proposedActions: [
        `Choose whether to keep “${name}” or intentionally create another equivalent automation.`
      ],
      why: `The recurring request matched an existing ${owner} workflow, schedule, settings, and notification policy.`,
      confidence: {
        level: 'not-applicable',
        summary: 'This was a deterministic automation-equivalence check.'
      },
      approval: {
        required: true,
        status: 'required',
        summary: 'Explicit confirmation is required before creating an overlapping automation.'
      }
    }
  }
  return {
    currentStage: 'Draft ready',
    facts: [`Created “${name}” as an inactive draft.`, `Cadence: ${schedule}.`],
    proposedActions: [`Review and activate “${name}” in Mission Control → Automations.`],
    why: `The recurring request was converted into a reviewable ${owner} schedule without silently activating it.`,
    confidence: {
      level: 'not-applicable',
      summary: 'This was a deterministic schedule proposal, not a scored model judgment.'
    },
    approval: {
      required: true,
      status: 'required',
      summary: 'The user must activate the draft before it can run.'
    }
  }
}

export const nudgeReportProjection = (run: AgentRunTrace): AgentWorkReportProjection => {
  const proposal = toolOutputFor(run, ['proposeNudgeAutomationTool', 'propose-nudge-automation'])
  if (proposal) return automationProjection(proposal, 'Nudge')

  const toolOutput = toolOutputFor(run, ['nudgeCheckTool', 'run-nudge-stale-opportunities'])
  const parsed = nudgeResultSchema.safeParse(persistedDomainResult(toolOutput))
  if (!parsed.success) return fallbackMissionProjection(toolOutput)

  const result = parsed.data
  const opportunities = result.assessment?.opportunities ?? []
  const attention = opportunities.filter((opportunity) => opportunity.stale)
  const scored = attention.length > 0 ? attention : opportunities
  return {
    currentStage: 'Attention report ready',
    facts: [
      `Checked ${result.totalChecked} open opportunities; ${result.attentionCount} need attention.`,
      ...attention
        .slice(0, 6)
        .map(
          (opportunity) =>
            `${opportunity.opportunityName} — ${opportunity.priority} priority: ${opportunity.reasons.slice(0, 2).join('; ')}.`
        )
    ],
    proposedActions: attention
      .slice(0, 8)
      .map((opportunity) => `${opportunity.opportunityName}: ${opportunity.recommendedAction}`),
    why: result.assessment?.summary ?? result.message,
    confidence: confidenceFrom(
      scored.map((opportunity) => opportunity.confidence),
      'opportunity assessments'
    ),
    uncertainties: scored
      .filter((opportunity) => opportunity.confidence < 0.65)
      .slice(0, 6)
      .map(
        (opportunity) =>
          `${opportunity.opportunityName} has only ${Math.round(opportunity.confidence * 100)}% confidence.`
      )
  }
}

export const mirrorReportProjection = (run: AgentRunTrace): AgentWorkReportProjection => {
  const proposal = toolOutputFor(run, ['proposeMirrorAutomationTool', 'propose-mirror-automation'])
  if (proposal) return automationProjection(proposal, 'Mirror')

  const toolOutput = toolOutputFor(run, ['mirrorScanTool', 'run-mirror-duplicate-bills'])
  const parsed = mirrorResultSchema.safeParse(persistedDomainResult(toolOutput))
  if (!parsed.success) return fallbackMissionProjection(toolOutput)

  const result = parsed.data
  const pairs = result.assessment?.pairs ?? []
  const alerts = pairs.filter((pair) => pair.verdict !== 'not_duplicate')
  const scored = alerts.length > 0 ? alerts : pairs
  return {
    currentStage: 'Confirmation report ready',
    facts: [
      `Reviewed ${result.totalBills} bills; screened ${result.candidateCount} candidate pairs and retained ${result.alertCount} alerts.`,
      ...alerts
        .slice(0, 6)
        .map(
          (pair) =>
            `Bills ${pair.billIds.join(' and ')} — ${pair.verdict.replaceAll('_', ' ')}: ${pair.evidence.slice(0, 2).join('; ')}.`
        )
    ],
    proposedActions: alerts
      .slice(0, 8)
      .map((pair) => `Bills ${pair.billIds.join(' and ')}: ${pair.recommendedAction}`),
    why: result.assessment?.summary ?? result.message,
    confidence: confidenceFrom(
      scored.map((pair) => pair.confidence),
      'duplicate-pair assessments'
    ),
    uncertainties: [
      ...(result.assessment?.screening.warnings ?? []),
      ...scored.flatMap((pair) => pair.warnings),
      ...scored
        .filter((pair) => pair.confidence < 0.65)
        .map(
          (pair) =>
            `Bills ${pair.billIds.join(' and ')} have only ${Math.round(pair.confidence * 100)}% confidence.`
        )
    ]
  }
}

export const shieldReportProjection = (run: AgentRunTrace): AgentWorkReportProjection => {
  const proposal = toolOutputFor(run, ['proposeShieldAutomationTool', 'propose-shield-automation'])
  if (proposal) return automationProjection(proposal, 'Shield')

  const toolOutput = toolOutputFor(run, ['shieldReviewTool', 'run-shield-fraud-review'])
  const parsed = shieldResultSchema.safeParse(persistedDomainResult(toolOutput))
  if (!parsed.success) return fallbackMissionProjection(toolOutput)

  const result = parsed.data
  const bills = result.assessment?.bills ?? []
  const reviews = bills.filter((bill) => bill.reviewRecommended)
  const scored = reviews.length > 0 ? reviews : bills
  return {
    currentStage: 'Brief ready',
    stageDetail: 'Watch, Assess, Rank, and Brief are complete.',
    facts: [
      `Reviewed ${result.totalBills} bills; ${result.reviewCount} were placed in the auditor review queue.`,
      ...(result.brief?.alerts ?? [])
        .slice(0, 6)
        .map((alert) => `${alert.title}: ${alert.supportingEvidence.slice(0, 2).join('; ')}.`)
    ],
    proposedActions: reviews
      .slice(0, 8)
      .map((bill) => `Review bill ${bill.billId}: ${bill.rationale}`),
    why: result.brief?.overview ?? result.assessment?.summary ?? result.message,
    confidence: confidenceFrom(
      scored.map((bill) => bill.confidence),
      'risk assessments'
    ),
    uncertainties: [
      ...scored.flatMap((bill) => bill.warnings),
      ...scored
        .filter((bill) => bill.confidence < 0.65)
        .map(
          (bill) => `Bill ${bill.billId} has only ${Math.round(bill.confidence * 100)}% confidence.`
        )
    ]
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
        'account and tax recommendations'
      )
    : recovery.success
      ? confidenceFrom([recovery.data.confidence], 'write-recovery recommendation')
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
