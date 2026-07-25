import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const directory = await mkdtemp(join(tmpdir(), 'sydekyks-mission-errors-'))

try {
  const bundle = join(directory, 'errors.mjs')
  const errorsPath = join(import.meta.dirname, '../src/mastra/lib/errors.ts')
  const projectionsPath = join(
    import.meta.dirname,
    '../src/mastra/sydekyks/work-report-projections.ts'
  )
  await build({
    bundle: true,
    format: 'esm',
    outfile: bundle,
    platform: 'node',
    stdin: {
      contents: `export { friendlyErrorMessage, missionErrorDiagnostic } from ${JSON.stringify(errorsPath)}
export { shieldReportProjection } from ${JSON.stringify(projectionsPath)}`,
      loader: 'ts',
      resolveDir: import.meta.dirname,
      sourcefile: 'mission-error-test-entry.ts'
    }
  })
  const { friendlyErrorMessage, missionErrorDiagnostic, shieldReportProjection } = await import(
    pathToFileURL(bundle).href
  )
  const error = new Error(
    [
      'Structured output validation failed:',
      '- bills.6.indicators.2.evidenceRecordIds: Invalid input: expected array, received undefined',
      '- bills.6.mitigatingFactors: Invalid input: expected array, received undefined'
    ].join('\n')
  )
  const diagnostic = missionErrorDiagnostic(error, {
    fallback: 'Shield could not complete the risk review.',
    model: 'ollama-cloud/minimax-m3',
    stage: 'Assess'
  })

  if (diagnostic.code !== 'AI_OUTPUT_VALIDATION_FAILED') {
    throw new Error(`Unexpected diagnostic code: ${diagnostic.code}`)
  }
  if (!diagnostic.message.includes('bills.6.mitigatingFactors: required list was missing')) {
    throw new Error(`Missing sanitized validation path: ${diagnostic.message}`)
  }
  if (diagnostic.model !== 'ollama-cloud/minimax-m3' || diagnostic.stage !== 'Assess') {
    throw new Error('Diagnostic did not preserve the safe model and stage labels')
  }
  const friendly = friendlyErrorMessage(error)
  if (friendly.includes('Nudge') || !friendly.includes('incomplete assessment')) {
    throw new Error(`Structured failure was mislabeled: ${friendly}`)
  }
  const safeFallback = missionErrorDiagnostic(new Error('secret-token-123'), {
    fallback: 'The mission failed.',
    stage: 'Workflow'
  })
  if (safeFallback.message.includes('secret-token-123')) {
    throw new Error('Unknown raw error text leaked into the safe diagnostic')
  }

  const briefDiagnostic = {
    code: 'AI_OUTPUT_VALIDATION_FAILED',
    stage: 'Brief',
    message: 'The brief contained too many supporting-evidence items.',
    nextStep: 'Retry the review once.',
    model: 'openai/gpt-5.4-mini'
  }
  const projection = shieldReportProjection({
    text: 'A repeated specialist narrative that should not become the failure summary.',
    toolCalls: [
      {
        payload: {
          toolCallId: 'shield-failure',
          toolName: 'run-shield-fraud-review'
        }
      }
    ],
    toolResults: [
      {
        payload: {
          toolCallId: 'shield-failure',
          result: {
            status: 'failed',
            summary: 'Shield completed the assessment but could not prepare the auditor brief.',
            result: {
              status: 'failed',
              diagnostic: briefDiagnostic
            }
          }
        }
      }
    ]
  })
  if (projection.currentStage !== 'Brief' || projection.diagnostic?.code !== briefDiagnostic.code) {
    throw new Error('Failed Shield projection did not preserve its Brief diagnostic')
  }
  if (projection.facts?.length || projection.uncertainties?.length) {
    throw new Error('Failed Shield projection duplicated its summary across report sections')
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
    throw new Error('Chat does not use the compact failed-report presentation')
  }

  console.log(
    'Mission error details passed: structured failures retain safe diagnostics and use one compact report with hidden technical details.'
  )
} finally {
  await rm(directory, { recursive: true, force: true })
}
