import type { MissionRecord, ShieldResult, ShieldScanInput } from '../../domain/schemas'
import { shieldScanInputSchema } from '../../domain/schemas'
import { aiRuntime } from '../../lib/ai-runtime'
import { appStore } from '../../lib/app-store'
import { friendlyErrorMessage, missionErrorDiagnostic } from '../../lib/errors'
import { shieldFailureStage } from './failure-stage'
import { shieldFraudReviewWorkflow } from './workflows/fraud-review'

const shieldFailure = (error: unknown): ReturnType<typeof missionErrorDiagnostic> =>
  missionErrorDiagnostic(error, {
    fallback: 'Shield could not complete the risk review.',
    model: aiRuntime.getStatus().label,
    stage: shieldFailureStage(error)
  })

const shieldFailureSummary = (
  error: unknown,
  diagnostic: ReturnType<typeof missionErrorDiagnostic>
): string =>
  diagnostic.code === 'AI_OUTPUT_VALIDATION_FAILED'
    ? diagnostic.stage === 'Brief'
      ? 'Shield read the Odoo evidence and completed the risk assessment and ranking, but could not prepare the auditor brief after two attempts. No risk scores or brief were saved.'
      : 'Shield read the Odoo evidence, but the risk assessment was incomplete after two attempts. No risk scores or auditor brief were saved.'
    : friendlyErrorMessage(error, 'Shield could not complete the risk review.')

export const startShieldMission = async (rawInput: ShieldScanInput): Promise<MissionRecord> => {
  const input = shieldScanInputSchema.parse(rawInput)
  const run = await shieldFraudReviewWorkflow.createRun({ resourceId: 'local-user' })
  const mission = await appStore.createMission({
    kind: 'shield.fraud-review',
    sydekyk: 'Shield',
    title: input.source === 'schedule' ? 'Scheduled AP risk watch' : 'Accounts-payable risk review',
    summary: 'Shield started Watch and is reading vendor-bill and vendor-master evidence.',
    status: 'running',
    runId: run.runId,
    payload: { request: input }
  })
  try {
    const result = await run.start({ inputData: input })
    if (result.status !== 'success') {
      const diagnostic = shieldFailure(result.status === 'failed' ? result.error : undefined)
      const message =
        result.status === 'failed'
          ? shieldFailureSummary(result.error, diagnostic)
          : `Workflow ended as ${result.status}`
      await appStore.updateMission(mission.id, {
        status: message.includes('AI setup required') ? 'needs_attention' : 'failed',
        summary: message,
        result: { status: result.status, error: message, diagnostic }
      })
    } else {
      const output = result.result as ShieldResult
      await appStore.updateMission(mission.id, {
        status: 'completed',
        summary: output.message,
        result: { status: 'success', result: output }
      })
    }
  } catch (error) {
    const diagnostic = shieldFailure(error)
    const message = shieldFailureSummary(error, diagnostic)
    await appStore.updateMission(mission.id, {
      status: message.includes('AI setup required') ? 'needs_attention' : 'failed',
      summary: message,
      result: { status: 'failed', error: message, diagnostic }
    })
  }
  return (await appStore.getMission(mission.id)) as MissionRecord
}
