import type { MirrorResult, MirrorScanInput, MissionRecord } from '../../domain/schemas'
import { mirrorScanInputSchema } from '../../domain/schemas'
import { aiRuntime } from '../../lib/ai-runtime'
import { appStore } from '../../lib/app-store'
import { friendlyErrorMessage, missionErrorDiagnostic } from '../../lib/errors'
import { mirrorDuplicateBillsWorkflow } from './workflows/duplicate-bills'

const mirrorFailure = (error: unknown): ReturnType<typeof missionErrorDiagnostic> =>
  missionErrorDiagnostic(error, {
    fallback: 'Mirror could not complete the duplicate scan.',
    model: aiRuntime.getStatus().label,
    stage: 'Compare'
  })

export const startMirrorMission = async (rawInput: MirrorScanInput): Promise<MissionRecord> => {
  const input = mirrorScanInputSchema.parse(rawInput)
  const run = await mirrorDuplicateBillsWorkflow.createRun({ resourceId: 'local-user' })
  const mission = await appStore.createMission({
    kind: 'mirror.duplicate-bills',
    sydekyk: 'Mirror',
    title: input.source === 'schedule' ? 'Scheduled duplicate watch' : 'Duplicate bill scan',
    summary: 'Mirror is reading vendor identities, invoice facts, and line items.',
    status: 'running',
    runId: run.runId,
    payload: { request: input }
  })
  try {
    const result = await run.start({ inputData: input })
    if (result.status !== 'success') {
      const diagnostic = mirrorFailure(result.status === 'failed' ? result.error : undefined)
      const message =
        result.status === 'failed'
          ? friendlyErrorMessage(result.error, 'Mirror could not complete the duplicate scan.')
          : `Workflow ended as ${result.status}`
      await appStore.updateMission(mission.id, {
        status: message.includes('AI setup required') ? 'needs_attention' : 'failed',
        summary: message,
        result: { status: result.status, error: message, diagnostic }
      })
    } else {
      const output = result.result as MirrorResult
      await appStore.updateMission(mission.id, {
        status: 'completed',
        summary: output.message,
        result: { status: 'success', result: output }
      })
    }
  } catch (error) {
    const message = friendlyErrorMessage(error, 'Mirror could not complete the duplicate scan.')
    const diagnostic = mirrorFailure(error)
    await appStore.updateMission(mission.id, {
      status: message.includes('AI setup required') ? 'needs_attention' : 'failed',
      summary: message,
      result: { status: 'failed', error: message, diagnostic }
    })
  }
  return (await appStore.getMission(mission.id)) as MissionRecord
}
