import { z } from 'zod'
import { isValidOdooFieldName, isValidOdooModelName } from '../../shared/odoo-read-policy'

export const odooBusinessModelSchema = z
  .string()
  .trim()
  .min(2)
  .max(120)
  .refine(isValidOdooModelName, 'Choose a valid Odoo model name')

const odooBusinessFieldSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .refine(isValidOdooFieldName, 'Choose a valid Odoo field name')

const odooBusinessFieldsSchema = z.array(odooBusinessFieldSchema).min(1).max(24)
const providerOdooFieldsSchema = z.array(odooBusinessFieldSchema).max(24).nullable().optional()

const odooFilterValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.string()).max(50),
  z.array(z.number()).max(50),
  z.array(z.boolean()).max(50)
])

const odooFilterListSchema = z
  .array(
    z.object({
      field: odooBusinessFieldSchema,
      operator: z.enum([
        '=',
        '!=',
        '>',
        '>=',
        '<',
        '<=',
        '=?',
        'like',
        'not like',
        'ilike',
        'not ilike',
        'in',
        'not in',
        'child_of',
        'parent_of'
      ]),
      value: odooFilterValueSchema
    })
  )
  .max(20)

const odooFiltersSchema = odooFilterListSchema.optional()

const window = {
  limit: z.number().int().min(1).max(50).default(20),
  offset: z.number().int().min(0).default(0)
}

export const odooBusinessReadInputSchema = z.object({
  operation: z
    .enum(['discoverModels', 'discoverFields', 'fieldsGet', 'search', 'read', 'searchRead'])
    .describe('The read-only lookup step to perform'),
  model: odooBusinessModelSchema
    .nullable()
    .optional()
    .describe('Required for every operation except discoverModels'),
  query: z
    .string()
    .trim()
    .max(100)
    .nullable()
    .optional()
    .describe('Required for discoverModels; optional for discoverFields'),
  fields: providerOdooFieldsSchema.describe('Required for fieldsGet, read, and searchRead'),
  filters: odooFilterListSchema
    .nullable()
    .optional()
    .describe(
      'Optional field/operator/value filters for search or searchRead; filters are combined with AND'
    ),
  ids: z
    .array(z.number().int().positive())
    .max(50)
    .nullable()
    .optional()
    .describe('Required for read'),
  limit: z.number().int().min(1).max(120).nullable().optional(),
  offset: z.number().int().min(0).nullable().optional()
})

export const normalizeOdooBusinessReadInput = (
  input: z.infer<typeof odooBusinessReadInputSchema>
): Record<string, unknown> => {
  const normalized = {
    ...input,
    model: input.model ?? undefined,
    query: input.query?.trim() || undefined,
    fields: input.fields?.length ? input.fields : undefined,
    filters: input.filters?.length ? input.filters : undefined,
    ids: input.ids?.length ? input.ids : undefined,
    limit: input.limit ?? undefined,
    offset: input.offset ?? undefined
  }
  const pruned = Object.fromEntries(
    Object.entries(normalized).filter(([, value]) => value !== undefined)
  )
  if (normalized.limit === undefined) return pruned
  const maximum =
    input.operation === 'discoverModels' ? 20 : input.operation === 'discoverFields' ? 120 : 50
  return { ...pruned, limit: Math.min(normalized.limit, maximum) }
}

export const odooBusinessReadRequestSchema = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('discoverModels'),
    query: z.string().trim().min(2).max(100),
    limit: z.number().int().min(1).max(20).default(12)
  }),
  z.object({
    operation: z.literal('discoverFields'),
    model: odooBusinessModelSchema,
    query: z.string().trim().min(2).max(100).optional(),
    limit: z.number().int().min(1).max(120).default(80)
  }),
  z.object({
    operation: z.literal('fieldsGet'),
    model: odooBusinessModelSchema,
    fields: odooBusinessFieldsSchema
  }),
  z.object({
    operation: z.literal('search'),
    model: odooBusinessModelSchema,
    filters: odooFiltersSchema,
    ...window
  }),
  z.object({
    operation: z.literal('read'),
    model: odooBusinessModelSchema,
    ids: z.array(z.number().int().positive()).min(1).max(50),
    fields: odooBusinessFieldsSchema
  }),
  z.object({
    operation: z.literal('searchRead'),
    model: odooBusinessModelSchema,
    filters: odooFiltersSchema,
    fields: odooBusinessFieldsSchema,
    ...window
  })
])
