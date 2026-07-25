import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { isValidOdooFieldName } from '../../shared/odoo-read-policy'
import { genericOdooRequestSchema, sidekickOperationSchema } from '../domain/schemas'
import {
  discoverReadableOdooModels,
  odooGadget,
  runGenericOdooOperation
} from '../gadgets/odoo-gateway'
import { appStore } from '../lib/app-store'
import { odooBusinessModelSchema } from './odoo-business-read-schema'

const valuesSchema = z
  .record(z.string().refine(isValidOdooFieldName, 'Choose valid Odoo field names'), z.unknown())
  .refine((values) => Object.keys(values).length > 0, 'Provide at least one field value')

const inputSchema = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('create'),
    sidekickId: z.string().min(2),
    model: odooBusinessModelSchema,
    entityLabel: z.string().trim().min(2).max(120),
    values: valuesSchema
  }),
  z.object({
    operation: z.literal('update'),
    sidekickId: z.string().min(2),
    model: odooBusinessModelSchema,
    entityLabel: z.string().trim().min(2).max(120),
    ids: z.array(z.number().int().positive()).min(1).max(50),
    values: valuesSchema
  }),
  z.object({
    operation: z.literal('archive'),
    sidekickId: z.string().min(2),
    model: odooBusinessModelSchema,
    entityLabel: z.string().trim().min(2).max(120),
    ids: z.array(z.number().int().positive()).min(1).max(50)
  })
])

const validateEntityAndFields = async (
  input: z.infer<typeof inputSchema>
): Promise<Record<string, unknown>> => {
  const discovered = await discoverReadableOdooModels(input.entityLabel, 20)
  if (!discovered.some((entity) => entity.model === input.model)) {
    throw new Error(
      `The connected Odoo did not confirm ${input.entityLabel} as ${input.model}. Discover the entity again before writing.`
    )
  }
  const schema = await odooGadget.getGateway().fieldsGet(input.model)
  const values = input.operation === 'archive' ? { active: false } : input.values
  for (const field of Object.keys(values)) {
    const descriptor = schema[field]
    if (!descriptor || typeof descriptor !== 'object') {
      throw new Error(`${input.entityLabel} does not expose the field ${field}`)
    }
    if ((descriptor as Record<string, unknown>).readonly === true) {
      throw new Error(`${field} is read-only on ${input.entityLabel}`)
    }
  }
  if (input.operation === 'archive' && !('active' in schema)) {
    throw new Error(`${input.entityLabel} does not support archiving`)
  }
  return values
}

export const writeOdooBusinessDataTool = createTool({
  id: 'write-odoo-business-data',
  description:
    'Create, update, or archive records in any discovered standard or custom Odoo business entity. Before this tool, discover the entity and fields, resolve referenced records, and grant the active Sidekick the exact operation. The input is the user-visible preview and execution always pauses for explicit approval. Deletion is intentionally unsupported.',
  inputSchema,
  outputSchema: z.object({
    dryRun: z.boolean(),
    operation: sidekickOperationSchema,
    sidekickId: z.string(),
    entity: z.object({ model: z.string(), label: z.string() }),
    ids: z.array(z.number().int().positive()),
    odooRecords: z.array(
      z.object({
        id: z.number().int().positive(),
        model: odooBusinessModelSchema,
        label: z.string().min(1)
      })
    ),
    result: z.unknown(),
    missionId: z.string().uuid().optional()
  }),
  requireApproval: true,
  execute: async (input) => {
    const sidekick = await appStore.getSidekick(input.sidekickId)
    if (!sidekick || sidekick.status !== 'active') throw new Error('The Sidekick is not active')
    const capabilityOperation = input.operation
    if (
      !(await appStore.hasSidekickCapability(input.sidekickId, input.model, capabilityOperation))
    ) {
      throw new Error(
        `${sidekick.name} does not have ${capabilityOperation} access to ${input.entityLabel}. Ask to grant that exact capability first.`
      )
    }

    const values = await validateEntityAndFields(input)
    const output = await runGenericOdooOperation(
      genericOdooRequestSchema.parse(
        input.operation === 'create'
          ? {
              operation: 'create',
              model: input.model,
              values,
              confirmWrite: true
            }
          : {
              operation: 'write',
              model: input.model,
              ids: input.ids,
              values,
              confirmWrite: true
            }
      )
    )
    const resultRecord =
      output.result && typeof output.result === 'object'
        ? (output.result as Record<string, unknown>)
        : {}
    const ids =
      input.operation === 'create' && typeof resultRecord.id === 'number'
        ? [resultRecord.id]
        : input.operation === 'create'
          ? []
          : input.ids
    let missionId: string | undefined
    if (!output.dryRun) {
      const mission = await appStore.createMission({
        kind: 'odoo.generic-write',
        sydekyk: sidekick.name,
        title: `${sidekick.name} · ${input.operation} ${input.entityLabel}`,
        summary: `${sidekick.name} completed an approved ${input.operation} on ${ids.length} ${input.entityLabel} ${ids.length === 1 ? 'record' : 'records'}.`,
        status: 'completed',
        payload: {
          model: input.model,
          operation: input.operation,
          ids,
          values,
          sidekickVersion: sidekick.version
        },
        result: output.result
      })
      missionId = mission.id
    }
    return {
      dryRun: output.dryRun,
      operation: capabilityOperation,
      sidekickId: input.sidekickId,
      entity: { model: input.model, label: input.entityLabel },
      ids,
      odooRecords: ids.map((id) => ({
        id,
        model: input.model,
        label: `${input.entityLabel} ${id}`
      })),
      result: output.result,
      missionId
    }
  }
})
