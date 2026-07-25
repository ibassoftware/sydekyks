import { randomUUID } from 'node:crypto'
import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { agentDelegationOutputSchema } from '../../../shared/agent-activity'
import { aiRuntime } from '../../lib/ai-runtime'
import { buildAgentWorkReport } from '../work-report'
import { ledgerReportProjection } from '../work-report-projections'
import { ledgerAgent } from './agent'

export const delegateLedgerTool = createTool({
  id: 'delegate-to-ledger',
  description:
    'Hand vendor-bill and Odoo accounts-payable work to Ledger. Ledger collects missing facts and may start the durable vendor-bill workflow.',
  inputSchema: z.object({
    request: z.string().min(1).max(12_000)
  }),
  outputSchema: agentDelegationOutputSchema,
  execute: async ({ request }) => {
    const result = await ledgerAgent.generate(request, {
      memory: { resource: 'local-user-ledger', thread: `syd-delegation-${randomUUID()}` },
      modelSettings: aiRuntime.getDeterministicModelSettings({
        maxOutputTokens: 1_500,
        maxRetries: 1
      }),
      abortSignal: AbortSignal.timeout(90_000)
    })
    return {
      response: result.text,
      workReport: buildAgentWorkReport(
        'Ledger',
        result,
        {
          ledgerWorkflowTool: {
            label: 'Started the vendor-bill workflow',
            detail:
              'Validated the supplied bill facts and handed them to the approval-aware workflow.',
            dataSources: [
              { name: 'User-supplied bill details' },
              {
                name: 'Odoo accounting records',
                detail: 'Vendors, bills, currencies, taxes, accounts, and vendor history.'
              },
              { name: 'Ledger Intelligence', detail: 'Account and tax recommendations.' },
              { name: 'Ledger workflow', detail: 'Approval, draft creation, and read-back state.' }
            ]
          },
          'start-ledger-vendor-bill': {
            label: 'Started the vendor-bill workflow',
            detail:
              'Validated the supplied bill facts and handed them to the approval-aware workflow.',
            dataSources: [
              { name: 'User-supplied bill details' },
              {
                name: 'Odoo accounting records',
                detail: 'Vendors, bills, currencies, taxes, accounts, and vendor history.'
              },
              { name: 'Ledger Intelligence', detail: 'Account and tax recommendations.' },
              { name: 'Ledger workflow', detail: 'Approval, draft creation, and read-back state.' }
            ]
          }
        },
        ledgerReportProjection(result)
      )
    }
  }
})
