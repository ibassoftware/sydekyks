import { resolve } from 'node:path'
import { createLocalLogger } from '../../shared/local-logger'
import { dataDirectory } from './paths'

const logDirectory = process.env.SYDEKYKS_LOG_DIR?.trim() || resolve(dataDirectory, 'logs')

export const workerLogger = createLocalLogger({
  directory: logDirectory,
  filename: 'worker.jsonl',
  scope: 'worker'
})
