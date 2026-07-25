/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { strict as assert } from 'node:assert'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const root = join(import.meta.dirname, '..')
const read = (path) => readFile(join(root, path), 'utf8')

for (const id of ['nudge', 'mirror', 'shield']) {
  const skill = await read(`skills/${id}/SKILL.md`)
  assert.match(skill, new RegExp(`^---\\nname: ${id}\\n`, 'm'))
  assert.match(skill, /description: .{20,}/)
}

const syd = await read('src/mastra/agents/syd-agent.ts')
const gateway = await read('src/mastra/gadgets/odoo-gateway.ts')
const writer = await read('src/mastra/tools/odoo-business-write.ts')
const schemas = await read('src/mastra/domain/schemas.ts')
const store = await read('src/mastra/lib/app-store.ts')

assert.match(syd, /skills:\s*async/)
assert.match(syd, /createSkill\(/)
assert.match(syd, /writeOdooBusinessData:\s*writeOdooBusinessDataTool/)
assert.match(syd, /grantSidekickCapability/)
assert.doesNotMatch(syd, /delegateNudge|delegateMirror|delegateShield/)
assert.match(gateway, /x_rental\.contract/)
assert.doesNotMatch(gateway, /genericWritableModels|writableModels/)
assert.match(writer, /requireApproval:\s*true/)
assert.match(writer, /hasSidekickCapability/)
assert.doesNotMatch(writer, /operation:\s*z\.literal\('delete'\)/)
assert.match(schemas, /kind:\s*z\.literal\('manual'\)/)
assert.match(schemas, /kind:\s*z\.literal\('schedule'\)/)
assert.match(schemas, /kind:\s*z\.literal\('email'\)/)
assert.match(store, /sidekick_versions/)
assert.match(store, /sidekick_capabilities/)
assert.match(store, /automation_specs/)

for (const removed of [
  'src/mastra/sydekyks/nudge/agent.ts',
  'src/mastra/sydekyks/mirror/agent.ts',
  'src/mastra/sydekyks/shield/agent.ts'
]) {
  await assert.rejects(access(join(root, removed)))
}

const runtime = await mkdtemp(join(tmpdir(), 'sydekyks-dynamic-sidekicks-'))
const bundleDirectory = await mkdtemp(join(root, 'scripts/.dynamic-sidekicks-'))
process.env.SYDEKYKS_DATA_DIR = runtime
let appStore
try {
  const bundle = join(bundleDirectory, 'dynamic-sidekicks.cjs')
  await build({
    bundle: true,
    format: 'cjs',
    outfile: bundle,
    platform: 'node',
    stdin: {
      contents: `
        export { appStore } from ${JSON.stringify(join(root, 'src/mastra/lib/app-store.ts'))}
        export { createSidekick, setSidekickCapability } from ${JSON.stringify(join(root, 'src/mastra/sidekicks/service.ts'))}
        export { writeOdooBusinessDataTool } from ${JSON.stringify(join(root, 'src/mastra/tools/odoo-business-write.ts'))}
      `,
      loader: 'ts',
      resolveDir: root,
      sourcefile: 'dynamic-sidekick-test-entry.ts'
    }
  })
  const module = await import(pathToFileURL(bundle).href)
  appStore = module.appStore
  const sidekick = await module.createSidekick({
    name: 'Renewals',
    description: 'Reviews custom rental contracts approaching renewal.',
    instructions:
      '# Renewals\n\nDiscover rental contracts, review renewal dates, and explain which records require action.'
  })
  await module.setSidekickCapability(sidekick.id, {
    model: 'x_rental.contract',
    label: 'Rental Contract',
    operations: ['create', 'update', 'archive']
  })
  assert.equal(module.writeOdooBusinessDataTool.requireApproval, true)
  const created = await module.writeOdooBusinessDataTool.execute({
    operation: 'create',
    sidekickId: sidekick.id,
    model: 'x_rental.contract',
    entityLabel: 'Rental Contract',
    values: {
      name: 'East warehouse lease',
      state: 'draft',
      renewal_date: '2027-01-15',
      active: true
    }
  })
  assert.equal(created.dryRun, false)
  assert.equal(created.ids.length, 1)
  const id = created.ids[0]
  const updated = await module.writeOdooBusinessDataTool.execute({
    operation: 'update',
    sidekickId: sidekick.id,
    model: 'x_rental.contract',
    entityLabel: 'Rental Contract',
    ids: [id],
    values: { state: 'active' }
  })
  assert.equal(updated.dryRun, false)
  const archived = await module.writeOdooBusinessDataTool.execute({
    operation: 'archive',
    sidekickId: sidekick.id,
    model: 'x_rental.contract',
    entityLabel: 'Rental Contract',
    ids: [id]
  })
  assert.equal(archived.dryRun, false)
  assert.ok(
    (await appStore.listMissions()).filter((mission) => mission.kind === 'odoo.generic-write')
      .length >= 3,
    'Approved custom-model writes did not create audit missions'
  )
  await assert.rejects(
    module.writeOdooBusinessDataTool.execute({
      operation: 'create',
      sidekickId: 'nudge',
      model: 'x_rental.contract',
      entityLabel: 'Rental Contract',
      values: { name: 'Unauthorized contract' }
    }),
    /does not have create access/
  )
} finally {
  await appStore?.close()
  await Promise.all([
    rm(runtime, { recursive: true, force: true }),
    rm(bundleDirectory, { recursive: true, force: true })
  ])
}

console.log(
  'Dynamic Sidekick contract passed: Markdown skills, runtime resolution, capability-gated custom-model CRUD, audit receipts, declarative triggers, and legacy-agent removal are verified.'
)
