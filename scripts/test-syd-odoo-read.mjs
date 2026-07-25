import { strict as assert } from 'node:assert'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { convertZodSchemaToAISDKSchema } from '@mastra/schema-compat'
import { isValidOdooFieldName, isValidOdooModelName } from '../src/shared/odoo-read-policy.ts'

for (const model of [
  'hr.applicant',
  'ir.config_parameter',
  'sale.order',
  'fleet.vehicle',
  'ir.model',
  'ir.module.module',
  'res.users',
  'x_custom_model'
]) {
  assert.ok(isValidOdooModelName(model), `${model} should be discoverable`)
}
for (const model of ['not a model', 'bad/model']) {
  assert.ok(!isValidOdooModelName(model), `${model} should be invalid`)
}
for (const field of ['name', 'stage_id', 'password', 'access_token', 'acc_number', 'vat']) {
  assert.ok(isValidOdooFieldName(field), `${field} should be readable when Odoo permits it`)
}
for (const field of ['not a field', 'partner.name']) {
  assert.ok(!isValidOdooFieldName(field), `${field} should be invalid`)
}

const toolSource = await readFile(
  join(import.meta.dirname, '../src/mastra/tools/odoo-business-read.ts'),
  'utf8'
)
const writeToolSource = await readFile(
  join(import.meta.dirname, '../src/mastra/tools/odoo-business-write.ts'),
  'utf8'
)
const sydSource = await readFile(
  join(import.meta.dirname, '../src/mastra/agents/syd-agent.ts'),
  'utf8'
)

const schemaSource = await readFile(
  join(import.meta.dirname, '../src/mastra/tools/odoo-business-read-schema.ts'),
  'utf8'
)

assert.match(schemaSource, /z\.literal\('discoverModels'\)/)
assert.match(schemaSource, /z\.literal\('discoverFields'\)/)
assert.match(schemaSource, /z\.literal\('searchRead'\)/)
assert.match(schemaSource, /field:\s*odooBusinessFieldSchema/)
assert.doesNotMatch(schemaSource, /z\.tuple|z\.unknown|odooDomainSchema/)
assert.doesNotMatch(toolSource, /hr\.applicant/)
assert.doesNotMatch(toolSource, /z\.literal\('(create|write)'\)/)
assert.doesNotMatch(toolSource, /strict:\s*true/)
assert.match(sydSource, /readOdooBusinessData:\s*readOdooBusinessDataTool/)
assert.match(sydSource, /Discover the business entity/)
assert.match(sydSource, /Inspect its live fields/)
assert.match(sydSource, /writeOdooBusinessData:\s*writeOdooBusinessDataTool/)
assert.match(writeToolSource, /requireApproval:\s*true/)
assert.match(writeToolSource, /hasSidekickCapability/)
assert.doesNotMatch(writeToolSource, /z\.literal\('delete'\)/)
assert.doesNotMatch(sydSource, /hr\.applicant/)

const directory = await mkdtemp(join(tmpdir(), 'sydekyks-odoo-read-links-'))
try {
  const schemaBundle = join(directory, 'odoo-read-schema.mjs')
  await build({
    bundle: true,
    entryPoints: [join(import.meta.dirname, '../src/mastra/tools/odoo-business-read-schema.ts')],
    format: 'esm',
    outfile: schemaBundle,
    platform: 'node'
  })
  const {
    normalizeOdooBusinessReadInput,
    odooBusinessReadInputSchema,
    odooBusinessReadRequestSchema
  } = await import(pathToFileURL(schemaBundle).href)
  const providerSchema = convertZodSchemaToAISDKSchema(odooBusinessReadInputSchema).jsonSchema
  assert.equal(providerSchema.type, 'object', 'Provider tool schema must have an object root')
  const placeholderInput = odooBusinessReadInputSchema.parse({
    operation: 'discoverFields',
    model: 'ir.module.module',
    query: '',
    fields: null,
    filters: null,
    ids: [],
    limit: 20,
    offset: 0
  })
  assert.deepEqual(
    odooBusinessReadRequestSchema.parse(normalizeOdooBusinessReadInput(placeholderInput)),
    {
      operation: 'discoverFields',
      model: 'ir.module.module',
      limit: 20
    },
    'Unused provider placeholders should be normalized before operation validation'
  )
  assert.equal(
    normalizeOdooBusinessReadInput({
      operation: 'searchRead',
      model: 'fleet.vehicle',
      fields: ['name'],
      limit: 120,
      offset: 0
    }).limit,
    50,
    'Business reads should clamp oversized result windows'
  )
  const invalidTupleItems = []
  const schemaStack = [{ value: providerSchema, path: '$' }]
  while (schemaStack.length > 0) {
    const { value, path } = schemaStack.pop()
    if (!value || typeof value !== 'object') continue
    if (Array.isArray(value)) {
      value.forEach((child, index) => schemaStack.push({ value: child, path: `${path}[${index}]` }))
      continue
    }
    if (Array.isArray(value.items)) invalidTupleItems.push(`${path}.items`)
    Object.entries(value).forEach(([key, child]) =>
      schemaStack.push({ value: child, path: `${path}.${key}` })
    )
  }
  assert.deepEqual(
    invalidTupleItems,
    [],
    `Provider schema contains unsupported tuple items at ${invalidTupleItems.join(', ')}`
  )

  const bundle = join(directory, 'odoo-links.mjs')
  await build({
    bundle: true,
    entryPoints: [join(import.meta.dirname, '../src/renderer/src/lib/odoo-links.ts')],
    format: 'esm',
    outfile: bundle,
    platform: 'browser'
  })
  const { odooRecordRefsFromOutput } = await import(pathToFileURL(bundle).href)
  assert.deepEqual(
    odooRecordRefsFromOutput({
      odooRecords: [{ id: 42, model: 'fleet.vehicle', label: 'Delivery Van' }]
    }),
    [{ id: 42, model: 'fleet.vehicle', label: 'Delivery Van' }]
  )
  assert.deepEqual(
    odooRecordRefsFromOutput({
      odooRecords: [{ id: 7, model: 'not a model', label: 'Invalid record' }]
    }),
    []
  )

  console.log(
    'Syd Odoo contract passed: models and fields are dynamically discoverable and writes require exact capabilities plus approval.'
  )
} finally {
  await rm(directory, { recursive: true, force: true })
}
