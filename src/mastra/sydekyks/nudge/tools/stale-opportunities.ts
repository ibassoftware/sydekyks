import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { startNudgeMission } from '../service'

export const nudgeCheckTool = createTool({
  id: 'run-nudge-stale-opportunities',
  description:
    'Run Nudge Intelligence now against open Odoo opportunities, planned activities, and recent messages.',
  inputSchema: z.object({
    staleAfterDays: z.number().int().min(1).max(365).default(2),
    limit: z.number().int().min(1).max(100).default(50)
  }),
  outputSchema: z.object({
    missionId: z.string().uuid(),
    status: z.string(),
    summary: z.string(),
    result: z.unknown().optional()
  }),
  execute: async ({ staleAfterDays, limit }) => {
    const mission = await startNudgeMission({
      source: 'chat',
      staleAfterDays,
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
