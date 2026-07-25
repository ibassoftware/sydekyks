/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { app, safeStorage } from 'electron'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorkerHarness } from './lib/worker-harness.mjs'

const expect = (condition, message) => {
  if (!condition) throw new Error(message)
}

const decryptJson = async (path) => JSON.parse(safeStorage.decryptString(await readFile(path)))

await app.whenReady()
console.log('Unlocking the locally encrypted test Gadget credentials…')
const testRoot = await mkdtemp(join(tmpdir(), 'sydekyks-stored-live-'))
const appData = app.getPath('appData')
const profileNames = ['Sydekyks', 'electron-chat']
let credentials

for (const profileName of profileNames) {
  try {
    const directory = join(appData, profileName)
    credentials = {
      ai: await decryptJson(join(directory, 'ai-gadget.enc')),
      odoo: await decryptJson(join(directory, 'odoo-gadget.enc'))
    }
    break
  } catch {
    // Try the next historical/current desktop profile without exposing secrets.
  }
}

if (!safeStorage.isEncryptionAvailable() || !credentials) {
  throw new Error('No decryptable stored AI and Odoo test credentials were found')
}
expect(credentials.odoo.mode === 'live', 'The stored Odoo Gadget is not a live connection')
console.log('Stored credentials unlocked; starting a disposable worker…')

const nodeRuntime = process.env.npm_node_execpath
expect(nodeRuntime, 'npm did not expose the Node.js runtime path to the Electron test')
let worker
let failure
try {
  worker = await new WorkerHarness({
    dataDirectory: join(testRoot, 'runtime'),
    logDirectory: join(testRoot, 'logs'),
    runtime: nodeRuntime
  }).start()
  console.log('Revalidating the stored AI structured-output contracts…')
  const ai = await worker.json('/sydekyks/gadgets/ai/connect', {
    method: 'POST',
    body: credentials.ai,
    timeoutMs: 180_000
  })
  expect(ai.connected, 'The stored AI provider did not reconnect')
  console.log('Connecting the supplied Odoo test server with writes forced off…')
  const odoo = await worker.json('/sydekyks/gadgets/odoo/connect', {
    method: 'POST',
    body: { ...credentials.odoo, liveWrites: false },
    timeoutMs: 180_000
  })
  expect(odoo.connected && odoo.mode === 'live', 'The stored live Odoo test server did not connect')
  expect(!odoo.liveWrites, 'The live Odoo test unexpectedly enabled writes')

  console.log('Running Nudge against the live CRM records…')
  const nudge = await worker.json('/sydekyks/workflows/nudge/stale-opportunities', {
    method: 'POST',
    body: { staleAfterDays: 2, limit: 20, notifyOnlyWhenAttention: true },
    timeoutMs: 180_000
  })
  expect(nudge.status === 'completed', `Live Odoo Nudge ended as ${nudge.status}: ${nudge.summary}`)
  if (nudge.result?.result?.outcome !== 'no-opportunities') {
    expect(
      nudge.result?.result?.assessment?.source === 'llm',
      'Live Odoo Nudge did not return its LLM assessment'
    )
  }
  console.log(
    'Stored live connection pass completed: encrypted credentials unlocked locally, Odoo stayed read-only, and Nudge completed against the test server.'
  )
} catch (error) {
  failure = error
  console.error(error instanceof Error ? error.message : 'The stored live connection test failed')
} finally {
  await worker?.stop().catch(() => undefined)
  await rm(testRoot, { recursive: true, force: true })
  app.exit(failure ? 1 : 0)
}
