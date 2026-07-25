import { randomUUID } from 'node:crypto'
import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { agentDelegationOutputSchema } from '../../../shared/agent-activity'
import { aiRuntime } from '../../lib/ai-runtime'
import { buildAgentWorkReport } from '../work-report'
import { mirrorReportProjection } from '../work-report-projections'
import { mirrorAgent } from './agent'

export const delegateMirrorTool = createTool({
  id: 'delegate-to-mirror',
  description: 'Hand duplicate vendor-bill scans and recurring duplicate watches to Mirror.',
  inputSchema: z.object({ request: z.string().min(1).max(12_000) }),
  outputSchema: agentDelegationOutputSchema,
  execute: async ({ request }) => {
    const result = await mirrorAgent.generate(request, {
      memory: { resource: 'local-user-mirror', thread: `syd-delegation-${randomUUID()}` },
      modelSettings: aiRuntime.getDeterministicModelSettings({
        maxOutputTokens: 2_500,
        maxRetries: 1
      }),
      abortSignal: AbortSignal.timeout(180_000)
    })
    return {
      response: result.text,
      workReport: buildAgentWorkReport(
        'Mirror',
        result,
        {
          mirrorScanTool: {
            label: 'Scanned for duplicate bills',
            detail: 'Ran the bounded Odoo bill screening and line-item confirmation workflow.',
            dataSources: [
              { name: 'Odoo vendor bills' },
              { name: 'Odoo vendor identity fingerprints' },
              { name: 'Odoo invoice lines' },
              { name: 'Mirror Intelligence', detail: 'Candidate screening and confirmation.' }
            ]
          },
          'run-mirror-duplicate-bills': {
            label: 'Scanned for duplicate bills',
            detail: 'Ran the bounded Odoo bill screening and line-item confirmation workflow.',
            dataSources: [
              { name: 'Odoo vendor bills' },
              { name: 'Odoo vendor identity fingerprints' },
              { name: 'Odoo invoice lines' },
              { name: 'Mirror Intelligence', detail: 'Candidate screening and confirmation.' }
            ]
          },
          proposeMirrorAutomationTool: {
            label: 'Checked the Mirror automation schedule',
            detail:
              'Compared the requested duplicate watch with current automations before writing a draft.',
            dataSources: [
              { name: 'Conversation scheduling request' },
              { name: 'Local automation store' }
            ]
          },
          'propose-mirror-automation': {
            label: 'Checked the Mirror automation schedule',
            detail:
              'Compared the requested duplicate watch with current automations before writing a draft.',
            dataSources: [
              { name: 'Conversation scheduling request' },
              { name: 'Local automation store' }
            ]
          }
        },
        mirrorReportProjection(result)
      )
    }
  }
})
