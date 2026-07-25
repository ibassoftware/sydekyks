import { useCallback, useEffect, useRef, useState } from 'react'
import {
  aiProviderModels,
  type AiCredentialInput,
  type AiModelListResult,
  type AiProvider,
  type AiPublicStatus,
  type AiSavedConfig,
  type SydekyksDesktopApi
} from '../../../shared/ipc'
import { apiRequest } from '../lib/api'
import { Icon } from './Icon'

const providerLabels: Record<AiProvider, { name: string; hint: string }> = {
  openai: { name: 'OpenAI', hint: 'GPT models' },
  anthropic: { name: 'Anthropic', hint: 'Claude models' },
  google: { name: 'Google', hint: 'Gemini models' },
  'ollama-cloud': { name: 'Ollama Cloud', hint: 'Hosted open models' }
}

const desktopApi = (): SydekyksDesktopApi | undefined =>
  (window as typeof window & { api?: SydekyksDesktopApi }).api

const modelsWithCurrent = (models: readonly string[], current?: string): string[] =>
  current && !models.includes(current) ? [current, ...models] : [...models]

const modelListErrorMessage = (cause: unknown): string => {
  if (!(cause instanceof Error)) return 'OpenAI could not refresh its model list'
  return cause.message.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '')
}

export function AiProviderPanel({
  ai,
  onChanged
}: {
  ai: AiPublicStatus
  onChanged: () => Promise<void>
}): React.JSX.Element {
  const [provider, setProvider] = useState<AiProvider>(ai.provider ?? 'openai')
  const [model, setModel] = useState(ai.model ?? aiProviderModels[ai.provider ?? 'openai'][0])
  const [availableModels, setAvailableModels] = useState<string[]>(
    modelsWithCurrent(aiProviderModels[ai.provider ?? 'openai'], ai.model)
  )
  const [apiKey, setApiKey] = useState('')
  const [storedSecret, setStoredSecret] = useState(false)
  const [busy, setBusy] = useState<'connect' | 'clear'>()
  const [loadingModels, setLoadingModels] = useState(false)
  const [modelListStatus, setModelListStatus] = useState<AiModelListResult>()
  const [message, setMessage] = useState<string>()
  const [error, setError] = useState<string>()
  const modelRequestId = useRef(0)

  const refreshModels = useCallback(
    async (nextProvider: AiProvider, key?: string, currentModel?: string): Promise<void> => {
      const requestId = modelRequestId.current + 1
      modelRequestId.current = requestId
      const fallback = modelsWithCurrent(aiProviderModels[nextProvider], currentModel)

      if (nextProvider !== 'openai') {
        setAvailableModels(fallback)
        setModelListStatus(undefined)
        setLoadingModels(false)
        return
      }

      const api = desktopApi()
      if (!api) {
        setAvailableModels(fallback)
        setModelListStatus({
          models: fallback,
          source: 'fallback',
          message: 'The verified OpenAI model list is available in the desktop app.'
        })
        return
      }

      setLoadingModels(true)
      try {
        const result = await api.ai.listModels({
          provider: 'openai',
          apiKey: key?.trim() || undefined
        })
        if (modelRequestId.current !== requestId) return
        const nextModels =
          result.source === 'provider'
            ? result.models
            : modelsWithCurrent(result.models, currentModel)
        setAvailableModels(nextModels)
        setModel((selected) =>
          nextModels.includes(selected) ? selected : (nextModels[0] ?? selected)
        )
        setModelListStatus({ ...result, models: nextModels })
      } catch (cause) {
        if (modelRequestId.current !== requestId) return
        const detail = modelListErrorMessage(cause).replace(/\.$/, '')
        setAvailableModels(fallback)
        setModelListStatus({
          models: fallback,
          source: 'fallback',
          message: `${detail}. Using the verified fallback list.`
        })
      } finally {
        if (modelRequestId.current === requestId) setLoadingModels(false)
      }
    },
    []
  )

  useEffect(() => {
    const api = desktopApi()
    if (!api) return
    void api.ai.getSavedConfig().then((saved: AiSavedConfig) => {
      setStoredSecret(saved.hasStoredSecret)
      if (saved.provider) {
        const savedModel = saved.model ?? aiProviderModels[saved.provider][0]
        setProvider(saved.provider)
        setModel(savedModel)
        setAvailableModels(modelsWithCurrent(aiProviderModels[saved.provider], savedModel))
        void refreshModels(saved.provider, undefined, savedModel)
      } else {
        void refreshModels('openai', undefined, aiProviderModels.openai[0])
      }
    })
  }, [refreshModels])

  const chooseProvider = (next: AiProvider): void => {
    const firstModel = aiProviderModels[next][0]
    setProvider(next)
    setModel(firstModel)
    setAvailableModels([...aiProviderModels[next]])
    setModelListStatus(undefined)
    setMessage(undefined)
    setError(undefined)
    void refreshModels(next, undefined, firstModel)
  }

  const connect = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    setBusy('connect')
    setMessage(undefined)
    setError(undefined)
    try {
      if (!apiKey) {
        throw new Error(
          storedSecret
            ? 'Re-enter the API key to test a provider or model change. The stored key is never revealed.'
            : `Enter your ${providerLabels[provider].name} API key.`
        )
      }
      const credentials: AiCredentialInput = { provider, model, apiKey }
      const api = desktopApi()
      const status = api
        ? await api.ai.saveAndConnect(credentials)
        : await apiRequest<AiPublicStatus>('/sydekyks/gadgets/ai/connect', {
            method: 'POST',
            body: JSON.stringify(credentials)
          })
      setStoredSecret(true)
      setApiKey('')
      setMessage(`Connected ${providerLabels[provider].name} with ${status.model}.`)
      void refreshModels(provider, undefined, status.model)
      await onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not connect the AI provider')
    } finally {
      setBusy(undefined)
    }
  }

  const clear = async (): Promise<void> => {
    setBusy('clear')
    setMessage(undefined)
    setError(undefined)
    try {
      const api = desktopApi()
      if (api) await api.ai.clear()
      else await apiRequest('/sydekyks/gadgets/ai/disconnect', { method: 'POST' })
      setStoredSecret(false)
      setApiKey('')
      setMessage('AI provider disconnected and its encrypted key removed.')
      await onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not disconnect the AI provider')
    } finally {
      setBusy(undefined)
    }
  }

  return (
    <section className="surface connection-panel ai-provider-panel" aria-labelledby="ai-title">
      <div className="surface-heading">
        <div className="gadget-icon ai-gadget-icon">
          <Icon name="sparkles" />
        </div>
        <div>
          <p className="eyebrow">Intelligence Gadget</p>
          <h2 id="ai-title">AI provider</h2>
        </div>
        <span className={`connection-badge ${ai.connected ? 'connected' : ''}`}>
          <span />
          {ai.connected ? 'Intelligence ready' : ai.configured ? 'Locked' : 'Setup required'}
        </span>
      </div>

      <p className="surface-intro">
        Syd and intelligence-enabled Sydekyks use one active provider for conversation, document
        understanding, domain judgment, and failure diagnosis. Intelligence missions stop when this
        Gadget is unavailable.
      </p>

      <form className="gadget-form" onSubmit={(event) => void connect(event)}>
        <fieldset className="provider-picker">
          <legend>Choose a provider</legend>
          {(['openai', 'anthropic', 'google', 'ollama-cloud'] as const).map((item) => (
            <label className={provider === item ? 'selected' : ''} key={item}>
              <input
                checked={provider === item}
                name="ai-provider"
                onChange={() => chooseProvider(item)}
                type="radio"
                value={item}
              />
              <span>
                <strong>{providerLabels[item].name}</strong>
                <small>{providerLabels[item].hint}</small>
              </span>
              <i aria-hidden="true" />
            </label>
          ))}
        </fieldset>

        <div className="form-grid ai-provider-fields">
          <div className="model-field">
            <div className="model-label-row">
              <label htmlFor="ai-provider-model">Model</label>
              {provider === 'openai' && (
                <button
                  className={`model-refresh-button ${loadingModels ? 'is-loading' : ''}`}
                  disabled={loadingModels}
                  onClick={() => void refreshModels(provider, apiKey, model)}
                  type="button"
                >
                  <Icon name="refresh" size={14} />
                  {loadingModels ? 'Loading…' : 'Refresh models'}
                </button>
              )}
            </div>
            <select
              id="ai-provider-model"
              value={model}
              onChange={(event) => setModel(event.target.value)}
            >
              {availableModels.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
            {provider === 'openai' && modelListStatus && (
              <p
                className={`model-list-note ${modelListStatus.source}`}
                role={modelListStatus.source === 'provider' ? 'status' : undefined}
              >
                {modelListStatus.message}
              </p>
            )}
          </div>
          <label>
            <span>{providerLabels[provider].name} API key</span>
            <input
              autoComplete="off"
              onBlur={() => {
                if (provider === 'openai' && apiKey.trim().length >= 10) {
                  void refreshModels(provider, apiKey, model)
                }
              }}
              placeholder={storedSecret ? 'Stored securely · re-enter to change' : 'Paste API key'}
              required={!storedSecret}
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
            />
          </label>
        </div>

        {error && (
          <div className="inline-alert error" role="alert">
            <Icon name="alert" size={18} />
            {error}
          </div>
        )}
        {message && (
          <div className="inline-alert success" role="status">
            <Icon name="check" size={18} />
            {message}
          </div>
        )}

        <div className="gadget-action-row">
          <button className="primary-button" disabled={Boolean(busy)} type="submit">
            <Icon name={busy === 'connect' ? 'refresh' : 'plug'} size={18} />
            {busy === 'connect' ? 'Testing structured output…' : 'Test & save securely'}
          </button>
          {storedSecret && (
            <button
              className="ghost-button danger"
              disabled={Boolean(busy)}
              onClick={() => void clear()}
              type="button"
            >
              Remove provider
            </button>
          )}
        </div>
        <p className="security-caption">
          <Icon name="shield" size={15} /> The API key is encrypted by the operating system. Only
          the local Mastra process receives it, and it is never returned to the renderer or stored
          in libSQL.
        </p>
      </form>
    </section>
  )
}
