import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import {
  sidekickCapabilitySchema,
  sidekickCreateSchema,
  sidekickStatusSchema,
  sidekickUpdateSchema
} from '../domain/schemas'
import { createSidekick, listSidekicks, setSidekickCapability, updateSidekick } from './service'

const sidekickSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  source: z.enum(['preset', 'user']),
  status: sidekickStatusSchema,
  version: z.number().int().positive(),
  capabilities: z.array(sidekickCapabilitySchema)
})

interface SidekickSummary {
  id: string
  name: string
  description: string
  source: 'preset' | 'user'
  status: 'active' | 'paused'
  version: number
  capabilities: Array<z.infer<typeof sidekickCapabilitySchema>>
}

const summarize = (sidekick: Awaited<ReturnType<typeof createSidekick>>): SidekickSummary => ({
  id: sidekick.id,
  name: sidekick.name,
  description: sidekick.description,
  source: sidekick.source,
  status: sidekick.status,
  version: sidekick.version,
  capabilities: sidekick.capabilities
})

export const listSidekicksTool = createTool({
  id: 'list-sidekicks',
  description:
    'List the current Sidekicks, their versions, status, and explicitly granted Odoo capabilities.',
  inputSchema: z.object({ activeOnly: z.boolean().default(false) }),
  outputSchema: z.object({ sidekicks: z.array(sidekickSummarySchema) }),
  execute: async ({ activeOnly }) => ({
    sidekicks: (await listSidekicks(activeOnly)).map(summarize)
  })
})

export const createSidekickTool = createTool({
  id: 'create-sidekick',
  description:
    'Create a reusable Sidekick from a name, business description, and Markdown skill instructions. Use only when the user explicitly asks to create one. This pauses for approval.',
  inputSchema: sidekickCreateSchema,
  outputSchema: sidekickSummarySchema,
  requireApproval: true,
  execute: async (input) => summarize(await createSidekick(input))
})

export const updateSidekickTool = createTool({
  id: 'update-sidekick',
  description:
    'Update, pause, or reactivate an existing Sidekick. Instruction changes create a new immutable version. This pauses for approval.',
  inputSchema: z.object({
    id: z.string().min(2),
    changes: sidekickUpdateSchema
  }),
  outputSchema: sidekickSummarySchema,
  requireApproval: true,
  execute: async ({ id, changes }) => summarize(await updateSidekick(id, changes))
})

export const grantSidekickCapabilityTool = createTool({
  id: 'grant-sidekick-capability',
  description:
    'Grant a Sidekick exact operations on one Odoo business entity after discovery. A skill cannot grant itself access. This always pauses for explicit approval.',
  inputSchema: z.object({
    sidekickId: z.string().min(2),
    capability: sidekickCapabilitySchema
  }),
  outputSchema: z.object({
    sidekickId: z.string(),
    capability: sidekickCapabilitySchema
  }),
  requireApproval: true,
  execute: async ({ sidekickId, capability }) => ({
    sidekickId,
    capability: await setSidekickCapability(sidekickId, capability)
  })
})
