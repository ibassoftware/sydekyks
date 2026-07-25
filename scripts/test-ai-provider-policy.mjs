import { strict as assert } from 'node:assert'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const root = resolve(import.meta.dirname, '..')
const bundleDirectory = await mkdtemp(join(import.meta.dirname, '.ai-provider-policy-'))

try {
  const bundlePath = join(bundleDirectory, 'policy.mjs')
  await build({
    bundle: true,
    format: 'esm',
    outfile: bundlePath,
    packages: 'external',
    platform: 'node',
    stdin: {
      contents: [
        `export * from ${JSON.stringify(join(root, 'src/mastra/lib/model-policy.ts'))}`,
        `export * from ${JSON.stringify(join(root, 'src/main/ai-model-catalog.ts'))}`
      ].join('\n'),
      loader: 'ts',
      resolveDir: root,
      sourcefile: 'ai-provider-policy-test-entry.ts'
    }
  })

  const policy = await import(pathToFileURL(bundlePath).href)
  const supportedModels = [
    'openai/gpt-5.4',
    'anthropic/claude-sonnet-4-6',
    'google/gemini-3.5-flash',
    'ollama-cloud/minimax-m2.7'
  ]
  for (const model of supportedModels) {
    assert.deepEqual(
      policy.structuredOutputPolicyFor(model),
      { jsonPromptInjection: true },
      `${model} should use the shared structured-output policy`
    )
  }

  assert.equal(
    policy.resolveModelCapabilities('ollama-cloud/minimax-m2.7').attachments,
    false,
    'The verified text-only model must reject attachment-only analysis'
  )
  assert.equal(
    policy.resolveModelCapabilities('openai/gpt-5.4').attachments,
    true,
    'Mastra attachment capability data should be reused when affirmative'
  )
  assert.equal(
    policy.resolveModelCapabilities('openai/new-model-not-yet-catalogued').attachments,
    undefined,
    'An absent registry entry must not become an unverified negative capability claim'
  )
  assert.deepEqual(
    policy.deterministicModelSettingsFor('openai/gpt-5.4', {
      maxOutputTokens: 500,
      maxRetries: 1
    }),
    { maxOutputTokens: 500, maxRetries: 1 },
    'Unsupported temperature settings should be omitted'
  )
  assert.deepEqual(
    policy.deterministicModelSettingsFor('anthropic/claude-sonnet-4-6', {
      maxOutputTokens: 500,
      maxRetries: 1
    }),
    { temperature: 0, maxOutputTokens: 500, maxRetries: 1 },
    'Supported deterministic temperature should be applied consistently'
  )
  assert.deepEqual(
    policy.deterministicModelSettingsFor('ollama-cloud/minimax-m2.7', {
      maxOutputTokens: 500,
      maxRetries: 1
    }),
    { temperature: 0, maxOutputTokens: 500, maxRetries: 1 },
    'A live-verified provider capability should override incomplete registry metadata'
  )

  let fetchCount = 0
  let authorization = ''
  const catalog = policy.createAiModelCatalog({
    now: () => '2026-07-25T12:00:00.000Z',
    fetchImpl: async (_url, init) => {
      fetchCount += 1
      authorization = init?.headers?.authorization ?? ''
      return new Response(
        JSON.stringify({
          data: [
            { id: 'gpt-image-1' },
            { id: 'gpt-5.4-2026-07-01' },
            { id: 'gpt-5.4' },
            { id: 'gpt-5.4' }
          ]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    }
  })

  const anthropic = await catalog.listModels({ provider: 'anthropic' })
  assert.equal(anthropic.source, 'fallback')
  assert.equal(fetchCount, 0, 'Curated provider catalogs should not make a provider request')

  const openAiFallback = await catalog.listModels({ provider: 'openai' })
  assert.equal(openAiFallback.source, 'fallback')
  assert.equal(fetchCount, 0, 'OpenAI discovery without a key should use the reviewed fallback')

  const discovered = await catalog.listModels({ provider: 'openai', apiKey: 'test-key' })
  assert.deepEqual(discovered.models, ['gpt-5.4', 'gpt-5.4-2026-07-01'])
  assert.equal(discovered.source, 'provider')
  assert.equal(discovered.fetchedAt, '2026-07-25T12:00:00.000Z')
  assert.equal(authorization, 'Bearer test-key')
  assert.equal(fetchCount, 1)

  let unavailableProvider
  const unavailableCatalog = policy.createAiModelCatalog({
    fetchImpl: async () => {
      throw new Error('offline')
    },
    onProviderUnavailable: (provider) => {
      unavailableProvider = provider
    }
  })
  await assert.rejects(
    unavailableCatalog.listModels({ provider: 'openai', apiKey: 'test-key' }),
    /Could not reach OpenAI/
  )
  assert.equal(unavailableProvider, 'openai')

  const sourceFiles = (await readdir(join(root, 'src/mastra'), { recursive: true }))
    .filter((name) => name.endsWith('.ts'))
    .filter((name) => !name.endsWith('lib/model-policy.ts'))
  for (const name of sourceFiles) {
    const source = await readFile(join(root, 'src/mastra', name), 'utf8')
    if (!name.endsWith('lib/ai-runtime.ts')) {
      assert.equal(
        /jsonPromptInjection\s*:/.test(source),
        false,
        `${name} bypasses the centralized structured-output policy`
      )
    }
    assert.equal(
      /modelSettings\s*:\s*\{\s*temperature\s*:\s*0/.test(source),
      false,
      `${name} bypasses the centralized deterministic model settings`
    )
  }

  console.log(
    'AI provider policy checks passed: shared structured output, capability-aware settings, catalog adapters, and no bypasses.'
  )
} finally {
  await rm(bundleDirectory, { recursive: true, force: true })
}
