import {
  shieldBriefModelOutputSchema,
  type ShieldBriefGenerationModelOutput
} from '../../domain/schemas'

const uniqueFirst = (values: string[], limit: number): string[] =>
  [
    ...new Set(
      values.map((value) => value.trim()).filter((value): value is string => Boolean(value))
    )
  ].slice(0, limit)

export const normalizeShieldBrief = (
  brief: ShieldBriefGenerationModelOutput
): ReturnType<typeof shieldBriefModelOutputSchema.parse> =>
  shieldBriefModelOutputSchema.parse({
    ...brief,
    alerts: brief.alerts.map((alert) => ({
      ...alert,
      supportingEvidence: uniqueFirst(alert.supportingEvidence, 6),
      auditorQuestions: uniqueFirst(alert.auditorQuestions, 4)
    }))
  })
