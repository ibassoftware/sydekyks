/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SYDEKYKS_PREVIEW_SERVICE_URL?: string
  readonly VITE_SYDEKYKS_PREVIEW_SESSION_TOKEN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
