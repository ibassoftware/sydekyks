import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { startShieldMission } from '../service'

export const shieldReviewTool = createTool({
  id: 'run-shield-fraud-review',
  description:
    'Run Shield Intelligence now through Watch, Assess, Rank, and Brief for Odoo accounts payable.',
  inputSchema: z.object({
    lookbackDays: z.number().int().min(1).max(1_825).default(90),
    limit: z.number().int().min(1).max(100).default(50)
  }),
  outputSchema: z.object({
    missionId: z.string().uuid(),
    status: z.string(),
    summary: z.string(),
    result: z.unknown().optional()
  }),
  execute: async ({ lookbackDays, limit }) => {
    const mission = await startShieldMission({
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
