/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const packaged = process.argv.includes('--packaged')
const runtime = packaged
  ? join(root, 'dist', 'mac-arm64', 'Sydekyks.app', 'Contents', 'MacOS', 'Sydekyks')
  : process.execPath
const entry = packaged
  ? join(
      root,
      'dist',
      'mac-arm64',
      'Sydekyks.app',
      'Contents',
      'Resources',
      'app.asar',
      '.mastra',
      'output',
      'index.mjs'
    )
  : join(root, '.mastra', 'output', 'index.mjs')
const dataDirectory = await mkdtemp(join(tmpdir(), 'sydekyks-worker-smoke-'))
const token = randomBytes(32).toString('hex')
let output = ''

const port = await new Promise((resolvePort, reject) => {
  const server = createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    if (!address || typeof address === 'string') {
      server.close(() => reject(new Error('Could not allocate a smoke-test port')))
      return
    }
    server.close((error) => (error ? reject(error) : resolvePort(address.port)))
  })
})

const worker = spawn(runtime, [entry], {
  cwd: root,
  env: {
    ...process.env,
    ...(packaged ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
    NODE_ENV: 'production',
    PORT: String(port),
    SYDEKYKS_DATA_DIR: dataDirectory,
    SYDEKYKS_SESSION_TOKEN: token
  },
  stdio: ['ignore', 'pipe', 'pipe']
})
worker.stdout.on('data', (chunk) => (output += String(chunk)))
worker.stderr.on('data', (chunk) => (output += String(chunk)))

const baseUrl = `http://127.0.0.1:${port}`
const authorizedHeaders = { authorization: `Bearer ${token}` }
const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
)

const requestJson = async (path, init = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { ...authorizedHeaders, ...init.headers }
  })
  const payload = await response.json()
  if (!response.ok) {
    throw new Error(`${path} failed with ${response.status}: ${JSON.stringify(payload)}`)
  }
  return payload
}

const uploadDocument = async (sessionId) => {
  const form = new FormData()
  form.append('file', new Blob([onePixelPng], { type: 'image/png' }), 'session-check.png')
  form.append('sessionId', sessionId)
  return requestJson('/sydekyks/chat/documents', { method: 'POST', body: form })
}

const stop = async () => {
  if (worker.exitCode === null && worker.signalCode === null) {
    worker.kill('SIGTERM')
    await Promise.race([
      new Promise((resolveExit) => worker.once('exit', resolveExit)),
      new Promise((resolveTimeout) => setTimeout(resolveTimeout, 8_000))
    ])
  }
  if (worker.exitCode === null && worker.signalCode === null) worker.kill('SIGKILL')
}

try {
  const deadline = Date.now() + 60_000
  let ready = false
  while (Date.now() < deadline && !ready) {
    try {
      const response = await fetch(`${baseUrl}/health`, { headers: authorizedHeaders })
      ready = response.ok
    } catch {
      await new Promise((resolveWait) => setTimeout(resolveWait, 250))
    }
  }
  if (!ready) throw new Error(`Worker did not become healthy.\n${output}`)

  const unauthorized = await fetch(`${baseUrl}/sydekyks/bootstrap`)
  if (unauthorized.status !== 401) {
    throw new Error(`Expected an unauthenticated request to return 401, got ${unauthorized.status}`)
  }

  const bootstrapResponse = await fetch(`${baseUrl}/sydekyks/bootstrap`, {
    headers: authorizedHeaders
  })
  if (!bootstrapResponse.ok) {
    throw new Error(`Authenticated bootstrap failed with ${bootstrapResponse.status}`)
  }
  const bootstrap = await bootstrapResponse.json()
  for (const collection of ['missions', 'permissions', 'emails', 'automations']) {
    if (!Array.isArray(bootstrap[collection]) || bootstrap[collection].length !== 0) {
      throw new Error(`Fresh worker did not start with an empty ${collection} collection`)
    }
  }

  const firstSession = await requestJson('/sydekyks/chat/sessions', { method: 'POST' })
  const secondSession = await requestJson('/sydekyks/chat/sessions', { method: 'POST' })
  const cleanSession = await requestJson('/sydekyks/chat/sessions', { method: 'POST' })
  const firstUpload = await uploadDocument(firstSession.id)
  if (
    firstUpload.duplicate ||
    !firstUpload.document.chatSessionIds.includes(firstSession.id) ||
    firstUpload.document.chatSessionIds.includes(cleanSession.id)
  ) {
    throw new Error('A new document was not isolated to its originating chat session')
  }
  const duplicateUpload = await uploadDocument(secondSession.id)
  if (
    !duplicateUpload.duplicate ||
    !duplicateUpload.document.chatSessionIds.includes(firstSession.id) ||
    !duplicateUpload.document.chatSessionIds.includes(secondSession.id) ||
    duplicateUpload.document.chatSessionIds.includes(cleanSession.id)
  ) {
    throw new Error('A duplicate document was not linked only to its participating chat sessions')
  }
  const cleanSessionDetail = await requestJson(
    `/sydekyks/chat/sessions/${encodeURIComponent(cleanSession.id)}`
  )
  if (cleanSessionDetail.messages.length !== 0) {
    throw new Error('A newly created chat session inherited messages from another session')
  }

  const clearedSessions = await requestJson('/sydekyks/chat/sessions', { method: 'DELETE' })
  if (clearedSessions.deleted !== 3 || !clearedSessions.session?.id) {
    throw new Error('Clear all did not delete every existing chat session and return a replacement')
  }
  const sessionsAfterClear = await requestJson('/sydekyks/chat/sessions')
  if (
    sessionsAfterClear.sessions.length !== 1 ||
    sessionsAfterClear.sessions[0].id !== clearedSessions.session.id
  ) {
    throw new Error('Clear all did not leave exactly one clean replacement session')
  }
  const replacementDetail = await requestJson(
    `/sydekyks/chat/sessions/${encodeURIComponent(clearedSessions.session.id)}`
  )
  if (replacementDetail.messages.length !== 0) {
    throw new Error('The replacement session created by Clear all was not empty')
  }
  const bootstrapAfterClear = await requestJson('/sydekyks/bootstrap')
  if (bootstrapAfterClear.emails.length !== 1) {
    throw new Error('Clearing chat sessions unexpectedly deleted an uploaded document')
  }

  await stop()
  if (worker.exitCode !== 0) {
    throw new Error(`Worker did not shut down cleanly (exit ${worker.exitCode}).\n${output}`)
  }
  if (output.includes('SQLITE_BUSY')) {
    throw new Error(`Worker shutdown reported SQLITE_BUSY.\n${output}`)
  }
  console.log(
    `${packaged ? 'Packaged w' : 'W'}orker smoke passed on loopback port ${port}: auth, health, session clearing, clean first run, and clean shutdown.`
  )
} finally {
  await stop()
  await rm(dataDirectory, { recursive: true, force: true })
}
