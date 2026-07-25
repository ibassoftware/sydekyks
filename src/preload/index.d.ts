import { ElectronAPI } from '@electron-toolkit/preload'
import type { SydekyksDesktopApi } from '../shared/ipc'

declare global {
  interface Window {
    electron: ElectronAPI
    api: SydekyksDesktopApi
  }
}
