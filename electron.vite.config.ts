import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    build: {
      // The packaged app needs the updater at runtime. Bundle it and its small
      // dependency graph while keeping Electron itself external.
      externalizeDeps: { exclude: ['electron-updater'] }
    }
  },
  preload: {
    build: {
      // Sandboxed preloads cannot require arbitrary node_modules at runtime.
      // Bundle the tiny preload toolkit into the isolated bridge instead.
      externalizeDeps: false
    }
  },
  renderer: {
    server: {
      host: '127.0.0.1'
    },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()]
  }
})
