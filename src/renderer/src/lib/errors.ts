const extractMessage = (value: unknown): string | undefined => {
  const raw = value instanceof Error ? value.message : typeof value === 'string' ? value : undefined
  if (!raw?.trim()) return undefined
  const text = raw.trim()
  const jsonStart = text.indexOf('{')
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(text.slice(jsonStart)) as Record<string, unknown>
      const nested = parsed.message ?? parsed.error ?? parsed.cause
      if (typeof nested === 'string') return nested
    } catch {
      // This is an ordinary error containing a brace, not serialized JSON.
    }
  }
  return text
}

export const friendlyError = (
  value: unknown,
  fallback = 'Sydekyks could not complete this action.'
): string => {
  const message = extractMessage(value) ?? fallback
  const lower = message.toLocaleLowerCase()
  if (lower.includes('structured')) {
    return 'The AI model returned an incomplete assessment. No result was saved; retry or choose a model with reliable structured output in Gadgets.'
  }
  if (lower.includes('ai setup required')) {
    return 'AI setup is required. Connect a provider in Gadgets, then retry.'
  }
  return message
}
