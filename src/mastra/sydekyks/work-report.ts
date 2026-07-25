import type {
  AgentActivity,
  AgentApprovalRequirement,
  AgentConfidence,
  AgentDataSource,
  AgentFailureDiagnostic,
  AgentReportAction,
  AgentWorkReport
} from '../../shared/agent-activity'

interface ToolCallTrace {
  payload: {
    toolCallId: string
    toolName: string
  }
}

interface ToolResultTrace {
  payload: {
    toolCallId: string
    isError?: boolean
    result?: unknown
  }
}

export interface AgentRunTrace {
  text?: string
  toolCalls: ToolCallTrace[]
  toolResults: ToolResultTrace[]
}

export interface ToolActivityDefinition {
  label: string
  detail: string
  dataSources?: AgentDataSource[]
}

export interface AgentWorkReportProjection {
  currentStage?: string
  stageDetail?: string
  dataSources?: AgentDataSource[]
  facts?: string[]
  proposedActions?: string[]
  why?: string
  confidence?: AgentConfidence
  uncertainties?: string[]
  approval?: AgentApprovalRequirement
  diagnostic?: AgentFailureDiagnostic
}

const needsAttentionStatuses = new Set([
  'needs_attention',
  'needs-attention',
  'waiting_approval',
  'waiting-approval',
  'waiting_review',
  'waiting-review'
])

const failedStatuses = new Set(['failed', 'error', 'cancelled', 'canceled'])

const resultStatus = (result: unknown): string | undefined => {
  if (!result || typeof result !== 'object' || !('status' in result)) return undefined
  return typeof result.status === 'string' ? result.status.toLocaleLowerCase() : undefined
}

const activityStatus = (result: ToolResultTrace | undefined): AgentActivity['status'] => {
  if (!result || result.payload.isError) return 'failed'
  if (
    result.payload.result &&
    typeof result.payload.result === 'object' &&
    'outcome' in result.payload.result &&
    result.payload.result.outcome === 'existing'
  ) {
    return 'needs-attention'
  }
  const status = resultStatus(result.payload.result)
  if (status && failedStatuses.has(status)) return 'failed'
  if (status && needsAttentionStatuses.has(status)) return 'needs-attention'
  return 'completed'
}

const humanizeToolName = (toolName: string): string => {
  const words = toolName
    .replace(/Tool$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .trim()
    .toLocaleLowerCase()
  return words ? `${words[0].toLocaleUpperCase()}${words.slice(1)}` : 'Agent operation'
}

const reportSummary = (agent: string, activities: AgentActivity[]): string => {
  if (activities.length === 0) {
    return `${agent} answered without running a workflow or creating an automation.`
  }
  const failed = activities.filter((activity) => activity.status === 'failed').length
  const needsAttention = activities.filter(
    (activity) => activity.status === 'needs-attention'
  ).length
  const operationLabel = activities.length === 1 ? 'operation' : 'operations'
  if (failed > 0) {
    return `${agent} recorded ${activities.length} ${operationLabel}; ${failed} did not complete.`
  }
  if (needsAttention > 0) {
    return `${agent} recorded ${activities.length} ${operationLabel}; ${needsAttention} needs attention.`
  }
  return `${agent} completed ${activities.length} ${operationLabel}.`
}

const uniqueStrings = (values: Array<string | undefined>, limit: number): string[] =>
  [
    ...new Set(
      values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))
    )
  ].slice(0, limit)

const uniqueSources = (sources: AgentDataSource[]): AgentDataSource[] => {
  const seen = new Set<string>()
  return sources
    .filter((source) => {
      const key = `${source.name}\u0000${source.detail ?? ''}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, 12)
}

const reportStatus = (activities: AgentActivity[]): AgentWorkReport['currentStage']['status'] => {
  if (activities.some((activity) => activity.status === 'failed')) return 'failed'
  if (activities.some((activity) => activity.status === 'needs-attention')) {
    return 'needs-attention'
  }
  return 'completed'
}

const defaultStageLabel = (
  status: AgentWorkReport['currentStage']['status'],
  activities: AgentActivity[]
): string => {
  if (status === 'failed') return 'Stopped'
  if (status === 'needs-attention') return 'Waiting for attention'
  return activities.length > 0 ? 'Report ready' : 'Response ready'
}

const shortConclusion = (text: string): string => {
  const compact = text.replace(/\s+/g, ' ').trim()
  if (!compact) return 'The specialist returned no narrative conclusion.'
  return compact.length <= 600 ? compact : `${compact.slice(0, 597)}…`
}

export const toolOutputFor = (run: AgentRunTrace, names: string[]): unknown => {
  const accepted = new Set(names)
  for (let index = run.toolCalls.length - 1; index >= 0; index -= 1) {
    const call = run.toolCalls[index]
    if (!accepted.has(call.payload.toolName)) continue
    return run.toolResults.find((result) => result.payload.toolCallId === call.payload.toolCallId)
      ?.payload.result
  }
  return undefined
}

export const buildAgentWorkReport = (
  agent: string,
  run: AgentRunTrace,
  definitions: Record<string, ToolActivityDefinition>,
  projection: AgentWorkReportProjection = {}
): AgentWorkReport => {
  const results = new Map(run.toolResults.map((result) => [result.payload.toolCallId, result]))
  const activities = run.toolCalls.map((call) => {
    const definition = definitions[call.payload.toolName]
    return {
      id: call.payload.toolCallId,
      label: definition?.label ?? humanizeToolName(call.payload.toolName),
      detail: definition?.detail,
      status: activityStatus(results.get(call.payload.toolCallId))
    }
  })
  const actions: AgentReportAction[] = [
    ...activities.map((activity) => ({ ...activity, kind: 'performed' as const })),
    ...uniqueStrings(projection.proposedActions ?? [], 12).map((label, index) => ({
      id: `proposed-${index + 1}`,
      label,
      kind: 'proposed' as const,
      status: 'proposed' as const
    }))
  ].slice(0, 20)
  const status = reportStatus(activities)
  const finalReport = run.text?.trim() || 'No specialist narrative was returned.'
  const dataSources = uniqueSources([
    ...run.toolCalls.flatMap((call) => definitions[call.payload.toolName]?.dataSources ?? []),
    ...(projection.dataSources ?? [])
  ])
  return {
    agent,
    currentStage: {
      label: projection.currentStage ?? defaultStageLabel(status, activities),
      detail: projection.stageDetail,
      status
    },
    summary: reportSummary(agent, activities),
    dataSources,
    facts: uniqueStrings(projection.facts ?? [], 16),
    actions,
    why: projection.why?.trim() || shortConclusion(finalReport),
    confidence: projection.confidence ?? {
      level: 'not-applicable',
      summary: 'No model confidence score was available for this response.'
    },
    uncertainties: uniqueStrings(projection.uncertainties ?? [], 12),
    approval: projection.approval ?? {
      required: false,
      status: 'not-required',
      summary: 'No approval is required.'
    },
    diagnostic: projection.diagnostic,
    finalReport,
    activities
  }
}
