import { app } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { copyFile, mkdir, readdir, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join } from 'node:path'
import type { ServiceConnection } from '../shared/ipc'
import { desktopLogDirectory, desktopLogger } from './logger'

let worker: ChildProcess | undefined
let connection: ServiceConnection | undefined
let stopping = false
let restartTimer: NodeJS.Timeout | undefined
let recentOutput = ''

const backupRuntimeDatabases = async (dataDirectory: string): Promise<void> => {
  const entries = await readdir(dataDirectory, { withFileTypes: true })
  const databaseFiles = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        (entry.name.endsWith('.db') ||
          entry.name.endsWith('.db-wal') ||
          entry.name.endsWith('.db-shm'))
    )
    .map((entry) => entry.name)
  if (!databaseFiles.some((name) => name.endsWith('.db'))) return

  const backupRoot = join(app.getPath('userData'), 'backups')
  const backupName = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
  const backupDirectory = join(backupRoot, backupName)
  await mkdir(backupDirectory, { recursive: true, mode: 0o700 })
  await Promise.all(
    databaseFiles.map((name) => copyFile(join(dataDirectory, name), join(backupDirectory, name)))
  )

  const backups = (await readdir(backupRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse()
  await Promise.all(
    backups.slice(5).map((name) => rm(join(backupRoot, name), { recursive: true, force: true }))
  )
}

const reserveLoopbackPort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Could not reserve a local service port')))
        return
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)))
    })
  })

const rememberOutput = (chunk: unknown): void => {
  const output = String(chunk)
  recentOutput = `${recentOutput}${output}`.slice(-8_000)
  if (!app.isPackaged) process.stdout.write(output)
}

const launchWorker = (): void => {
  if (!connection) throw new Error('The local service connection has not been initialized')

  const applicationRoot = app.getAppPath()
  const workerArguments = app.isPackaged
    ? [join(applicationRoot, '.mastra', 'output', 'index.mjs')]
    : [join(applicationRoot, 'node_modules', 'mastra', 'dist', 'index.js'), 'dev']

  worker = spawn(process.execPath, workerArguments, {
    cwd: app.isPackaged ? process.resourcesPath : applicationRoot,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      NODE_ENV: app.isPackaged ? 'production' : 'development',
      MASTRA_HOST: '127.0.0.1',
      PORT: new URL(connection.baseUrl).port,
      SYDEKYKS_DATA_DIR: join(app.getPath('userData'), 'runtime'),
      SYDEKYKS_LOG_DIR: desktopLogDirectory(),
      SYDEKYKS_SESSION_TOKEN: connection.token
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  worker.stdout?.on('data', rememberOutput)
  worker.stderr?.on('data', rememberOutput)
  worker.once('error', (error) => {
    desktopLogger.error('worker.spawn-error', error)
    rememberOutput(`Local service error: ${error.message}\n`)
  })
  worker.once('exit', (code, signal) => {
    worker = undefined
    if (stopping) {
      desktopLogger.info('worker.stopped', { code, signal })
      return
    }
    desktopLogger.warn('worker.unexpected-exit', { code, signal })
    rememberOutput(
      `Local service stopped unexpectedly (${code ?? signal ?? 'unknown'}). Restarting.\n`
    )
    restartTimer = setTimeout(() => {
      restartTimer = undefined
      if (!stopping) launchWorker()
    }, 1_000)
  })
}

const waitUntilReady = async (timeoutMs = 90_000): Promise<void> => {
  if (!connection) throw new Error('The local service connection has not been initialized')
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${connection.baseUrl}/health`, {
        headers: { authorization: `Bearer ${connection.token}` },
        signal: AbortSignal.timeout(1_500)
      })
      if (response.ok) return
    } catch {
      // The worker is still building or restarting.
    }
    await new Promise((resolve) => setTimeout(resolve, 350))
  }
  throw new Error(
    `Sydekyks could not start its private local service.${recentOutput ? `\n${recentOutput}` : ''}`
  )
}

export const startMastraWorker = async (): Promise<ServiceConnection> => {
  if (connection) return connection
  stopping = false
  recentOutput = ''
  const dataDirectory = join(app.getPath('userData'), 'runtime')
  await mkdir(dataDirectory, { recursive: true, mode: 0o700 })
  await backupRuntimeDatabases(dataDirectory)
  desktopLogger.info('runtime.backup-completed')
  const port = await reserveLoopbackPort()
  connection = {
    baseUrl: `http://127.0.0.1:${port}`,
    token: randomBytes(32).toString('hex')
  }
  desktopLogger.info('worker.starting', { port })
  launchWorker()
  await waitUntilReady()
  desktopLogger.info('worker.ready', { port })
  return connection
}

export const getMastraConnection = (): ServiceConnection => {
  if (!connection) throw new Error('The private local service is not ready')
  return connection
}

export const stopMastraWorker = async (): Promise<void> => {
  stopping = true
  desktopLogger.info('worker.stop-requested')
  if (restartTimer) clearTimeout(restartTimer)
  restartTimer = undefined
  const activeWorker = worker
  if (!activeWorker) return

  await new Promise<void>((resolve) => {
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      resolve()
    }
    activeWorker.once('exit', finish)
    activeWorker.kill('SIGTERM')
    setTimeout(() => {
      if (activeWorker.exitCode === null && activeWorker.signalCode === null) {
        activeWorker.kill('SIGKILL')
      }
      finish()
    }, 8_000).unref()
  })
  worker = undefined
  await desktopLogger.flush()
}
