/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { createServer } from 'node:net'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')

const reservePort = () =>
  new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Could not allocate a worker test port')))
        return
      }
      server.close((error) => (error ? reject(error) : resolvePort(address.port)))
    })
  })

export class WorkerHarness {
  constructor({ dataDirectory, logDirectory, environment = {}, runtime = process.execPath }) {
    this.dataDirectory = dataDirectory
    this.logDirectory = logDirectory
    this.environment = environment
    this.runtime = runtime
    this.process = undefined
    this.output = ''
  }

  async start() {
    if (this.process) throw new Error('The worker harness is already running')
    await Promise.all([
      mkdir(this.dataDirectory, { recursive: true, mode: 0o700 }),
      mkdir(this.logDirectory, { recursive: true, mode: 0o700 })
    ])
    this.port = await reservePort()
    this.token = randomBytes(32).toString('hex')
    this.baseUrl = `http://127.0.0.1:${this.port}`
    this.output = ''
    this.process = spawn(this.runtime, [resolve(root, '.mastra/output/index.mjs')], {
      cwd: root,
      env: {
        ...process.env,
        ...this.environment,
        NODE_ENV: 'production',
        PORT: String(this.port),
        SYDEKYKS_DATA_DIR: this.dataDirectory,
        SYDEKYKS_LOG_DIR: this.logDirectory,
        SYDEKYKS_SESSION_TOKEN: this.token
      },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const capture = (chunk) => {
      this.output = `${this.output}${String(chunk)}`.slice(-100_000)
    }
    this.process.stdout.on('data', capture)
    this.process.stderr.on('data', capture)

    const deadline = Date.now() + 90_000
    while (Date.now() < deadline) {
      if (this.process.exitCode !== null) {
        throw new Error(`Worker exited during startup (${this.process.exitCode}).\n${this.output}`)
      }
      try {
        const response = await fetch(`${this.baseUrl}/health`, {
          headers: this.headers(),
          signal: AbortSignal.timeout(1_500)
        })
        if (response.ok) return this
      } catch {
        // The production bundle is still starting.
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 250))
    }
    throw new Error(`Worker did not become healthy.\n${this.output}`)
  }

  headers(extra = {}) {
    return { authorization: `Bearer ${this.token}`, ...extra }
  }

  async request(path, { method = 'GET', body, headers = {}, timeoutMs = 120_000 } = {}) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: this.headers({
        ...(body === undefined || body instanceof FormData
          ? {}
          : { 'content-type': 'application/json' }),
        ...headers
      }),
      body:
        body === undefined || body instanceof FormData || typeof body === 'string'
          ? body
          : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    })
    return response
  }

  async json(path, options = {}) {
    const response = await this.request(path, options)
    const text = await response.text()
    let payload
    try {
      payload = text ? JSON.parse(text) : undefined
    } catch {
      throw new Error(`${options.method ?? 'GET'} ${path} returned non-JSON (${response.status})`)
    }
    if (!response.ok) {
      throw new Error(
        `${options.method ?? 'GET'} ${path} failed (${response.status}): ${payload?.error ?? 'unknown error'}`
      )
    }
    return payload
  }

  async stop() {
    const worker = this.process
    if (!worker) return
    if (worker.exitCode === null && worker.signalCode === null) {
      worker.kill('SIGTERM')
      await Promise.race([
        new Promise((resolveExit) => worker.once('exit', resolveExit)),
        new Promise((resolveTimeout) => setTimeout(resolveTimeout, 10_000))
      ])
    }
    if (worker.exitCode === null && worker.signalCode === null) worker.kill('SIGKILL')
    this.process = undefined
    if (this.output.includes('SQLITE_BUSY')) {
      throw new Error(`Worker shutdown reported SQLITE_BUSY.\n${this.output}`)
    }
  }
}
