import { app } from 'electron'
import { join } from 'node:path'
import { createLocalLogger } from '../shared/local-logger'

export const desktopLogDirectory = (): string => join(app.getPath('userData'), 'logs')

export const desktopLogger = createLocalLogger({
  directory: desktopLogDirectory(),
  filename: 'desktop.jsonl',
  scope: 'desktop'
})
