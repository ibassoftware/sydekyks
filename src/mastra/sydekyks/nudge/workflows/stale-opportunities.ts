import { createStep, createWorkflow } from '@mastra/core/workflows'
import { z } from 'zod'
import {
  nudgeCheckInputSchema,
  nudgeOpportunityFactSchema,
  nudgeResultSchema
} from '../../../domain/schemas'
import { analyzeStaleOpportunities } from '../intelligence-service'
import { readOpportunityFacts } from '../tools/crm-opportunities'

const nudgeContextSchema = z.object({
  request: nudgeCheckInputSchema,
  opportunities: z.array(nudgeOpportunityFactSchema)
})

const validateRequest = createStep({
  id: 'validate-nudge-request',
  description: 'Validate the requested CRM attention window and trigger source.',
  inputSchema: nudgeCheckInputSchema,
  outputSchema: nudgeCheckInputSchema,
  execute: async ({ inputData }) => inputData
})

const gatherOpportunityContext = createStep({
  id: 'gather-crm-context',
  description: 'Read allowlisted CRM opportunities, activities, and messages through Odoo.',
  inputSchema: nudgeCheckInputSchema,
  outputSchema: nudgeContextSchema,
  execute: async ({ inputData }) => ({
    request: inputData,
    opportunities: await readOpportunityFacts(inputData.limit)
  })
})

const assessAttention = createStep({
  id: 'assess-opportunity-attention',
  description: 'Use Nudge Intelligence to rank genuinely neglected opportunities.',
  inputSchema: nudgeContextSchema,
  outputSchema: nudgeResultSchema,
  execute: async ({ inputData }) => {
    if (inputData.opportunities.length === 0) {
      return {
        outcome: 'no-opportunities' as const,
        message: 'Nudge found no open opportunities in the configured Odoo company.',
        totalChecked: 0,
        attentionCount: 0
      }
    }
    const assessment = await analyzeStaleOpportunities(
      inputData.opportunities,
      inputData.request.staleAfterDays
    )
    const attentionCount = assessment.opportunities.filter((item) => item.stale).length
    return {
      outcome: 'completed' as const,
      message:
        attentionCount === 0
          ? `Nudge checked ${inputData.opportunities.length} opportunities and found no neglected work.`
          : `Nudge checked ${inputData.opportunities.length} opportunities and found ${attentionCount} that need attention.`,
      totalChecked: inputData.opportunities.length,
      attentionCount,
      assessment
    }
  }
})

export const nudgeStaleOpportunitiesWorkflow = createWorkflow({
  id: 'nudge-stale-opportunities',
  inputSchema: nudgeCheckInputSchema,
  outputSchema: nudgeResultSchema
})
  .then(validateRequest)
  .then(gatherOpportunityContext)
  .then(assessAttention)
  .commit()
