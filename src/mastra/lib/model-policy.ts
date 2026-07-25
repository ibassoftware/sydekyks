import { modelSupportsAttachments, modelSupportsTemperature } from '@mastra/core/llm'

export type StructuredOutputMode = 'native' | 'prompt-injected'

export interface ModelCapabilities {
  attachments?: boolean
  temperature?: boolean
  structuredOutput: StructuredOutputMode
}

export interface DeterministicModelSettingsInput {
  maxOutputTokens: number
  maxRetries: number
}

export interface DeterministicModelSettings extends DeterministicModelSettingsInput {
  temperature?: number
}

type ModelCapabilityOverride = Partial<ModelCapabilities>

// Keep negative claims explicit. A registry can prove that a known model accepts
// attachments, but an absent entry may also mean that a newly released model has
// not reached the bundled catalog yet.
const modelCapabilityOverrides: Readonly<Record<string, ModelCapabilityOverride>> = {
  'ollama-cloud/minimax-m2.7': {
    attachments: false,
    // The live functional matrix verifies that Ollama Cloud accepts temperature
    // for this model even though the general registry does not advertise it.
    temperature: true,
    structuredOutput: 'prompt-injected'
  }
}

export const resolveModelCapabilities = (modelId: string): ModelCapabilities => {
  const override = modelCapabilityOverrides[modelId]
  const registeredAttachmentSupport = modelSupportsAttachments(modelId)
  return {
    attachments: override?.attachments ?? (registeredAttachmentSupport === true ? true : undefined),
    temperature: override?.temperature ?? modelSupportsTemperature(modelId),
    // All installed Sydekyks contracts use the same conservative mode. A future
    // native-mode exception must be added here and covered by the connection matrix.
    structuredOutput: override?.structuredOutput ?? 'prompt-injected'
  }
}

export const structuredOutputPolicyFor = (modelId: string): { jsonPromptInjection: boolean } => ({
  jsonPromptInjection: resolveModelCapabilities(modelId).structuredOutput === 'prompt-injected'
})

export const deterministicModelSettingsFor = (
  modelId: string,
  input: DeterministicModelSettingsInput
): DeterministicModelSettings => ({
  ...(resolveModelCapabilities(modelId).temperature === false ? {} : { temperature: 0 }),
  ...input
})
