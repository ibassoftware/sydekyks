import { randomUUID } from 'node:crypto'
import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { agentDelegationOutputSchema } from '../../../shared/agent-activity'
import { aiRuntime } from '../../lib/ai-runtime'
import { buildAgentWorkReport } from '../work-report'
import { nudgeReportProjection } from '../work-report-projections'
import { nudgeAgent } from './agent'

export const delegateNudgeTool = createTool({
  id: 'delegate-to-nudge',
  description:
    'Hand CRM opportunity-attention checks and recurring stale-pipeline schedules to Nudge.',
  inputSchema: z.object({ request: z.string().min(1).max(12_000) }),
  outputSchema: agentDelegationOutputSchema,
  execute: async ({ request }) => {
    const result = await nudgeAgent.generate(request, {
      memory: { resource: 'local-user-nudge', thread: `syd-delegation-${randomUUID()}` },
      modelSettings: aiRuntime.getDeterministicModelSettings({
        maxOutputTokens: 2_000,
        maxRetries: 1
      }),
      abortSignal: AbortSignal.timeout(120_000)
    })
    return {
      response: result.text,
      workReport: buildAgentWorkReport(
        'Nudge',
        result,
        {
          nudgeCheckTool: {
            label: 'Checked the CRM pipeline',
            detail:
              'Read bounded Odoo opportunity, activity, and message facts through Nudge’s workflow.',
            dataSources: [
              { name: 'Odoo CRM opportunities' },
              { name: 'Odoo activities' },
              { name: 'Odoo messages', detail: 'Bounded recent conversation facts.' },
              { name: 'Nudge Intelligence', detail: 'Attention assessment and recommendations.' }
            ]
          },
          'run-nudge-stale-opportunities': {
            label: 'Checked the CRM pipeline',
            detail:
              'Read bounded Odoo opportunity, activity, and message facts through Nudge’s workflow.',
            dataSources: [
              { name: 'Odoo CRM opportunities' },
              { name: 'Odoo activities' },
              { name: 'Odoo messages', detail: 'Bounded recent conversation facts.' },
              { name: 'Nudge Intelligence', detail: 'Attention assessment and recommendations.' }
            ]
          },
          proposeNudgeAutomationTool: {
            label: 'Checked the Nudge automation schedule',
            detail: 'Compared the requested watch with current automations before writing a draft.',
            dataSources: [
              { name: 'Conversation scheduling request' },
              { name: 'Local automation store' }
            ]
          },
          'propose-nudge-automation': {
            label: 'Checked the Nudge automation schedule',
            detail: 'Compared the requested watch with current automations before writing a draft.',
            dataSources: [
              { name: 'Conversation scheduling request' },
              { name: 'Local automation store' }
            ]
          }
        },
        nudgeReportProjection(result)
      )
    }
  }
})
