import type { AiModelListInput, AiModelListResult, AiProvider } from '../shared/ipc'
import { aiProviderModels } from '../shared/ipc'
import { sortOpenAiLlmModelIds } from '../shared/openai-models'

export interface AiModelCatalog {
  listModels(input: AiModelListInput): Promise<AiModelListResult>
}

export interface AiModelCatalogDependencies {
  fetchImpl?: typeof fetch
  now?: () => string
  onProviderUnavailable?: (provider: AiProvider, cause: unknown) => void
}

type ProviderCatalogAdapter = (apiKey?: string) => Promise<AiModelListResult>

const curatedResult = (provider: AiProvider, message?: string): AiModelListResult => ({
  models: [...aiProviderModels[provider]],
  source: 'fallback',
  message: message ?? `${provider} uses the verified Sydekyks model list.`
})

export const createAiModelCatalog = ({
  fetchImpl = fetch,
  now = () => new Date().toISOString(),
  onProviderUnavailable
}: AiModelCatalogDependencies = {}): AiModelCatalog => {
  const openAiAdapter: ProviderCatalogAdapter = async (apiKey) => {
    if (!apiKey) {
      return curatedResult(
        'openai',
        'Enter an OpenAI API key to load every text-generation model available to it.'
      )
    }

    let response: Response
    try {
      response = await fetchImpl('https://api.openai.com/v1/models', {
        headers: { authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(15_000)
      })
    } catch (cause) {
      onProviderUnavailable?.('openai', cause)
      throw new Error(
        'Could not reach OpenAI. Check the internet connection, VPN, DNS, or firewall, then refresh the models'
      )
    }

    const payload = (await response.json()) as {
      data?: Array<{ id?: unknown }>
      error?: { message?: string }
    }
    if (!response.ok) {
      throw new Error(payload.error?.message ?? `OpenAI responded with ${response.status}`)
    }

    const models = sortOpenAiLlmModelIds(
      (payload.data ?? []).flatMap((item) => (typeof item.id === 'string' ? [item.id] : [])),
      aiProviderModels.openai
    )
    if (models.length === 0) {
      throw new Error('OpenAI returned no text-generation model IDs for this API key')
    }

    return {
      models,
      source: 'provider',
      message: `${models.length} OpenAI text-generation model${models.length === 1 ? '' : 's'} available to this key.`,
      fetchedAt: now()
    }
  }

  const adapters: Record<AiProvider, ProviderCatalogAdapter> = {
    openai: openAiAdapter,
    anthropic: async () => curatedResult('anthropic'),
    google: async () => curatedResult('google'),
    'ollama-cloud': async () => curatedResult('ollama-cloud')
  }

  return {
    async listModels(input): Promise<AiModelListResult> {
      if (!input || !Object.prototype.hasOwnProperty.call(adapters, input.provider)) {
        throw new Error('Choose a supported AI provider')
      }
      return adapters[input.provider](input.apiKey?.trim() || undefined)
    }
  }
}
