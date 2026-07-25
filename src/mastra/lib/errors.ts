const extractMessage = (value: unknown, depth = 0): string | undefined => {
  if (depth > 4 || value === undefined || value === null) return undefined
  if (value instanceof Error) return extractMessage(value.message, depth + 1)
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    for (const key of ['message', 'error', 'cause', 'details']) {
      const nested = extractMessage(record[key], depth + 1)
      if (nested) return nested
    }
    return undefined
  }
  if (typeof value !== 'string') return String(value)

  const text = value.trim()
  if (!text) return undefined
  const jsonStart = text.indexOf('{')
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(text.slice(jsonStart)) as unknown
      const nested = extractMessage(parsed, depth + 1)
      if (nested) return nested
    } catch {
      // Keep the original non-JSON error below.
    }
  }
  return text
}

export interface MissionErrorDiagnostic {
  code: string
  stage: string
  message: string
  nextStep: string
  model?: string
}

interface MissionErrorDiagnosticOptions {
  fallback: string
  model?: string
  stage: string
}

export const missionErrorDiagnostic = (
  error: unknown,
  options: MissionErrorDiagnosticOptions
): MissionErrorDiagnostic => {
  const message = extractMessage(error) ?? options.fallback
  const lower = message.toLocaleLowerCase()

  if (lower.includes('structured output validation failed')) {
    const issues = message
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /^-\s+[a-z0-9_.[\]-]+:/i.test(line))
      .slice(0, 8)
      .map((line) =>
        line
          .replace(/^-\s+/, '')
          .replace('Invalid input: expected array, received undefined', 'required list was missing')
      )
    return {
      code: 'AI_OUTPUT_VALIDATION_FAILED',
      stage: options.stage,
      message:
        issues.length > 0
          ? `The model response was incomplete: ${issues.join('; ')}.`
          : 'The model response did not include every field required by this mission.',
      nextStep:
        'Retry once. If it happens again, use a model with reliable structured output or reduce the review batch.',
      model: options.model
    }
  }

  if (lower.includes('timeout') || lower.includes('timed out')) {
    return {
      code: 'MISSION_TIMEOUT',
      stage: options.stage,
      message: 'The mission did not finish before its time limit.',
      nextStep:
        'Retry the mission. If it repeats, reduce the review scope or check the AI connection.',
      model: options.model
    }
  }

  if (lower.includes('unauthorized') || lower.includes('invalid api key')) {
    return {
      code: 'AI_CREDENTIALS_REJECTED',
      stage: options.stage,
      message: 'The AI provider rejected the configured credentials.',
      nextStep: 'Check the provider credentials in Gadgets, then retry.',
      model: options.model
    }
  }

  if (lower.includes('ai setup required')) {
    return {
      code: 'AI_SETUP_REQUIRED',
      stage: options.stage,
      message: 'No supported AI provider is currently available for this mission.',
      nextStep: 'Connect an AI provider in Gadgets, then retry.',
      model: options.model
    }
  }

  return {
    code: 'MISSION_FAILED',
    stage: options.stage,
    message: options.fallback,
    nextStep:
      'Retry the mission. If it fails again, use the run ID when reviewing the application logs.',
    model: options.model
  }
}

export const friendlyErrorMessage = (
  error: unknown,
  fallback = 'Sydekyks could not complete this action.'
): string => {
  const message = extractMessage(error) ?? fallback
  const lower = message.toLocaleLowerCase()
  if (
    lower.includes('structured') ||
    lower.includes('could not produce nudge’s required assessment format') ||
    lower.includes('no crm assessment') ||
    lower.includes('did not assess every supplied opportunity')
  ) {
    return 'The AI model returned an incomplete assessment. No result was saved; retry or choose a model with reliable structured output in Gadgets.'
  }
  if (lower.includes('ai setup required')) {
    return 'AI setup is required. Connect a supported provider in Gadgets, then retry.'
  }
  if (lower.includes('unauthorized') || lower.includes('invalid api key')) {
    return 'The AI provider rejected these credentials. Check the API key and model in Gadgets.'
  }
  return message
}
