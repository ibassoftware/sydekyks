import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      // Default to the documented backend port; override with VITE_API_PROXY when it runs elsewhere
      // (e.g. a local port clash — set VITE_API_PROXY=http://127.0.0.1:9001).
      '/api': process.env.VITE_API_PROXY ?? 'http://127.0.0.1:8000',
    },
  },
})
