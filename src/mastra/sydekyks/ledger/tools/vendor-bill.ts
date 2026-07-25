import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { ledgerBillInputSchema } from '../../../domain/schemas'
import { startLedgerMission } from '../service'

export const ledgerWorkflowTool = createTool({
  id: 'start-ledger-vendor-bill',
  description:
    'Start Ledger’s durable vendor-bill workflow. Use only after every required bill field is known. The result may require a user approval in Mission Control.',
  inputSchema: ledgerBillInputSchema,
  outputSchema: z.object({
    missionId: z.string(),
    status: z.string(),
    summary: z.string(),
    approval: z.unknown().optional(),
    result: z.unknown().optional()
  }),
  execute: async (input) => {
    const mission = await startLedgerMission(input, { type: 'chat' })
    const workflow = mission.result as { status?: string; suspendPayload?: unknown } | undefined
    return {
      missionId: mission.id,
      status: mission.status,
      summary: mission.summary,
      approval: workflow?.suspendPayload,
      result: mission.result
    }
  }
})
