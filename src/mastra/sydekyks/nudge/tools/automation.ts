import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import {
  automationProposalOutputSchema,
  createDraftAutomationFromCadence,
  recurringAutomationFields
} from '../../../automations/proposal'

export const proposeNudgeAutomationTool = createTool({
  id: 'propose-nudge-automation',
  description:
    'Check for an equivalent Nudge schedule, then create a DRAFT only when none exists or the user explicitly requested another.',
  inputSchema: z.object({
    ...recurringAutomationFields,
    staleAfterDays: z.number().int().min(1).max(365).default(2),
    notifyOnlyWhenAttention: z.boolean().default(true)
  }),
  outputSchema: automationProposalOutputSchema,
  execute: async (input) =>
    createDraftAutomationFromCadence({
      recurring: input,
      ownerSydekykId: 'nudge',
      workflowId: 'nudge-stale-opportunities',
      inputData: {
        staleAfterDays: input.staleAfterDays,
        limit: 50,
        notifyOnlyWhenAttention: input.notifyOnlyWhenAttention
      }
    })
})
