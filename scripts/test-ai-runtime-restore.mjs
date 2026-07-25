import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const testDirectory = await mkdtemp(join(tmpdir(), 'sydekyks-ai-restore-'))
const bundleDirectory = await mkdtemp(join(import.meta.dirname, '.ai-restore-'))
process.env.SYDEKYKS_DATA_DIR = testDirectory
process.env.SYDEKYKS_LOG_DIR = join(testDirectory, 'logs')

let appStore

try {
  const bundledRuntimePath = join(bundleDirectory, 'ai-runtime-test.cjs')
  const runtimePath = join(import.meta.dirname, '../src/mastra/lib/ai-runtime.ts')
  const storePath = join(import.meta.dirname, '../src/mastra/lib/app-store.ts')
  await build({
    bundle: true,
    format: 'cjs',
    outfile: bundledRuntimePath,
    platform: 'node',
    stdin: {
      contents: `export { aiRuntime, aiRuntimeReady } from ${JSON.stringify(runtimePath)}
export { appStore } from ${JSON.stringify(storePath)}`,
      loader: 'ts',
      resolveDir: import.meta.dirname,
      sourcefile: 'ai-runtime-test-entry.ts'
    }
  })
  const runtime = await import(pathToFileURL(bundledRuntimePath).href)
  appStore = runtime.appStore
  await runtime.aiRuntimeReady

  const priorKey = process.env.OPENAI_API_KEY
  const startedAt = performance.now()
  const status = await runtime.aiRuntime.restore({
    provider: 'openai',
    model: 'restore-test-model',
    apiKey: 'local-restore-test-key'
  })
  const elapsedMs = performance.now() - startedAt

  if (!status.connected || status.model !== 'restore-test-model') {
    throw new Error('Stored AI credentials were not activated')
  }
  if (process.env.OPENAI_API_KEY !== 'local-restore-test-key') {
    throw new Error('The restored credential was not made available to the provider runtime')
  }
  if (elapsedMs > 1_000) {
    throw new Error(
      `Credential restore took ${Math.round(elapsedMs)}ms and may be doing network work`
    )
  }

  await runtime.aiRuntime.disconnect()
  if (process.env.OPENAI_API_KEY !== priorKey) {
    throw new Error('Disconnect did not restore the prior provider environment')
  }

  console.log(
    `AI restore check passed in ${Math.round(elapsedMs)}ms without a provider request; manual Test & save still performs capability validation.`
  )
} finally {
  await appStore?.close()
  await Promise.all([
    rm(testDirectory, { recursive: true, force: true }),
    rm(bundleDirectory, { recursive: true, force: true })
  ])
}
