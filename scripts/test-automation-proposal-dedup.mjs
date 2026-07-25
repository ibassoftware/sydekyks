import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const testDirectory = await mkdtemp(join(tmpdir(), 'sydekyks-automation-dedup-'))
const bundleDirectory = await mkdtemp(join(import.meta.dirname, '.automation-dedup-'))
process.env.SYDEKYKS_DATA_DIR = testDirectory
process.env.SYDEKYKS_LOG_DIR = join(testDirectory, 'logs')

let appStore

try {
  const bundledProposalPath = join(bundleDirectory, 'automation-proposal-test.cjs')
  const proposalPath = join(import.meta.dirname, '../src/mastra/automations/proposal.ts')
  const storePath = join(import.meta.dirname, '../src/mastra/lib/app-store.ts')
  const workReportPath = join(import.meta.dirname, '../src/mastra/sydekyks/work-report.ts')
  const projectionsPath = join(
    import.meta.dirname,
    '../src/mastra/sydekyks/work-report-projections.ts'
  )
  await build({
    bundle: true,
    format: 'cjs',
    outfile: bundledProposalPath,
    platform: 'node',
    stdin: {
      contents: `export { createDraftAutomationFromCadence } from ${JSON.stringify(proposalPath)}
export { appStore } from ${JSON.stringify(storePath)}
export { buildAgentWorkReport } from ${JSON.stringify(workReportPath)}
export { mirrorReportProjection } from ${JSON.stringify(projectionsPath)}`,
      loader: 'ts',
      resolveDir: import.meta.dirname,
      sourcefile: 'automation-proposal-test-entry.ts'
    }
  })
  const runtime = await import(pathToFileURL(bundledProposalPath).href)
  appStore = runtime.appStore

  const request = {
    recurring: {
      name: 'Duplicate Vendor Bill Watch',
      cadence: 'interval-days',
      everyDays: 3,
      time: '09:00',
      timezone: 'Europe/Paris'
    },
    ownerSydekykId: 'mirror',
    workflowId: 'mirror-duplicate-bills',
    inputData: { lookbackDays: 365, limit: 50, notifyOnlyWhenAttention: true }
  }

  const created = await runtime.createDraftAutomationFromCadence(request)
  if (created.outcome !== 'created') throw new Error('The first proposal was not created')
  const persisted = await appStore.getAutomation(created.automationId)
  if (!persisted || persisted.schedule.kind !== 'interval') {
    throw new Error('The interval automation was not persisted')
  }
  await appStore.updateAutomation(persisted.id, {
    schedule: {
      ...persisted.schedule,
      anchorAt: new Date(new Date(persisted.schedule.anchorAt).getTime() + 86_400_000).toISOString()
    }
  })

  const existing = await runtime.createDraftAutomationFromCadence({
    ...request,
    recurring: { ...request.recurring, name: 'Same job with another name' }
  })
  if (existing.outcome !== 'existing' || existing.automationId !== created.automationId) {
    throw new Error('An equivalent proposal did not resolve to the existing automation')
  }
  if ((await appStore.listAutomations()).length !== 1) {
    throw new Error('The equivalent proposal created a duplicate draft')
  }
  const toolCallId = 'automation-dedup-check'
  const run = {
    text: 'An equivalent automation already exists. Should I keep it or create another?',
    toolCalls: [{ payload: { toolCallId, toolName: 'propose-mirror-automation' } }],
    toolResults: [{ payload: { toolCallId, result: existing } }]
  }
  const report = runtime.buildAgentWorkReport(
    'Mirror',
    run,
    {
      'propose-mirror-automation': {
        label: 'Checked the Mirror automation schedule',
        detail: 'Compared the request with current automations.'
      }
    },
    runtime.mirrorReportProjection(run)
  )
  if (
    report.currentStage.status !== 'needs-attention' ||
    !report.facts.includes('No new draft was created.')
  ) {
    throw new Error('The duplicate handoff report did not ask for attention')
  }

  const differentSettings = await runtime.createDraftAutomationFromCadence({
    ...request,
    inputData: { ...request.inputData, lookbackDays: 90 }
  })
  if (differentSettings.outcome !== 'created') {
    throw new Error('A materially different watch was incorrectly blocked')
  }

  const explicitlyDuplicated = await runtime.createDraftAutomationFromCadence({
    ...request,
    recurring: { ...request.recurring, allowDuplicate: true }
  })
  if (explicitlyDuplicated.outcome !== 'created') {
    throw new Error('Explicit duplicate confirmation did not create the requested second draft')
  }
  if ((await appStore.listAutomations()).length !== 3) {
    throw new Error('The explicitly confirmed duplicate was not persisted')
  }

  console.log(
    'Automation proposal checks passed: equivalent jobs pause without creating a draft, and an overlap requires explicit confirmation.'
  )
} finally {
  await appStore?.close()
  await Promise.all([
    rm(testDirectory, { recursive: true, force: true }),
    rm(bundleDirectory, { recursive: true, force: true })
  ])
}
