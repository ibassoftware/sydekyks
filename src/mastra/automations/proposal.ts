import { z } from 'zod'
import { createAutomation, findEquivalentAutomation } from './service'
import {
  automationCreateSchema,
  type AutomationSchedule,
  type AutomationStatus
} from '../domain/schemas'
import { intervalAnchor, schedulePreview } from './schedule'

export const automationDayNames = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday'
] as const

export const recurringCadenceSchema = z.enum([
  'daily',
  'weekdays',
  'weekly',
  'interval-days',
  'every_days',
  'every-n-days',
  'every n days',
  'every N days'
])

export const recurringAutomationFields = {
  name: z.string().trim().min(2).max(120),
  cadence: recurringCadenceSchema,
  everyDays: z.number().int().min(2).max(365).nullish(),
  weeklyDay: z.enum(automationDayNames).nullish(),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  timezone: z.string().default('Europe/Paris'),
  allowDuplicate: z
    .boolean()
    .default(false)
    .describe(
      'Set true only after the user explicitly confirms they want another equivalent automation.'
    )
}

interface RecurringDraftInput {
  name: string
  cadence: z.infer<typeof recurringCadenceSchema>
  everyDays?: number | null
  weeklyDay?: (typeof automationDayNames)[number] | null
  time: string
  timezone: string
  allowDuplicate?: boolean
}

const proposalFields = {
  automationId: z.string().uuid(),
  name: z.string(),
  scheduleLabel: z.string(),
  timezone: z.string(),
  nextRuns: z.array(z.string()),
  instruction: z.string()
}

export const automationProposalOutputSchema = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('created'),
    ...proposalFields,
    status: z.literal('draft')
  }),
  z.object({
    outcome: z.literal('existing'),
    ...proposalFields,
    status: z.enum(['draft', 'active', 'paused', 'error'] satisfies [
      AutomationStatus,
      ...AutomationStatus[]
    ])
  })
])

export type DraftAutomationProposal = z.infer<typeof automationProposalOutputSchema>

export const createDraftAutomationFromCadence = async ({
  recurring,
  ownerSydekykId,
  workflowId,
  inputData
}: {
  recurring: RecurringDraftInput
  ownerSydekykId: 'nudge' | 'mirror' | 'shield'
  workflowId: 'nudge-stale-opportunities' | 'mirror-duplicate-bills' | 'shield-fraud-review'
  inputData: Record<string, unknown>
}): Promise<DraftAutomationProposal> => {
  const cadence = ['every_days', 'every-n-days', 'every n days', 'every N days'].includes(
    recurring.cadence
  )
    ? 'interval-days'
    : recurring.cadence
  const weeklyDay = recurring.weeklyDay ? automationDayNames.indexOf(recurring.weeklyDay) : -1
  if (cadence === 'weekly' && weeklyDay < 0) {
    throw new Error('Choose the weekday for the weekly automation')
  }
  if (cadence === 'interval-days' && !recurring.everyDays) {
    throw new Error('Choose how many days apart the automation should run')
  }
  const schedule: AutomationSchedule =
    cadence === 'interval-days'
      ? {
          kind: 'interval',
          every: recurring.everyDays as number,
          unit: 'days',
          time: recurring.time,
          timezone: recurring.timezone,
          anchorAt: intervalAnchor(recurring.time, recurring.timezone)
        }
      : {
          kind: 'calendar',
          daysOfWeek:
            cadence === 'daily'
              ? [0, 1, 2, 3, 4, 5, 6]
              : cadence === 'weekdays'
                ? [1, 2, 3, 4, 5]
                : [weeklyDay],
          time: recurring.time,
          timezone: recurring.timezone
        }
  const proposedAutomation = automationCreateSchema.parse({
    name: recurring.name,
    ownerSydekykId,
    workflowId,
    schedule,
    inputData,
    missedRunPolicy: 'run-on-start',
    status: 'draft'
  })
  if (!recurring.allowDuplicate) {
    const existing = await findEquivalentAutomation(proposedAutomation)
    if (existing) {
      return {
        outcome: 'existing',
        automationId: existing.id,
        name: existing.name,
        status: existing.status,
        scheduleLabel: existing.scheduleLabel,
        timezone: existing.schedule.timezone,
        nextRuns: schedulePreview(existing.schedule),
        instruction:
          'No new draft was created. Tell the user this equivalent automation already exists and ask whether to keep it or intentionally create another. Set allowDuplicate=true only after explicit confirmation.'
      }
    }
  }
  const automation = await createAutomation(proposedAutomation)
  return {
    outcome: 'created',
    automationId: automation.id,
    name: automation.name,
    status: 'draft' as const,
    scheduleLabel: automation.scheduleLabel,
    timezone: automation.schedule.timezone,
    nextRuns: schedulePreview(automation.schedule),
    instruction: 'Review and activate this draft in Mission Control → Automations.'
  }
}
