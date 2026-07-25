import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { startMirrorMission } from '../service'

export const mirrorScanTool = createTool({
  id: 'run-mirror-duplicate-bills',
  description:
    'Run Mirror Intelligence now against recent Odoo vendor bills, vendor identities, and invoice lines.',
  inputSchema: z.object({
    lookbackDays: z.number().int().min(1).max(1_825).default(365),
    limit: z.number().int().min(2).max(100).default(50)
  }),
  outputSchema: z.object({
    missionId: z.string().uuid(),
    status: z.string(),
    summary: z.string(),
    result: z.unknown().optional()
  }),
  execute: async ({ lookbackDays, limit }) => {
    const mission = await startMirrorMission({
      source: 'chat',
      lookbackDays,
      limit,
      notifyOnlyWhenAttention: true
    })
    return {
      missionId: mission.id,
      status: mission.status,
      summary: mission.summary,
      result: mission.result
    }
  }
})
