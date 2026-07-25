import { randomUUID } from 'node:crypto'
import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { agentDelegationOutputSchema } from '../../../shared/agent-activity'
import { aiRuntime } from '../../lib/ai-runtime'
import { buildAgentWorkReport } from '../work-report'
import { shieldReportProjection } from '../work-report-projections'
import { shieldAgent } from './agent'

export const delegateShieldTool = createTool({
  id: 'delegate-to-shield',
  description: 'Hand AP fraud-risk reviews and recurring vendor-risk watches to Shield.',
  inputSchema: z.object({ request: z.string().min(1).max(12_000) }),
  outputSchema: agentDelegationOutputSchema,
  execute: async ({ request }) => {
    const result = await shieldAgent.generate(request, {
      memory: { resource: 'local-user-shield', thread: `syd-delegation-${randomUUID()}` },
      modelSettings: aiRuntime.getDeterministicModelSettings({
        maxOutputTokens: 2_500,
        maxRetries: 1
      }),
      abortSignal: AbortSignal.timeout(180_000)
    })
    return {
      response: result.text,
      workReport: buildAgentWorkReport(
        'Shield',
        result,
        {
          shieldReviewTool: {
            label: 'AP fraud-risk review',
            detail:
              'Read bounded Odoo evidence and attempted the Watch, Assess, Rank, and Brief review.',
            dataSources: [
              { name: 'Odoo vendor bills' },
              { name: 'Odoo vendor-master changes' },
              { name: 'Odoo invoice lines and identity fingerprints' },
              { name: 'Shield Intelligence', detail: 'Risk assessment and auditor brief.' }
            ]
          },
          'run-shield-fraud-review': {
            label: 'AP fraud-risk review',
            detail:
              'Read bounded Odoo evidence and attempted the Watch, Assess, Rank, and Brief review.',
            dataSources: [
              { name: 'Odoo vendor bills' },
              { name: 'Odoo vendor-master changes' },
              { name: 'Odoo invoice lines and identity fingerprints' },
              { name: 'Shield Intelligence', detail: 'Risk assessment and auditor brief.' }
            ]
          },
          proposeShieldAutomationTool: {
            label: 'Checked the Shield automation schedule',
            detail:
              'Compared the requested risk watch with current automations before writing a draft.',
            dataSources: [
              { name: 'Conversation scheduling request' },
              { name: 'Local automation store' }
            ]
          },
          'propose-shield-automation': {
            label: 'Checked the Shield automation schedule',
            detail:
              'Compared the requested risk watch with current automations before writing a draft.',
            dataSources: [
              { name: 'Conversation scheduling request' },
              { name: 'Local automation store' }
            ]
          }
        },
        shieldReportProjection(result)
      )
    }
  }
})
