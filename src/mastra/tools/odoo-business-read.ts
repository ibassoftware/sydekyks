import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { isValidOdooFieldName } from '../../shared/odoo-read-policy'
import { genericOdooRequestSchema } from '../domain/schemas'
import { discoverReadableOdooModels, runGenericOdooOperation } from '../gadgets/odoo-gateway'
import {
  normalizeOdooBusinessReadInput,
  odooBusinessModelSchema,
  odooBusinessReadInputSchema,
  odooBusinessReadRequestSchema
} from './odoo-business-read-schema'

const recordLabel = (modelName: string, record: Record<string, unknown>): string => {
  for (const field of ['display_name', 'name', 'partner_name', 'subject']) {
    const value = record[field]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  const technicalName = modelName.split('.').at(-1)?.replaceAll('_', ' ')
  return technicalName
    ? technicalName.replace(/\b\w/g, (letter) => letter.toLocaleUpperCase())
    : 'Odoo record'
}

const fieldRelevance = (name: string, descriptor: unknown, query: string | undefined): number => {
  const label =
    descriptor &&
    typeof descriptor === 'object' &&
    typeof (descriptor as Record<string, unknown>).string === 'string'
      ? String((descriptor as Record<string, unknown>).string)
      : ''
  const searchable = `${name.replaceAll('_', ' ')} ${label}`.toLocaleLowerCase()
  const terms = query?.toLocaleLowerCase().match(/[a-z0-9_]+/g) ?? []
  let score = ['id', 'display_name', 'name', 'active'].includes(name) ? 100 : 0
  if (terms.some((term) => term.length >= 3 && searchable.includes(term))) score += 80
  if (
    /(?:name|title|state|status|stage|date|user|owner|partner|job|amount|total|reference|ref|email|phone)/.test(
      name
    )
  ) {
    score += 30
  }
  return score
}

export const readOdooBusinessDataTool = createTool({
  id: 'read-odoo-business-data',
  description:
    'Discover and read bounded facts from the connected Odoo when no installed specialist workflow matches a direct question. Start with discoverModels using the user’s term, use discoverFields on the selected model, then read only the facts needed. Standard, custom, and metadata models are available when the connected Odoo user can read them. This tool is always read-only.',
  inputSchema: odooBusinessReadInputSchema,
  outputSchema: z.object({
    dryRun: z.literal(false),
    result: z.unknown(),
    odooRecords: z
      .array(
        z.object({
          id: z.number().int().positive(),
          model: odooBusinessModelSchema,
          label: z.string().min(1)
        })
      )
      .max(50)
  }),
  execute: async (input) => {
    const request = odooBusinessReadRequestSchema.parse(normalizeOdooBusinessReadInput(input))

    if (request.operation === 'discoverModels') {
      const result = await discoverReadableOdooModels(request.query, request.limit)
      return { dryRun: false as const, result, odooRecords: [] }
    }

    if (request.operation === 'discoverFields') {
      const output = await runGenericOdooOperation(
        genericOdooRequestSchema.parse({
          operation: 'fieldsGet',
          model: request.model,
          confirmWrite: false
        })
      )
      const schema =
        output.result && typeof output.result === 'object'
          ? (output.result as Record<string, unknown>)
          : {}
      const result = Object.fromEntries(
        Object.entries(schema)
          .filter(([name]) => isValidOdooFieldName(name))
          .sort(
            ([leftName, leftDescriptor], [rightName, rightDescriptor]) =>
              fieldRelevance(rightName, rightDescriptor, request.query) -
                fieldRelevance(leftName, leftDescriptor, request.query) ||
              leftName.localeCompare(rightName)
          )
          .slice(0, request.limit)
      )
      return { dryRun: false as const, result, odooRecords: [] }
    }

    const domain =
      'filters' in request
        ? request.filters?.map(({ field, operator, value }) => [field, operator, value])
        : undefined
    const output = await runGenericOdooOperation(
      genericOdooRequestSchema.parse({
        ...request,
        domain,
        confirmWrite: false
      })
    )
    const rows = Array.isArray(output.result) ? output.result : []
    const odooRecords = rows.flatMap((value) => {
      if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
        return [{ id: value, model: request.model, label: 'Odoo record' }]
      }
      if (!value || typeof value !== 'object') return []
      const record = value as Record<string, unknown>
      return typeof record.id === 'number' && Number.isInteger(record.id) && record.id > 0
        ? [
            {
              id: record.id,
              model: request.model,
              label: recordLabel(request.model, record)
            }
          ]
        : []
    })
    return { dryRun: false as const, result: output.result, odooRecords }
  }
})
