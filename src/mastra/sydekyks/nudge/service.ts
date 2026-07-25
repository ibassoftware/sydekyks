import type { MissionRecord, NudgeCheckInput, NudgeResult } from '../../domain/schemas'
import { nudgeCheckInputSchema } from '../../domain/schemas'
import { aiRuntime } from '../../lib/ai-runtime'
import { appStore } from '../../lib/app-store'
import { friendlyErrorMessage, missionErrorDiagnostic } from '../../lib/errors'
import { nudgeStaleOpportunitiesWorkflow } from './workflows/stale-opportunities'

const nudgeFailure = (error: unknown): ReturnType<typeof missionErrorDiagnostic> =>
  missionErrorDiagnostic(error, {
    fallback: 'Nudge could not complete the pipeline check.',
    model: aiRuntime.getStatus().label,
    stage: 'Assess'
  })

export const startNudgeMission = async (rawInput: NudgeCheckInput): Promise<MissionRecord> => {
  const input = nudgeCheckInputSchema.parse(rawInput)
  const run = await nudgeStaleOpportunitiesWorkflow.createRun({ resourceId: 'local-user' })
  const mission = await appStore.createMission({
    kind: 'nudge.stale-opportunities',
    sydekyk: 'Nudge',
    title: input.source === 'schedule' ? 'Scheduled pipeline watch' : 'Pipeline attention check',
    summary: 'Nudge is reading opportunity activity and recent conversations.',
    status: 'running',
    runId: run.runId,
    payload: { request: input }
  })
  try {
    const result = await run.start({ inputData: input })
    if (result.status !== 'success') {
      const diagnostic = nudgeFailure(result.status === 'failed' ? result.error : undefined)
      const message =
        result.status === 'failed'
          ? friendlyErrorMessage(result.error, 'Nudge could not complete the pipeline check.')
          : `Workflow ended as ${result.status}`
      await appStore.updateMission(mission.id, {
        status: message.includes('AI setup required') ? 'needs_attention' : 'failed',
        summary: message,
        result: { status: result.status, error: message, diagnostic }
      })
    } else {
      const output = result.result as NudgeResult
      await appStore.updateMission(mission.id, {
        status: 'completed',
        summary: output.message,
        result: { status: 'success', result: output }
      })
    }
  } catch (error) {
    const message = friendlyErrorMessage(error, 'Nudge could not complete the pipeline check.')
    const diagnostic = nudgeFailure(error)
    await appStore.updateMission(mission.id, {
      status: message.includes('AI setup required') ? 'needs_attention' : 'failed',
      summary: message,
      result: { status: 'failed', error: message, diagnostic }
    })
  }
  return (await appStore.getMission(mission.id)) as MissionRecord
}
