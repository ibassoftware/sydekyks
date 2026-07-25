import { contextBridge } from 'electron'
import { ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  AiCredentialInput,
  AiModelListInput,
  ApprovalNotificationInput,
  ImapCredentialInput,
  MissionNotificationInput,
  OdooCredentialInput,
  SydekyksDesktopApi
} from '../shared/ipc'

// Custom APIs for renderer
const api: SydekyksDesktopApi = {
  service: {
    getConnection: () => ipcRenderer.invoke('service:get-connection')
  },
  ai: {
    getSavedConfig: () => ipcRenderer.invoke('ai:get-saved-config'),
    listModels: (input: AiModelListInput) => ipcRenderer.invoke('ai:list-models', input),
    saveAndConnect: (credentials: AiCredentialInput) =>
      ipcRenderer.invoke('ai:save-and-connect', credentials),
    clear: () => ipcRenderer.invoke('ai:clear')
  },
  odoo: {
    getSavedConfig: () => ipcRenderer.invoke('odoo:get-saved-config'),
    saveAndConnect: (credentials: OdooCredentialInput) =>
      ipcRenderer.invoke('odoo:save-and-connect', credentials),
    clearAndUseDemo: () => ipcRenderer.invoke('odoo:clear-and-use-demo')
  },
  imap: {
    getSavedConfig: () => ipcRenderer.invoke('imap:get-saved-config'),
    saveAndConnect: (credentials: ImapCredentialInput) =>
      ipcRenderer.invoke('imap:save-and-connect', credentials),
    clear: () => ipcRenderer.invoke('imap:clear'),
    syncNow: () => ipcRenderer.invoke('imap:sync-now')
  },
  notifications: {
    showApproval: (notification: ApprovalNotificationInput) =>
      ipcRenderer.invoke('notifications:show-approval', notification),
    onOpenApproval: (callback: (missionId: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, missionId: string): void =>
        callback(missionId)
      ipcRenderer.on('notifications:open-approval', listener)
      return () => ipcRenderer.removeListener('notifications:open-approval', listener)
    },
    showMission: (notification: MissionNotificationInput) =>
      ipcRenderer.invoke('notifications:show-mission', notification),
    onOpenMission: (callback: (missionId: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, missionId: string): void =>
        callback(missionId)
      ipcRenderer.on('notifications:open-mission', listener)
      return () => ipcRenderer.removeListener('notifications:open-mission', listener)
    }
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
