export type OdooCredentialInput =
  | { mode: 'demo' }
  | {
      mode: 'live'
      url: string
      database: string
      username: string
      secret: string
      companyId?: number
      liveWrites: boolean
    }

export interface OdooSavedConfig {
  mode: 'demo' | 'live'
  url?: string
  database?: string
  username?: string
  companyId?: number
  liveWrites: boolean
  hasStoredSecret: boolean
}

export interface OdooPublicStatus {
  mode: 'demo' | 'live'
  connected: boolean
  label: string
  url?: string
  database?: string
  username?: string
  companyId?: number
  liveWrites: boolean
  connectedAt?: string
  serverVersion?: string
}

export interface ImapCredentialInput {
  host: string
  port: number
  secure: boolean
  username: string
  password: string
  mailbox: string
  pollIntervalMinutes: number
  processedMailbox: string
}

export interface ImapSavedConfig {
  host?: string
  port: number
  secure: boolean
  username?: string
  mailbox: string
  pollIntervalMinutes: number
  processedMailbox: string
  hasStoredSecret: boolean
}

export interface ImapPublicStatus {
  configured: boolean
  connected: boolean
  syncing: boolean
  label: string
  host?: string
  port?: number
  secure?: boolean
  username?: string
  mailbox?: string
  pollIntervalMinutes?: number
  processedMailbox?: string
  connectedAt?: string
  lastSyncedAt?: string
  lastError?: string
}

export type AiProvider = 'openai' | 'anthropic' | 'google' | 'ollama-cloud'

export const aiProviderModels = {
  openai: ['gpt-5.4-mini', 'gpt-5.4', 'gpt-5.6-terra'],
  anthropic: ['claude-sonnet-4-6', 'claude-haiku-4-5', 'claude-opus-4-6'],
  google: ['gemini-3.5-flash', 'gemini-2.5-flash', 'gemini-2.5-pro'],
  'ollama-cloud': [
    'minimax-m2.7',
    'minimax-m3',
    'glm-5.2',
    'glm-5.1',
    'gemma4:31b',
    'deepseek-v4-pro',
    'deepseek-v4-flash',
    'qwen3.5:397b',
    'nemotron-3-ultra',
    'nemotron-3-super',
    'nemotron-3-nano:30b',
    'mistral-large-3:675b',
    'minimax-m2.5',
    'kimi-k2.7-code',
    'kimi-k2.6',
    'kimi-k2.5',
    'gpt-oss:120b',
    'gpt-oss:20b'
  ]
} as const satisfies Record<AiProvider, readonly [string, ...string[]]>

export interface AiCredentialInput {
  provider: AiProvider
  model: string
  apiKey: string
}

export interface AiSavedConfig {
  provider?: AiProvider
  model?: string
  hasStoredSecret: boolean
}

export interface AiModelListInput {
  provider: AiProvider
  apiKey?: string
}

export interface AiModelListResult {
  models: string[]
  source: 'provider' | 'fallback'
  message: string
  fetchedAt?: string
}

export interface AiPublicStatus {
  configured: boolean
  connected: boolean
  label: string
  provider?: AiProvider
  model?: string
  connectedAt?: string
  lastError?: string
}

export interface ApprovalNotificationInput {
  missionId: string
  title: string
  body: string
}

export type MissionNotificationInput = ApprovalNotificationInput

export interface ServiceConnection {
  baseUrl: string
  token: string
}

export interface SydekyksDesktopApi {
  service: {
    getConnection: () => Promise<ServiceConnection>
  }
  ai: {
    getSavedConfig: () => Promise<AiSavedConfig>
    listModels: (input: AiModelListInput) => Promise<AiModelListResult>
    saveAndConnect: (credentials: AiCredentialInput) => Promise<AiPublicStatus>
    clear: () => Promise<AiPublicStatus>
  }
  odoo: {
    getSavedConfig: () => Promise<OdooSavedConfig>
    saveAndConnect: (credentials: OdooCredentialInput) => Promise<OdooPublicStatus>
    clearAndUseDemo: () => Promise<OdooPublicStatus>
  }
  imap: {
    getSavedConfig: () => Promise<ImapSavedConfig>
    saveAndConnect: (credentials: ImapCredentialInput) => Promise<ImapPublicStatus>
    clear: () => Promise<ImapPublicStatus>
    syncNow: () => Promise<{ processed: number; duplicates: number; failed: number }>
  }
  notifications: {
    showApproval: (notification: ApprovalNotificationInput) => Promise<boolean>
    onOpenApproval: (callback: (missionId: string) => void) => () => void
    showMission: (notification: MissionNotificationInput) => Promise<boolean>
    onOpenMission: (callback: (missionId: string) => void) => () => void
  }
}
