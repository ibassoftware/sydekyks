import { appendFile, mkdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LocalLogger {
  debug: (event: string, details?: unknown) => void
  info: (event: string, details?: unknown) => void
  warn: (event: string, details?: unknown) => void
  error: (event: string, details?: unknown) => void
  flush: () => Promise<void>
}

interface LoggerOptions {
  directory: string
  filename: string
  scope: string
  maximumBytes?: number
  retainedFiles?: number
}

const sensitiveKey =
  /authorization|cookie|credential|api.?key|access.?key|password|secret|session.?token|token/i

const safeError = (error: Error): Record<string, unknown> => ({
  name: error.name,
  message: error.message,
  ...(error.cause === undefined ? {} : { cause: sanitize(error.cause) })
})

const sanitize = (value: unknown, key = '', seen = new WeakSet<object>()): unknown => {
  if (sensitiveKey.test(key)) return '[redacted]'
  if (value instanceof Error) return safeError(value)
  if (typeof value === 'string') {
    if (/^Bearer\s+/i.test(value)) return '[redacted]'
    return value.length > 4_000 ? `${value.slice(0, 4_000)}…` : value
  }
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) return '[circular]'
  seen.add(value)
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitize(item, '', seen))
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
      entryKey,
      sanitize(entryValue, entryKey, seen)
    ])
  )
}

const ignoreMissing = (error: unknown): void => {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
}

export const createLocalLogger = ({
  directory,
  filename,
  scope,
  maximumBytes = 2 * 1024 * 1024,
  retainedFiles = 5
}: LoggerOptions): LocalLogger => {
  const filePath = join(directory, filename)
  let queue = Promise.resolve()

  const rotateIfNeeded = async (incomingBytes: number): Promise<void> => {
    const currentBytes = await stat(filePath)
      .then((metadata) => metadata.size)
      .catch((error) => {
        ignoreMissing(error)
        return 0
      })
    if (currentBytes + incomingBytes <= maximumBytes) return

    await rm(`${filePath}.${retainedFiles}`, { force: true })
    for (let index = retainedFiles - 1; index >= 1; index -= 1) {
      await rename(`${filePath}.${index}`, `${filePath}.${index + 1}`).catch(ignoreMissing)
    }
    await rename(filePath, `${filePath}.1`).catch(ignoreMissing)
  }

  const write = (level: LogLevel, event: string, details?: unknown): void => {
    const record = {
      timestamp: new Date().toISOString(),
      level,
      scope,
      event,
      ...(details === undefined ? {} : { details: sanitize(details) })
    }
    const line = `${JSON.stringify(record)}\n`
    queue = queue
      .then(async () => {
        await mkdir(directory, { recursive: true, mode: 0o700 })
        await rotateIfNeeded(Buffer.byteLength(line))
        await appendFile(filePath, line, { encoding: 'utf8', mode: 0o600 })
      })
      .catch(() => undefined)
  }

  return {
    debug: (event, details) => write('debug', event, details),
    info: (event, details) => write('info', event, details),
    warn: (event, details) => write('warn', event, details),
    error: (event, details) => write('error', event, details),
    flush: () => queue
  }
}
