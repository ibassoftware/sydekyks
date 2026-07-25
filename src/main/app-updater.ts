import { app } from 'electron'
import electronUpdater from 'electron-updater'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { desktopLogger } from './logger'

const { autoUpdater } = electronUpdater
const updateIntervalMs = 6 * 60 * 60 * 1_000

const updaterLogger = {
  debug: (message: unknown): void => desktopLogger.debug('updater.debug', { message }),
  info: (message: unknown): void => desktopLogger.info('updater.info', { message }),
  warn: (message: unknown): void => desktopLogger.warn('updater.warn', { message }),
  error: (message: unknown): void => desktopLogger.error('updater.error', { message })
}

export const startAppUpdater = (): void => {
  if (!app.isPackaged || !existsSync(join(process.resourcesPath, 'app-update.yml'))) {
    desktopLogger.info('updater.disabled', { reason: 'No packaged update feed is configured' })
    return
  }

  autoUpdater.logger = updaterLogger
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('checking-for-update', () => desktopLogger.info('updater.checking'))
  autoUpdater.on('update-available', (info) =>
    desktopLogger.info('updater.available', { version: info.version })
  )
  autoUpdater.on('update-not-available', (info) =>
    desktopLogger.info('updater.current', { version: info.version })
  )
  autoUpdater.on('update-downloaded', (info) =>
    desktopLogger.info('updater.downloaded', { version: info.version })
  )
  autoUpdater.on('error', (error) => desktopLogger.error('updater.failed', error))

  const check = (): void => {
    void autoUpdater
      .checkForUpdatesAndNotify({
        title: 'Sydekyks update ready',
        body: 'Version {version} will be installed when Sydekyks closes.'
      })
      .catch((error) => desktopLogger.error('updater.check-failed', error))
  }
  const firstCheck = setTimeout(check, 30_000)
  firstCheck.unref()
  const interval = setInterval(check, updateIntervalMs)
  interval.unref()
}
