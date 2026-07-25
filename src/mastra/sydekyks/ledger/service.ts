import type { ApprovalDecision, LedgerBillInput, MissionRecord } from '../../domain/schemas'
import { appStore } from '../../lib/app-store'
import { friendlyErrorMessage, missionErrorDiagnostic } from '../../lib/errors'
import { ledgerVendorBillWorkflow } from './workflows/vendor-bill'

export interface LedgerMissionSource {
  type: 'chat' | 'inbound-email' | 'mission-control'
  documentId?: string
  emailId?: string
  fromAddress?: string
  subject?: string
}

const safeWorkflowResult = (result: Record<string, unknown>): Record<string, unknown> => {
  if (result.status === 'success') return { status: result.status, result: result.result }
  if (result.status === 'suspended') {
    return {
      status: result.status,
      suspended: result.suspended,
      suspendPayload: result.suspendPayload
    }
  }
  if (result.status === 'failed') {
    return {
      status: result.status,
      error: friendlyErrorMessage(result.error, 'Ledger could not complete the bill workflow.'),
      diagnostic: missionErrorDiagnostic(result.error, {
        fallback: 'Ledger could not complete the bill workflow.',
        stage: 'Workflow'
      })
    }
  }
  return { status: String(result.status) }
}

const persistResult = async (
  mission: MissionRecord,
  result: Record<string, unknown>
): Promise<MissionRecord> => {
  const safe = safeWorkflowResult(result)
  if (result.status === 'suspended') {
    const payloads = safe.suspendPayload as
      Record<string, { type?: string } | undefined> | undefined
    const approval = payloads ? Object.values(payloads)[0] : undefined
    await appStore.updateMission(mission.id, {
      status: 'waiting_approval',
      summary:
        approval?.type === 'tax-create'
          ? 'Waiting for permission to create a missing Odoo purchase tax.'
          : 'Waiting for permission to create a missing Odoo partner.',
      result: safe
    })
  } else if (result.status === 'success') {
    const output = result.result as { outcome?: string; message?: string }
    await appStore.updateMission(mission.id, {
      status:
        output.outcome === 'declined'
          ? 'declined'
          : output.outcome === 'needs-review'
            ? 'needs_attention'
            : 'completed',
      summary: output.message ?? 'Ledger completed the vendor bill workflow.',
      result: safe
    })
  } else {
    await appStore.updateMission(mission.id, {
      status: 'failed',
      summary: safe.error ? String(safe.error) : 'Ledger workflow failed.',
      result: safe
    })
  }
  return (await appStore.getMission(mission.id)) as MissionRecord
}

export const startLedgerMission = async (
  input: LedgerBillInput,
  source: LedgerMissionSource = { type: 'mission-control' }
): Promise<MissionRecord> => {
  const run = await ledgerVendorBillWorkflow.createRun({ resourceId: 'local-user' })
  const mission = await appStore.createMission({
    kind: 'ledger.vendor-bill',
    sydekyk: 'Ledger',
    title: `${input.vendorName} · ${input.invoiceNumber}`,
    summary: 'Ledger is checking the vendor bill.',
    status: 'running',
    runId: run.runId,
    payload: { bill: input, source }
  })

  try {
    const result = await run.start({ inputData: input })
    return persistResult(mission, result as unknown as Record<string, unknown>)
  } catch (error) {
    const message = friendlyErrorMessage(error, 'Ledger could not complete the bill workflow.')
    await appStore.updateMission(mission.id, {
      status: 'failed',
      summary: message,
      result: {
        status: 'failed',
        error: message,
        diagnostic: missionErrorDiagnostic(error, {
          fallback: 'Ledger could not complete the bill workflow.',
          stage: 'Workflow'
        })
      }
    })
    return (await appStore.getMission(mission.id)) as MissionRecord
  }
}

export const resumeLedgerMission = async (
  missionId: string,
  decision: ApprovalDecision
): Promise<MissionRecord> => {
  const mission = await appStore.getMission(missionId)
  if (!mission?.runId) throw new Error('The Ledger mission or its workflow run was not found')
  if (mission.status !== 'waiting_approval')
    throw new Error('This mission is not waiting for approval')

  await appStore.updateMission(mission.id, {
    status: 'running',
    summary: decision.approved
      ? 'Permission received. Ledger is continuing.'
      : 'Permission declined.'
  })
  try {
    const suspendedResult = mission.result as
      { suspendPayload?: Record<string, unknown> } | undefined
    const step = Object.keys(suspendedResult?.suspendPayload ?? {})[0]
    if (!['authorize-partner', 'authorize-tax'].includes(step)) {
      throw new Error('Ledger could not identify the suspended approval step')
    }
    const run = await ledgerVendorBillWorkflow.createRun({
      runId: mission.runId,
      resourceId: 'local-user'
    })
    const result = await run.resume({
      step,
      resumeData: decision
    })
    return persistResult(mission, result as unknown as Record<string, unknown>)
  } catch (error) {
    const message = friendlyErrorMessage(error, 'Ledger could not continue the bill workflow.')
    await appStore.updateMission(mission.id, {
      status: 'failed',
      summary: message,
      result: {
        status: 'failed',
        error: message,
        diagnostic: missionErrorDiagnostic(error, {
          fallback: 'Ledger could not continue the bill workflow.',
          stage: 'Resume'
        })
      }
    })
    return (await appStore.getMission(mission.id)) as MissionRecord
  }
}
