import { strict as assert } from 'node:assert'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const directory = await mkdtemp(join(tmpdir(), 'sydekyks-shield-brief-'))

try {
  const bundle = join(directory, 'shield-brief.mjs')
  const contractPath = join(import.meta.dirname, '../src/mastra/sydekyks/shield/brief-contract.ts')
  const stagePath = join(import.meta.dirname, '../src/mastra/sydekyks/shield/failure-stage.ts')
  await build({
    bundle: true,
    format: 'esm',
    outfile: bundle,
    platform: 'node',
    stdin: {
      contents: `export { normalizeShieldBrief } from ${JSON.stringify(contractPath)}
export { shieldFailureStage } from ${JSON.stringify(stagePath)}`,
      loader: 'ts',
      resolveDir: import.meta.dirname,
      sourcefile: 'shield-brief-test-entry.ts'
    }
  })
  const { normalizeShieldBrief, shieldFailureStage } = await import(pathToFileURL(bundle).href)
  const evidence = Array.from({ length: 14 }, (_, index) => `bill:15 — evidence ${index + 1}`)
  const normalized = normalizeShieldBrief({
    headline: 'Bills need review',
    overview: 'Review the highest-risk bills first.',
    alerts: [
      {
        billId: 15,
        title: 'Review bill 15',
        brief: 'The evidence warrants payment review.',
        supportingEvidence: [...evidence, evidence[0]],
        auditorQuestions: Array.from({ length: 7 }, (_, index) => `Auditor question ${index + 1}?`)
      }
    ]
  })

  assert.equal(normalized.alerts[0].supportingEvidence.length, 6)
  assert.equal(normalized.alerts[0].auditorQuestions.length, 4)
  assert.deepEqual(normalized.alerts[0].supportingEvidence, evidence.slice(0, 6))
  assert.equal(
    shieldFailureStage(
      new Error(
        'Shield brief failed. alerts.16.supportingEvidence exceeded the allowed size (<=10)'
      )
    ),
    'Brief'
  )
  assert.equal(
    shieldFailureStage(new Error('Shield assess failed. bills.4.rationale was missing')),
    'Assess'
  )

  console.log(
    'Shield brief contract passed: oversized evidence is bounded and failures retain the correct stage.'
  )
} finally {
  await rm(directory, { recursive: true, force: true })
}
