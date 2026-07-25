import type { AiCredentials, AiPublicStatus } from '../domain/schemas'
import { appStore } from './app-store'
import {
  deterministicModelSettingsFor,
  resolveModelCapabilities,
  structuredOutputPolicyFor,
  type DeterministicModelSettings,
  type DeterministicModelSettingsInput,
  type ModelCapabilities
} from './model-policy'

const providerEnvironment: Record<AiCredentials['provider'], string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  google: 'GOOGLE_GENERATIVE_AI_API_KEY',
  'ollama-cloud': 'OLLAMA_API_KEY'
}

const emptyStatus = (): AiPublicStatus => ({
  configured: false,
  connected: false,
  label: 'AI provider not configured'
})

class AiRuntime {
  private credentials?: AiCredentials
  private stagedCredentials?: AiCredentials
  private status: AiPublicStatus = emptyStatus()
  private activeEnvironment?: { name: string; priorValue?: string }
  private stagedEnvironment?: { name: string; priorValue?: string }

  async initialize(): Promise<void> {
    const saved = await appStore.getAiStatus()
    if (!saved?.configured) return
    this.status = {
      ...saved,
      connected: false,
      label: saved.provider ? `${saved.provider} · credentials locked` : 'AI credentials locked'
    }
  }

  getStatus(): AiPublicStatus {
    return { ...this.status }
  }

  getModel(): string {
    const credentials = this.stagedCredentials ?? this.credentials
    if (!credentials) {
      throw new Error(
        'AI setup required. Connect OpenAI, Anthropic, Google, or Ollama Cloud in Gadgets.'
      )
    }
    return `${credentials.provider}/${credentials.model}`
  }

  acceptsVisualInput(): boolean | undefined {
    if (!this.stagedCredentials && !this.credentials) return undefined
    return this.getModelCapabilities().attachments
  }

  getModelCapabilities(): ModelCapabilities {
    return resolveModelCapabilities(this.getModel())
  }

  getStructuredOutputPolicy(): { jsonPromptInjection: boolean } {
    return structuredOutputPolicyFor(this.getModel())
  }

  getDeterministicModelSettings(
    input: DeterministicModelSettingsInput
  ): DeterministicModelSettings {
    return deterministicModelSettingsFor(this.getModel(), input)
  }

  stage(credentials: AiCredentials): void {
    this.restoreStagedEnvironment()
    const name = providerEnvironment[credentials.provider]
    this.stagedEnvironment = { name, priorValue: process.env[name] }
    process.env[name] = credentials.apiKey
    this.stagedCredentials = credentials
  }

  async confirm(): Promise<AiPublicStatus> {
    if (!this.stagedCredentials) throw new Error('No AI credentials are staged')
    const credentials = this.stagedCredentials
    this.restoreStagedEnvironment()
    return this.activate(credentials, new Date().toISOString())
  }

  async restore(credentials: AiCredentials): Promise<AiPublicStatus> {
    this.restoreStagedEnvironment()
    return this.activate(credentials, this.status.connectedAt ?? new Date().toISOString())
  }

  private async activate(credentials: AiCredentials, connectedAt: string): Promise<AiPublicStatus> {
    this.clearActiveEnvironment()
    const name = providerEnvironment[credentials.provider]
    this.activeEnvironment = { name, priorValue: process.env[name] }
    process.env[name] = credentials.apiKey
    this.credentials = credentials
    this.status = {
      configured: true,
      connected: true,
      provider: credentials.provider,
      model: credentials.model,
      label: `${credentials.provider} · ${credentials.model}`,
      connectedAt
    }
    await appStore.saveAiStatus(this.status)
    return this.getStatus()
  }

  async reject(error: unknown): Promise<AiPublicStatus> {
    const rejected = this.stagedCredentials
    this.restoreStagedEnvironment()
    if (this.credentials) return this.getStatus()
    const alreadyStored = this.status.configured
    this.status = {
      configured: alreadyStored,
      connected: false,
      provider: this.status.provider ?? rejected?.provider,
      model: this.status.model ?? rejected?.model,
      label: alreadyStored ? 'Stored AI provider could not connect' : 'AI connection failed',
      lastError: error instanceof Error ? error.message : 'AI connection failed'
    }
    await appStore.saveAiStatus(this.status)
    return this.getStatus()
  }

  async disconnect(): Promise<AiPublicStatus> {
    this.restoreStagedEnvironment()
    this.credentials = undefined
    this.clearActiveEnvironment()
    this.status = emptyStatus()
    await appStore.saveAiStatus(this.status)
    return this.getStatus()
  }

  private restoreStagedEnvironment(): void {
    this.stagedCredentials = undefined
    if (!this.stagedEnvironment) return
    const { name, priorValue } = this.stagedEnvironment
    if (priorValue === undefined) delete process.env[name]
    else process.env[name] = priorValue
    this.stagedEnvironment = undefined
  }

  private clearActiveEnvironment(): void {
    if (!this.activeEnvironment) return
    const { name, priorValue } = this.activeEnvironment
    if (priorValue === undefined) delete process.env[name]
    else process.env[name] = priorValue
    this.activeEnvironment = undefined
  }
}

export const aiRuntime = new AiRuntime()
export const aiRuntimeReady = aiRuntime.initialize()
