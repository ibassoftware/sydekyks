import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const directory = await mkdtemp(join(tmpdir(), 'sydekyks-mission-errors-'))

try {
  const bundle = join(directory, 'errors.mjs')
  const errorsPath = join(import.meta.dirname, '../src/mastra/lib/errors.ts')
  await build({
    bundle: true,
    format: 'esm',
    outfile: bundle,
    platform: 'node',
    stdin: {
      contents: `export { friendlyErrorMessage, missionErrorDiagnostic } from ${JSON.stringify(errorsPath)}`,
      loader: 'ts',
      resolveDir: import.meta.dirname,
      sourcefile: 'mission-error-test-entry.ts'
    }
  })
  const { friendlyErrorMessage, missionErrorDiagnostic } = await import(pathToFileURL(bundle).href)
  const validationError = new Error(
    [
      'Structured output validation failed:',
      '- records.6.fields.2.evidenceIds: Invalid input: expected array, received undefined',
      '- records.6.observations: Invalid input: expected array, received undefined'
    ].join('\n')
  )
  const diagnostic = missionErrorDiagnostic(validationError, {
    fallback: 'The Sidekick could not complete the review.',
    model: 'ollama-cloud/minimax-m3',
    stage: 'Assess'
  })
  if (diagnostic.code !== 'AI_OUTPUT_VALIDATION_FAILED') {
    throw new Error(`Unexpected diagnostic code: ${diagnostic.code}`)
  }
  if (!diagnostic.message.includes('records.6.observations: required list was missing')) {
    throw new Error(`Missing sanitized validation path: ${diagnostic.message}`)
  }
  if (diagnostic.model !== 'ollama-cloud/minimax-m3' || diagnostic.stage !== 'Assess') {
    throw new Error('Diagnostic did not preserve the safe model and stage labels')
  }
  if (!friendlyErrorMessage(validationError).includes('incomplete assessment')) {
    throw new Error('Structured validation did not use the safe friendly error')
  }
  const safeFallback = missionErrorDiagnostic(new Error('secret-token-123'), {
    fallback: 'The mission failed.',
    stage: 'Workflow'
  })
  if (safeFallback.message.includes('secret-token-123')) {
    throw new Error('Unknown raw error text leaked into the safe diagnostic')
  }

  const chatSource = await readFile(
    join(import.meta.dirname, '../src/renderer/src/views/ChatView.tsx'),
    'utf8'
  )
  if (
    !chatSource.includes('FailedSpecialistReport') ||
    !chatSource.includes('Technical details') ||
    !chatSource.includes('reportFailed ?')
  ) {
    throw new Error('Chat does not use the compact failed Ledger report presentation')
  }

  console.log(
    'Mission error details passed: structured failures retain safe diagnostics and raw secrets stay hidden.'
  )
} finally {
  await rm(directory, { recursive: true, force: true })
}
