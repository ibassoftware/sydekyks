import { createStep, createWorkflow } from '@mastra/core/workflows'
import { z } from 'zod'
import { dispatchDueAutomations } from './service'

const dispatcherResultSchema = z.object({
  due: z.number().int().nonnegative(),
  started: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative()
})

const dispatchDue = createStep({
  id: 'dispatch-due-automations',
  inputSchema: z.object({}),
  outputSchema: dispatcherResultSchema,
  execute: async () => dispatchDueAutomations()
})

export const automationDispatcherWorkflow = createWorkflow({
  id: 'automation-dispatcher',
  inputSchema: z.object({}),
  outputSchema: dispatcherResultSchema,
  schedule: {
    cron: '* * * * *',
    timezone: 'UTC',
    inputData: {},
    metadata: { internal: true, owner: 'Syd' }
  }
})
  .then(dispatchDue)
  .commit()
