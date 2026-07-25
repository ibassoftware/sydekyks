import {
  nudgeAssessmentModelOutputSchema,
  type NudgeAssessment,
  type NudgeOpportunityFact
} from '../../domain/schemas'
import { aiRuntime, aiRuntimeReady } from '../../lib/ai-runtime'
import { nudgeIntelligenceAgent } from './intelligence-agent'

const maximumBatchCharacters = 24_000

const opportunityBatches = (opportunities: NudgeOpportunityFact[]): NudgeOpportunityFact[][] => {
  const batches: NudgeOpportunityFact[][] = []
  let batch: NudgeOpportunityFact[] = []
  for (const opportunity of opportunities) {
    const candidate = [...batch, opportunity]
    if (
      batch.length > 0 &&
      (candidate.length > 8 || JSON.stringify(candidate).length > maximumBatchCharacters)
    ) {
      batches.push(batch)
      batch = [opportunity]
    } else {
      batch = candidate
    }
  }
  if (batch.length > 0) batches.push(batch)
  return batches
}

const intelligenceError = (error: unknown): Error => {
  const message = error instanceof Error ? error.message : 'The configured model did not respond'
  return new Error(`CRM staleness analysis failed. ${message}`)
}

export const testNudgeIntelligenceConnection = async (): Promise<void> => {
  const now = new Date().toISOString()
  await analyzeStaleOpportunities(
    [
      {
        id: 1,
        name: 'Structured output capability check',
        stage: 'Qualified',
        probability: 35,
        expectedRevenue: 1_000,
        lastUpdatedAt: now,
        stageChangedAt: now,
        lastMeaningfulMessageAt: now,
        nextActivityAt: now,
        hasOpenActivity: true,
        overdueActivityCount: 0,
        activities: [],
        messages: []
      }
    ],
    2
  )
}

export const analyzeStaleOpportunities = async (
  opportunities: NudgeOpportunityFact[],
  staleAfterDays: number
): Promise<NudgeAssessment> => {
  await aiRuntimeReady
  try {
    const checkedAt = new Date().toISOString()
    const assessed: NudgeAssessment['opportunities'] = []
    const summaries: string[] = []
    for (const [batchIndex, batch] of opportunityBatches(opportunities).entries()) {
      const prompt = `Assess which supplied opportunities are genuinely neglected. The user's attention threshold is
${staleAfterDays} day${staleAfterDays === 1 ? '' : 's'}, but it is a candidate signal rather than an automatic verdict.
An opportunity with a suitable future activity may be healthy. A recent customer reply with no response,
an overdue activity, or a late-stage deal with no plan can raise urgency. Return exactly one assessment per
supplied opportunity and reference no other IDs. This is bounded batch ${batchIndex + 1}; do not omit an item.

${JSON.stringify({ checkedAt, staleAfterDays, opportunities: batch }, null, 2)}`
      let batchOutput: typeof nudgeAssessmentModelOutputSchema._output | undefined
      let generationError: unknown
      for (let attempt = 0; attempt < 2 && !batchOutput; attempt += 1) {
        try {
          const response = await nudgeIntelligenceAgent.generate(
            attempt === 0
              ? prompt
              : `${prompt}\n\nYour prior response did not satisfy the contract. Return all ${batch.length} allowed opportunity IDs exactly once in the opportunities array.`,
            {
              structuredOutput: {
                schema: nudgeAssessmentModelOutputSchema,
                ...aiRuntime.getStructuredOutputPolicy(),
                instructions: `Return exactly ${batch.length} assessment${batch.length === 1 ? '' : 's'}, one for every supplied opportunity ID.`
              },
              modelSettings: aiRuntime.getDeterministicModelSettings({
                maxOutputTokens: 3_000,
                maxRetries: 0
              }),
              abortSignal: AbortSignal.timeout(60_000)
            }
          )
          batchOutput = response.object
          if (!batchOutput) generationError = new Error('The model returned no CRM assessment')
        } catch (error) {
          generationError = error
        }
      }
      if (!batchOutput) {
        throw generationError ?? new Error('The model returned no CRM assessment')
      }
      const candidates = new Map(batch.map((opportunity) => [opportunity.id, opportunity]))
      const seen = new Set<number>()
      const validated = batchOutput.opportunities.flatMap((assessment) => {
        const candidate = candidates.get(assessment.opportunityId)
        if (!candidate || seen.has(candidate.id)) return []
        seen.add(candidate.id)
        const staleSince = assessment.stale
          ? (candidate.lastMeaningfulMessageAt ??
            candidate.lastUpdatedAt ??
            candidate.stageChangedAt ??
            null)
          : null
        return [
          {
            ...assessment,
            opportunityName: candidate.name,
            staleSince,
            priority: assessment.stale
              ? assessment.priority === 'healthy'
                ? ('low' as const)
                : assessment.priority
              : ('healthy' as const)
          }
        ]
      })
      if (validated.length !== batch.length) {
        throw new Error('The model did not assess every supplied opportunity with an allowed ID')
      }
      assessed.push(...validated)
      summaries.push(batchOutput.summary)
    }
    return {
      source: 'llm',
      model: aiRuntime.getModel(),
      checkedAt,
      summary: summaries.join(' '),
      opportunities: assessed
    }
  } catch (error) {
    throw intelligenceError(error)
  }
}
