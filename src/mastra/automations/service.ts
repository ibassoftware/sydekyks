import {
  automationCreateSchema,
  mirrorAutomationInputDataSchema,
  nudgeAutomationInputDataSchema,
  shieldAutomationInputDataSchema,
  automationUpdateSchema,
  type AutomationCreateInput,
  type AutomationRecord,
  type AutomationStatus,
  type AutomationUpdateInput,
  type MissionRecord
} from '../domain/schemas'
import { appStore } from '../lib/app-store'
import { friendlyErrorMessage } from '../lib/errors'
import { startNudgeMission } from '../sydekyks/nudge/service'
import { startMirrorMission } from '../sydekyks/mirror/service'
import { startShieldMission } from '../sydekyks/shield/service'
import { nextScheduleRun } from './schedule'

export const createAutomation = async (input: AutomationCreateInput): Promise<AutomationRecord> =>
  appStore.createAutomation(automationCreateSchema.parse(input))

const canonicalValue = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalValue(entry)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

const scheduleSignature = (schedule: AutomationRecord['schedule']): string =>
  schedule.kind === 'interval'
    ? ['interval', schedule.every, schedule.unit, schedule.time, schedule.timezone].join('|')
    : [
        'calendar',
        [...new Set(schedule.daysOfWeek)].sort((left, right) => left - right).join(','),
        schedule.time,
        schedule.timezone
      ].join('|')

export const findEquivalentAutomation = async (
  rawInput: AutomationCreateInput
): Promise<AutomationRecord | undefined> => {
  const input = automationCreateSchema.parse(rawInput)
  const wantedSchedule = scheduleSignature(input.schedule)
  const wantedInput = canonicalValue(input.inputData)
  return (await appStore.listAutomations(1_000)).find(
    (automation) =>
      automation.ownerSydekykId === input.ownerSydekykId &&
      automation.workflowId === input.workflowId &&
      automation.missedRunPolicy === input.missedRunPolicy &&
      scheduleSignature(automation.schedule) === wantedSchedule &&
      canonicalValue(automation.inputData) === wantedInput
  )
}

export const updateAutomation = async (
  id: string,
  input: AutomationUpdateInput
): Promise<AutomationRecord> => {
  const current = await appStore.getAutomation(id)
  if (!current) throw new Error('The automation was not found')
  const update = automationUpdateSchema.parse(input)
  const inputSchema =
    current.ownerSydekykId === 'nudge'
      ? nudgeAutomationInputDataSchema
      : current.ownerSydekykId === 'mirror'
        ? mirrorAutomationInputDataSchema
        : shieldAutomationInputDataSchema
  const inputData = update.inputData
    ? inputSchema.parse({ ...current.inputData, ...update.inputData })
    : current.inputData
  return appStore.updateAutomation(id, { ...update, inputData })
}

export const setAutomationStatus = async (
  id: string,
  status: AutomationStatus
): Promise<AutomationRecord> => {
  if (!['active', 'paused'].includes(status)) throw new Error('Use active or paused here')
  return appStore.setAutomationStatus(id, status)
}

export const deleteAutomation = async (id: string): Promise<void> => appStore.deleteAutomation(id)

export const deleteAutomations = async (ids: string[]): Promise<AutomationRecord[]> => {
  const uniqueIds = [...new Set(ids)]
  const automations = await Promise.all(uniqueIds.map((id) => appStore.getAutomation(id)))
  const missingIds = uniqueIds.filter((_, index) => !automations[index])
  if (missingIds.length > 0) {
    throw new Error(
      `Deletion stopped because ${missingIds.length === 1 ? 'an automation is' : 'some automations are'} no longer available. Ask Syd to check the current list and try again.`
    )
  }
  const existing = automations.filter(
    (automation): automation is AutomationRecord => automation !== undefined
  )
  await appStore.deleteAutomations(uniqueIds)
  return existing
}

export const runAutomation = async (
  automation: AutomationRecord,
  scheduledFor?: string
): Promise<MissionRecord> => {
  const common = {
    source: scheduledFor ? ('schedule' as const) : ('mission-control' as const),
    automationId: automation.id,
    scheduledFor
  }
  const mission =
    automation.ownerSydekykId === 'nudge'
      ? await startNudgeMission({
          ...common,
          ...nudgeAutomationInputDataSchema.parse(automation.inputData)
        })
      : automation.ownerSydekykId === 'mirror'
        ? await startMirrorMission({
            ...common,
            ...mirrorAutomationInputDataSchema.parse(automation.inputData)
          })
        : await startShieldMission({
            ...common,
            ...shieldAutomationInputDataSchema.parse(automation.inputData)
          })
  const failed = ['failed', 'needs_attention'].includes(mission.status)
  await appStore.recordAutomationRun(automation.id, {
    missionId: mission.id,
    failed,
    error: failed ? mission.summary : undefined
  })
  return mission
}

export const runAutomationNow = async (id: string): Promise<MissionRecord> => {
  const automation = await appStore.getAutomation(id)
  if (!automation) throw new Error('The automation was not found')
  return runAutomation(automation)
}

export const dispatchDueAutomations = async (
  now = new Date()
): Promise<{ due: number; started: number; skipped: number; failed: number }> => {
  const due = await appStore.listDueAutomations(now)
  let started = 0
  let skipped = 0
  let failed = 0
  for (const automation of due) {
    if (!automation.nextRunAt) continue
    const scheduledFor = automation.nextRunAt
    const nextRunAt = nextScheduleRun(automation.schedule, now).toISOString()
    const claimed = await appStore.claimAutomation(automation.id, scheduledFor, nextRunAt)
    if (!claimed) continue
    const lateBy = now.getTime() - new Date(scheduledFor).getTime()
    if (automation.missedRunPolicy === 'skip' && lateBy > 5 * 60_000) {
      skipped += 1
      continue
    }
    started += 1
    try {
      await runAutomation(automation, scheduledFor)
    } catch (error) {
      failed += 1
      await appStore.recordAutomationRun(automation.id, {
        failed: true,
        error: friendlyErrorMessage(error, 'The scheduled automation could not run.')
      })
    }
  }
  return { due: due.length, started, skipped, failed }
}
