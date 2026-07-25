import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import {
  automationProposalOutputSchema,
  createDraftAutomationFromCadence,
  recurringAutomationFields
} from '../../../automations/proposal'

export const proposeShieldAutomationTool = createTool({
  id: 'propose-shield-automation',
  description:
    'Check for an equivalent Shield watch, then create a DRAFT only when none exists or the user explicitly requested another.',
  inputSchema: z.object({
    ...recurringAutomationFields,
    lookbackDays: z.number().int().min(1).max(1_825).default(90),
    notifyOnlyWhenAttention: z.boolean().default(true)
  }),
  outputSchema: automationProposalOutputSchema,
  execute: async (input) =>
    createDraftAutomationFromCadence({
      recurring: input,
      ownerSydekykId: 'shield',
      workflowId: 'shield-fraud-review',
      inputData: {
        lookbackDays: input.lookbackDays,
        limit: 50,
        notifyOnlyWhenAttention: input.notifyOnlyWhenAttention
      }
    })
})
