const excludedOpenAiModelMarkers = [
  'audio',
  'computer-use',
  'dall-e',
  'deep-research',
  'embedding',
  'image',
  'moderation',
  'realtime',
  'search-preview',
  'sora',
  'transcribe',
  'tts',
  'whisper'
]

const openAiLlmPrefixes = [
  'babbage-',
  'chat-latest',
  'chatgpt-',
  'codex-',
  'davinci-',
  'ft:',
  'gpt-',
  'o1',
  'o2',
  'o3',
  'o4',
  'o5',
  'o6',
  'o7',
  'o8',
  'o9',
  'text-'
]

export const isOpenAiLlmModelId = (rawId: string): boolean => {
  const id = rawId.trim().toLocaleLowerCase()
  if (!id || excludedOpenAiModelMarkers.some((marker) => id.includes(marker))) return false
  return openAiLlmPrefixes.some((prefix) => id.startsWith(prefix))
}

const isSnapshot = (id: string): boolean => /-\d{4}-\d{2}-\d{2}$/.test(id)

export const sortOpenAiLlmModelIds = (
  modelIds: string[],
  preferred: readonly string[] = []
): string[] => {
  const unique = [...new Set(modelIds.map((id) => id.trim()).filter(isOpenAiLlmModelId))]
  const preferredIndex = new Map(preferred.map((id, index) => [id, index]))
  return unique.sort((left, right) => {
    const leftPreferred = preferredIndex.get(left)
    const rightPreferred = preferredIndex.get(right)
    if (leftPreferred !== undefined || rightPreferred !== undefined) {
      if (leftPreferred === undefined) return 1
      if (rightPreferred === undefined) return -1
      return leftPreferred - rightPreferred
    }
    if (isSnapshot(left) !== isSnapshot(right)) return isSnapshot(left) ? 1 : -1
    return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' })
  })
}
