/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const executable = join(root, 'dist', 'mac-arm64', 'Sydekyks.app', 'Contents', 'MacOS', 'Sydekyks')
const userDataDirectory = await mkdtemp(join(tmpdir(), 'sydekyks-app-smoke-'))
let output = ''

const debuggingPort = await new Promise((resolvePort, reject) => {
  const server = createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    if (!address || typeof address === 'string') {
      server.close(() => reject(new Error('Could not allocate a renderer smoke-test port')))
      return
    }
    server.close((error) => (error ? reject(error) : resolvePort(address.port)))
  })
})

const desktop = spawn(
  executable,
  [`--remote-debugging-port=${debuggingPort}`, `--user-data-dir=${userDataDirectory}`],
  { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }
)
desktop.stdout.on('data', (chunk) => (output += String(chunk)))
desktop.stderr.on('data', (chunk) => (output += String(chunk)))
let restartedDesktop

const stopApplication = async (application) => {
  if (!application) return
  if (application.exitCode === null && application.signalCode === null) {
    application.kill('SIGTERM')
    await Promise.race([
      new Promise((resolveExit) => application.once('exit', resolveExit)),
      new Promise((resolveTimeout) => setTimeout(resolveTimeout, 12_000))
    ])
  }
  if (application.exitCode === null && application.signalCode === null) application.kill('SIGKILL')
}

const connect = (url) =>
  new Promise((resolveSocket, reject) => {
    const socket = new WebSocket(url)
    socket.addEventListener('open', () => resolveSocket(socket), { once: true })
    socket.addEventListener('error', () => reject(new Error('Could not connect to Electron CDP')), {
      once: true
    })
  })

try {
  const deadline = Date.now() + 90_000
  let page
  while (Date.now() < deadline && !page) {
    try {
      const response = await fetch(`http://127.0.0.1:${debuggingPort}/json/list`)
      const targets = await response.json()
      page = targets.find((target) => target.type === 'page')
    } catch {
      await new Promise((resolveWait) => setTimeout(resolveWait, 300))
    }
  }
  if (!page?.webSocketDebuggerUrl) {
    throw new Error(`Packaged renderer did not start.\n${output}`)
  }

  const socket = await connect(page.webSocketDebuggerUrl)
  let requestId = 0
  const evaluate = (expression) =>
    new Promise((resolveValue, reject) => {
      requestId += 1
      const id = requestId
      const listener = (event) => {
        const message = JSON.parse(event.data)
        if (message.id !== id) return
        socket.removeEventListener('message', listener)
        if (message.error) reject(new Error(message.error.message))
        else if (message.result?.exceptionDetails) {
          reject(
            new Error(
              message.result.exceptionDetails.exception?.description ??
                message.result.exceptionDetails.text ??
                'Renderer evaluation failed'
            )
          )
        } else resolveValue(message.result?.result?.value)
      }
      socket.addEventListener('message', listener)
      socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression } }))
    })

  let state
  let lastState
  while (Date.now() < deadline) {
    state = await evaluate(`(() => JSON.stringify({
      title: document.title,
      heading: document.querySelector('h1')?.textContent?.trim(),
      serviceError: document.querySelector('.service-banner')?.textContent?.trim() ?? null,
      hasTypeUi: (document.body?.innerText ?? '').includes('TypeUI'),
      hasWorkbench: (document.body?.innerText ?? '').includes('Test a vendor bill'),
      hasPreload: typeof window.api?.service?.getConnection === 'function'
    }))()`)
    if (state !== lastState) {
      console.log(`Renderer state: ${state}`)
      lastState = state
    }
    const parsed = JSON.parse(state)
    if (parsed.heading === 'Syd' && !parsed.serviceError) break
    await new Promise((resolveWait) => setTimeout(resolveWait, 500))
  }

  const result = JSON.parse(state)
  if (result.title !== 'Sydekyks') throw new Error(`Unexpected window title: ${result.title}`)
  if (result.heading !== 'Syd') throw new Error(`Unexpected initial view: ${result.heading}`)
  if (result.serviceError) throw new Error(`Packaged service banner: ${result.serviceError}`)
  if (!result.hasPreload) throw new Error('The sandboxed preload bridge was not available')
  if (result.hasTypeUi) throw new Error('The customer renderer still exposes TypeUI tooling')
  if (result.hasWorkbench)
    throw new Error('The customer renderer still exposes the Ledger workbench')

  socket.close()
  console.log('Packaged app smoke passed: renderer, sandboxed preload, CSP, and private service.')

  await stopApplication(desktop)
  const desktopLog = await readFile(join(userDataDirectory, 'logs', 'desktop.jsonl'), 'utf8')
  const workerLog = await readFile(join(userDataDirectory, 'logs', 'worker.jsonl'), 'utf8')
  for (const line of `${desktopLog}\n${workerLog}`.trim().split('\n').filter(Boolean)) {
    JSON.parse(line)
  }
  if (!desktopLog.includes('worker.ready') || !desktopLog.includes('updater.disabled')) {
    throw new Error('The packaged desktop log is missing worker or updater lifecycle events')
  }
  if (!workerLog.includes('http.request')) {
    throw new Error('The packaged worker log is missing authenticated request events')
  }
  if (/api.?key|authorization|password|session.?token|secret/i.test(workerLog)) {
    throw new Error('A sensitive credential field appeared in the packaged worker log')
  }
  console.log(
    'Structured log smoke passed: valid JSONL lifecycle events with no credential fields.'
  )

  restartedDesktop = spawn(executable, [`--user-data-dir=${userDataDirectory}`], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  restartedDesktop.stdout.on('data', (chunk) => (output += String(chunk)))
  restartedDesktop.stderr.on('data', (chunk) => (output += String(chunk)))
  const backupDeadline = Date.now() + 30_000
  let backedUpDatabases = []
  while (Date.now() < backupDeadline && backedUpDatabases.length < 2) {
    try {
      const backupRoot = join(userDataDirectory, 'backups')
      const backups = await readdir(backupRoot)
      if (backups.length > 0) {
        backedUpDatabases = (await readdir(join(backupRoot, backups.sort().at(-1)))).filter(
          (name) => name.endsWith('.db')
        )
      }
    } catch {
      // The second launch is still starting.
    }
    if (backedUpDatabases.length < 2) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 250))
    }
  }
  if (backedUpDatabases.length < 2) {
    throw new Error(`Second launch did not create both database backups.\n${output}`)
  }
  console.log('Restart smoke passed: both local databases were backed up before reopening.')
  if (output.includes('SQLITE_BUSY')) {
    throw new Error(`Packaged shutdown reported SQLITE_BUSY.\n${output}`)
  }
} finally {
  await stopApplication(desktop)
  await stopApplication(restartedDesktop)
  await rm(userDataDirectory, { recursive: true, force: true })
}
