import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { automationSpecCreateSchema, automationSpecUpdateSchema } from '../domain/schemas'
import { appStore } from '../lib/app-store'
import { createAutomationSpec, deleteAutomationSpec, updateAutomationSpec } from './spec-service'

const automationSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  sidekickId: z.string(),
  sidekickName: z.string(),
  sidekickVersion: z.number().int().positive(),
  prompt: z.string(),
  triggerLabel: z.string(),
  approvalMode: z.enum(['read-only', 'approval-required']),
  status: z.enum(['draft', 'active', 'paused', 'error'])
})

interface AutomationSummary {
  id: string
  name: string
  sidekickId: string
  sidekickName: string
  sidekickVersion: number
  prompt: string
  triggerLabel: string
  approvalMode: 'read-only' | 'approval-required'
  status: 'draft' | 'active' | 'paused' | 'error'
}

const summarize = (
  automation: Awaited<ReturnType<typeof createAutomationSpec>>
): AutomationSummary => ({
  id: automation.id,
  name: automation.name,
  sidekickId: automation.sidekickId,
  sidekickName: automation.sidekickName,
  sidekickVersion: automation.sidekickVersion,
  prompt: automation.prompt,
  triggerLabel: automation.triggerLabel,
  approvalMode: automation.approvalMode,
  status: automation.status
})

export const listAutomationSpecsTool = createTool({
  id: 'list-automation-specs',
  description: 'List the current generic Sidekick automations.',
  inputSchema: z.object({}),
  outputSchema: z.object({ automations: z.array(automationSummarySchema) }),
  execute: async () => ({ automations: (await appStore.listAutomationSpecs()).map(summarize) })
})

export const createAutomationSpecTool = createTool({
  id: 'create-automation-spec',
  description:
    'Create a declarative manual, scheduled, or email-triggered automation for an existing Sidekick. Create it as a draft unless the user explicitly asks to activate it. This pauses for approval.',
  inputSchema: automationSpecCreateSchema,
  outputSchema: automationSummarySchema,
  requireApproval: true,
  execute: async (input) => summarize(await createAutomationSpec(input))
})

export const updateAutomationSpecTool = createTool({
  id: 'update-automation-spec',
  description:
    'Change, pause, activate, or re-pin one current Sidekick automation. List it first and use repinSidekick only after reviewing a skill-version drift. This pauses for approval.',
  inputSchema: z.object({
    id: z.string().uuid(),
    changes: automationSpecUpdateSchema
  }),
  outputSchema: automationSummarySchema,
  requireApproval: true,
  execute: async ({ id, changes }) => summarize(await updateAutomationSpec(id, changes))
})

export const deleteAutomationSpecTool = createTool({
  id: 'delete-automation-spec',
  description:
    'Delete one exact automation by current ID. Resolve the ID by listing automations first. This always pauses for approval.',
  inputSchema: z.object({ id: z.string().uuid() }),
  outputSchema: z.object({ deleted: z.boolean(), id: z.string().uuid() }),
  requireApproval: true,
  execute: async ({ id }) => {
    if (!(await appStore.getAutomationSpec(id))) throw new Error('The automation was not found')
    await deleteAutomationSpec(id)
    return { deleted: true, id }
  }
})
