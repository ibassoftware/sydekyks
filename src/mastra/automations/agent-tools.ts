import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import type { AutomationRecord } from '../domain/schemas'
import { appStore } from '../lib/app-store'
import { deleteAutomations } from './service'

const ownerSchema = z.enum(['nudge', 'mirror', 'shield'])
const statusSchema = z.enum(['draft', 'active', 'paused', 'error'])

const automationSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  ownerSydekykId: ownerSchema,
  status: statusSchema,
  scheduleLabel: z.string(),
  timezone: z.string(),
  nextRunAt: z.string().optional()
})

const summarizeAutomation = (
  automation: AutomationRecord
): z.infer<typeof automationSummarySchema> => ({
  id: automation.id,
  name: automation.name,
  ownerSydekykId: automation.ownerSydekykId,
  status: automation.status,
  scheduleLabel: automation.scheduleLabel,
  timezone: automation.schedule.timezone,
  nextRunAt: automation.nextRunAt
})

export const listSydAutomationsTool = createTool({
  id: 'list-syd-automations',
  description:
    "List the user's current local automations across Nudge, Mirror, and Shield. Use this before referring to, selecting, or deleting automations so IDs and status are current.",
  inputSchema: z.object({
    ownerSydekykId: ownerSchema
      .optional()
      .describe('Only return automations owned by this Sydekyk.'),
    status: statusSchema.optional().describe('Only return automations with this status.'),
    nameContains: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .optional()
      .describe('Case-insensitive text that the automation name must contain.'),
    limit: z.number().int().min(1).max(100).default(50)
  }),
  outputSchema: z.object({
    automations: z.array(automationSummarySchema),
    totalMatches: z.number().int().nonnegative(),
    truncated: z.boolean()
  }),
  execute: async ({ ownerSydekykId, status, nameContains, limit }) => {
    const normalizedName = nameContains?.toLocaleLowerCase()
    const matches = (await appStore.listAutomations(500)).filter(
      (automation) =>
        (!ownerSydekykId || automation.ownerSydekykId === ownerSydekykId) &&
        (!status || automation.status === status) &&
        (!normalizedName || automation.name.toLocaleLowerCase().includes(normalizedName))
    )
    return {
      automations: matches.slice(0, limit).map(summarizeAutomation),
      totalMatches: matches.length,
      truncated: matches.length > limit
    }
  }
})

export const deleteSydAutomationsTool = createTool({
  id: 'delete-syd-automations',
  description:
    'Delete an exact set of current Nudge, Mirror, or Shield automations by ID. This destructive operation always pauses for explicit user approval before execution.',
  inputSchema: z.object({
    automationIds: z
      .array(z.string().uuid())
      .min(1)
      .max(50)
      .describe('Exact automation IDs selected from a fresh listAutomations result.')
  }),
  outputSchema: z.object({
    deleted: z.array(automationSummarySchema),
    deletedCount: z.number().int().nonnegative()
  }),
  requireApproval: true,
  execute: async ({ automationIds }) => {
    const deleted = await deleteAutomations(automationIds)
    return {
      deleted: deleted.map(summarizeAutomation),
      deletedCount: deleted.length
    }
  }
})
