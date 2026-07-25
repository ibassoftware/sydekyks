import { app, shell, BrowserWindow, ipcMain, Notification, safeStorage, session } from 'electron'
import { readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import type {
  AiCredentialInput,
  AiModelListInput,
  AiModelListResult,
  AiPublicStatus,
  AiSavedConfig,
  ApprovalNotificationInput,
  ImapCredentialInput,
  ImapPublicStatus,
  ImapSavedConfig,
  MissionNotificationInput,
  OdooCredentialInput,
  OdooPublicStatus,
  OdooSavedConfig
} from '../shared/ipc'
import { getMastraConnection, startMastraWorker, stopMastraWorker } from './mastra-worker'
import { desktopLogger } from './logger'
import { startAppUpdater } from './app-updater'
import { createAiModelCatalog } from './ai-model-catalog'

const credentialFileName = 'odoo-gadget.enc'
const imapCredentialFileName = 'imap-gadget.enc'
const aiCredentialFileName = 'ai-gadget.enc'
const aiModelCatalog = createAiModelCatalog({
  onProviderUnavailable: (provider, cause) =>
    desktopLogger.warn(`gadget.${provider}-model-list-unreachable`, cause)
})

const credentialPath = (): string => join(app.getPath('userData'), credentialFileName)
const imapCredentialPath = (): string => join(app.getPath('userData'), imapCredentialFileName)
const aiCredentialPath = (): string => join(app.getPath('userData'), aiCredentialFileName)

const postMastra = async <T>(path: string, body?: unknown, timeoutMs = 60_000): Promise<T> => {
  const connection = getMastraConnection()
  const response = await fetch(`${connection.baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${connection.token}`
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs)
  })
  const payload = (await response.json()) as T & { error?: string }
  if (!response.ok)
    throw new Error(payload.error ?? `Sydekyks service responded with ${response.status}`)
  return payload
}

const getMastra = async <T>(path: string): Promise<T> => {
  const connection = getMastraConnection()
  const response = await fetch(`${connection.baseUrl}${path}`, {
    headers: { authorization: `Bearer ${connection.token}` },
    signal: AbortSignal.timeout(5_000)
  })
  if (!response.ok) throw new Error(`Sydekyks service responded with ${response.status}`)
  return (await response.json()) as T
}

const readCredentials = async (): Promise<OdooCredentialInput | undefined> => {
  try {
    const encrypted = await readFile(credentialPath())
    if (!safeStorage.isEncryptionAvailable()) return undefined
    return JSON.parse(safeStorage.decryptString(encrypted)) as OdooCredentialInput
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

const storeCredentials = async (credentials: OdooCredentialInput): Promise<void> => {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure credential storage is not available on this computer')
  }
  const encrypted = safeStorage.encryptString(JSON.stringify(credentials))
  const temporaryPath = `${credentialPath()}.tmp`
  await writeFile(temporaryPath, encrypted, { mode: 0o600 })
  await rename(temporaryPath, credentialPath())
}

const removeCredentials = async (): Promise<void> => {
  try {
    await unlink(credentialPath())
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

const readImapCredentials = async (): Promise<ImapCredentialInput | undefined> => {
  try {
    const encrypted = await readFile(imapCredentialPath())
    if (!safeStorage.isEncryptionAvailable()) return undefined
    return JSON.parse(safeStorage.decryptString(encrypted)) as ImapCredentialInput
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

const storeImapCredentials = async (credentials: ImapCredentialInput): Promise<void> => {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure credential storage is not available on this computer')
  }
  const encrypted = safeStorage.encryptString(JSON.stringify(credentials))
  const temporaryPath = `${imapCredentialPath()}.tmp`
  await writeFile(temporaryPath, encrypted, { mode: 0o600 })
  await rename(temporaryPath, imapCredentialPath())
}

const removeImapCredentials = async (): Promise<void> => {
  try {
    await unlink(imapCredentialPath())
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

const readAiCredentials = async (): Promise<AiCredentialInput | undefined> => {
  try {
    const encrypted = await readFile(aiCredentialPath())
    if (!safeStorage.isEncryptionAvailable()) return undefined
    return JSON.parse(safeStorage.decryptString(encrypted)) as AiCredentialInput
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

const storeAiCredentials = async (credentials: AiCredentialInput): Promise<void> => {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure credential storage is not available on this computer')
  }
  const encrypted = safeStorage.encryptString(JSON.stringify(credentials))
  const temporaryPath = `${aiCredentialPath()}.tmp`
  await writeFile(temporaryPath, encrypted, { mode: 0o600 })
  await rename(temporaryPath, aiCredentialPath())
}

const removeAiCredentials = async (): Promise<void> => {
  try {
    await unlink(aiCredentialPath())
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

const savedConfig = async (): Promise<OdooSavedConfig> => {
  const credentials = await readCredentials()
  if (!credentials || credentials.mode === 'demo') {
    return { mode: 'demo', liveWrites: false, hasStoredSecret: false }
  }
  return {
    mode: 'live',
    url: credentials.url,
    database: credentials.database,
    username: credentials.username,
    companyId: credentials.companyId,
    liveWrites: credentials.liveWrites,
    hasStoredSecret: true
  }
}

const savedImapConfig = async (): Promise<ImapSavedConfig> => {
  const credentials = await readImapCredentials()
  return {
    host: credentials?.host,
    port: credentials?.port ?? 993,
    secure: credentials?.secure ?? true,
    username: credentials?.username,
    mailbox: credentials?.mailbox ?? 'INBOX',
    pollIntervalMinutes: credentials?.pollIntervalMinutes ?? 5,
    processedMailbox: credentials?.processedMailbox ?? 'Sydekyks/Processed',
    hasStoredSecret: Boolean(credentials)
  }
}

const savedAiConfig = async (): Promise<AiSavedConfig> => {
  const credentials = await readAiCredentials()
  return {
    provider: credentials?.provider,
    model: credentials?.model,
    hasStoredSecret: Boolean(credentials)
  }
}

const listAiModels = async (input: AiModelListInput): Promise<AiModelListResult> => {
  if (!input || input.provider !== 'openai') return aiModelCatalog.listModels(input)
  const stored = await readAiCredentials()
  const apiKey =
    (typeof input.apiKey === 'string' ? input.apiKey.trim() : undefined) ||
    (stored?.provider === 'openai' ? stored.apiKey.trim() : undefined)
  return aiModelCatalog.listModels({ ...input, apiKey })
}

const syncStoredOdooCredentials = async (): Promise<void> => {
  const credentials = await readCredentials()
  if (!credentials || credentials.mode === 'demo') return
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await postMastra<OdooPublicStatus>('/sydekyks/gadgets/odoo/connect', credentials)
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 750))
    }
  }
  desktopLogger.warn('gadget.odoo-restore-failed')
}

const syncStoredImapCredentials = async (): Promise<void> => {
  const credentials = await readImapCredentials()
  if (!credentials) return
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await postMastra<ImapPublicStatus>('/sydekyks/gadgets/imap/connect', credentials)
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 750))
    }
  }
  desktopLogger.warn('gadget.imap-restore-failed')
}

const syncStoredAiCredentials = async (maximumAttempts = 20): Promise<void> => {
  const credentials = await readAiCredentials()
  if (!credentials) return
  for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
    try {
      await postMastra<AiPublicStatus>('/sydekyks/gadgets/ai/restore', credentials, 2_000)
      return
    } catch (error) {
      if (error instanceof Error && error.message !== 'fetch failed') break
      await new Promise((resolve) => setTimeout(resolve, 750))
    }
  }
  desktopLogger.warn('gadget.ai-restore-failed')
}

let restoringStoredGadgets = false
let gadgetRestoreTimer: NodeJS.Timeout | undefined

const restoreStoredGadgetsIfNeeded = async (): Promise<void> => {
  if (restoringStoredGadgets) return
  restoringStoredGadgets = true
  try {
    const status = await getMastra<{
      ai: AiPublicStatus
      gadget: OdooPublicStatus
      imap: ImapPublicStatus
    }>('/sydekyks/bootstrap')
    const restores: Array<Promise<void>> = []
    if (status.ai.configured && !status.ai.connected) restores.push(syncStoredAiCredentials())
    if (status.gadget.mode === 'live' && !status.gadget.connected) {
      restores.push(syncStoredOdooCredentials())
    }
    if (status.imap.configured && !status.imap.connected) restores.push(syncStoredImapCredentials())
    await Promise.all(restores)
  } catch {
    // The local worker may be between dev reloads. The next tick retries.
  } finally {
    restoringStoredGadgets = false
  }
}

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 880,
    minHeight: 640,
    show: false,
    title: 'Sydekyks',
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    try {
      const target = new URL(details.url)
      if (
        target.protocol === 'http:' ||
        target.protocol === 'https:' ||
        target.protocol === 'mailto:'
      ) {
        void shell.openExternal(target.toString())
      }
    } catch {
      // Invalid and non-web destinations remain closed.
    }
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault())

  if (is.dev) {
    mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
      if (level < 2) return
      console.error(`[renderer] ${message} (${sourceId || 'unknown source'}:${line})`)
    })
    mainWindow.webContents.on('render-process-gone', (_event, details) => {
      console.error(`[renderer] Process exited: ${details.reason} (${details.exitCode})`)
    })
  }

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.setName('Sydekyks')
const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) app.quit()

app.on('second-instance', () => {
  const window = BrowserWindow.getAllWindows()[0]
  if (!window) return
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
})

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.sydekyks.desktop')
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  try {
    await startMastraWorker()
  } catch (error) {
    desktopLogger.error('worker.start-failed', error)
  }

  ipcMain.handle('service:get-connection', () => getMastraConnection())
  ipcMain.handle('odoo:get-saved-config', savedConfig)
  ipcMain.handle('ai:get-saved-config', savedAiConfig)
  ipcMain.handle('ai:list-models', (_, input: AiModelListInput) => listAiModels(input))
  ipcMain.handle('ai:save-and-connect', async (_, credentials: AiCredentialInput) => {
    const status = await postMastra<AiPublicStatus>('/sydekyks/gadgets/ai/connect', credentials)
    try {
      await storeAiCredentials(credentials)
    } catch (error) {
      await postMastra<AiPublicStatus>('/sydekyks/gadgets/ai/disconnect').catch(() => undefined)
      throw error
    }
    return status
  })
  ipcMain.handle('ai:clear', async () => {
    await removeAiCredentials()
    return postMastra<AiPublicStatus>('/sydekyks/gadgets/ai/disconnect')
  })
  ipcMain.handle('odoo:save-and-connect', async (_, credentials: OdooCredentialInput) => {
    const status = await postMastra<OdooPublicStatus>('/sydekyks/gadgets/odoo/connect', credentials)
    if (credentials.mode === 'demo') await removeCredentials()
    else await storeCredentials(credentials)
    return status
  })
  ipcMain.handle('odoo:clear-and-use-demo', async () => {
    const status = await postMastra<OdooPublicStatus>('/sydekyks/gadgets/odoo/disconnect')
    await removeCredentials()
    return status
  })
  ipcMain.handle('imap:get-saved-config', savedImapConfig)
  ipcMain.handle('imap:save-and-connect', async (_, credentials: ImapCredentialInput) => {
    const status = await postMastra<ImapPublicStatus>('/sydekyks/gadgets/imap/connect', credentials)
    await storeImapCredentials(credentials)
    return status
  })
  ipcMain.handle('imap:clear', async () => {
    const status = await postMastra<ImapPublicStatus>('/sydekyks/gadgets/imap/disconnect')
    await removeImapCredentials()
    return status
  })
  ipcMain.handle('imap:sync-now', async () =>
    postMastra<{ processed: number; duplicates: number; failed: number }>(
      '/sydekyks/gadgets/imap/sync'
    )
  )
  ipcMain.handle(
    'notifications:show-approval',
    (event, input: ApprovalNotificationInput): boolean => {
      if (!Notification.isSupported()) return false
      const notification = new Notification({ title: input.title, body: input.body, silent: false })
      notification.on('click', () => {
        const window = BrowserWindow.fromWebContents(event.sender)
        if (!window) return
        if (window.isMinimized()) window.restore()
        window.show()
        window.focus()
        window.webContents.send('notifications:open-approval', input.missionId)
      })
      notification.show()
      return true
    }
  )
  ipcMain.handle(
    'notifications:show-mission',
    (event, input: MissionNotificationInput): boolean => {
      if (!Notification.isSupported()) return false
      const notification = new Notification({ title: input.title, body: input.body, silent: false })
      notification.on('click', () => {
        const window = BrowserWindow.fromWebContents(event.sender)
        if (!window) return
        if (window.isMinimized()) window.restore()
        window.show()
        window.focus()
        window.webContents.send('notifications:open-mission', input.missionId)
      })
      notification.show()
      return true
    }
  )

  await syncStoredAiCredentials(1)
  createWindow()
  startAppUpdater()
  void Promise.all([syncStoredOdooCredentials(), syncStoredImapCredentials()])
  gadgetRestoreTimer = setInterval(() => void restoreStoredGadgetsIfNeeded(), 5_000)

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

process.on('SIGINT', () => app.quit())
process.on('SIGTERM', () => app.quit())
process.on('uncaughtException', (error) => desktopLogger.error('process.uncaught-exception', error))
process.on('unhandledRejection', (error) =>
  desktopLogger.error('process.unhandled-rejection', error)
)

let finalQuit = false
app.on('before-quit', (event) => {
  if (gadgetRestoreTimer) clearInterval(gadgetRestoreTimer)
  if (finalQuit) return
  event.preventDefault()
  finalQuit = true
  void stopMastraWorker().finally(() => app.quit())
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
