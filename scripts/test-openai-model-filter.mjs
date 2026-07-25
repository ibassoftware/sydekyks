import { strict as assert } from 'node:assert'
import { isOpenAiLlmModelId, sortOpenAiLlmModelIds } from '../src/shared/openai-models.ts'

const textModels = [
  'gpt-5.4',
  'gpt-5.4-2026-07-01',
  'o3',
  'codex-mini-latest',
  'text-davinci-003',
  'ft:gpt-4.1-mini:example:billing:abc123'
]

const nonTextModels = [
  'gpt-image-1',
  'gpt-audio-1.5',
  'gpt-realtime',
  'gpt-4o-mini-transcribe',
  'text-embedding-3-large',
  'omni-moderation-latest',
  'computer-use-preview',
  'o3-deep-research',
  'sora-2',
  'tts-1',
  'whisper-1'
]

for (const id of textModels) {
  assert.equal(isOpenAiLlmModelId(id), true, `${id} should be available as an LLM candidate`)
}

for (const id of nonTextModels) {
  assert.equal(isOpenAiLlmModelId(id), false, `${id} should not be shown as an LLM candidate`)
}

assert.deepEqual(
  sortOpenAiLlmModelIds(
    ['gpt-5.4-2026-07-01', 'gpt-image-1', 'o3', 'gpt-5.4', 'o3', 'codex-mini-latest'],
    ['gpt-5.4', 'o3']
  ),
  ['gpt-5.4', 'o3', 'codex-mini-latest', 'gpt-5.4-2026-07-01'],
  'Preferred models should lead, duplicates should be removed, and snapshots should follow aliases'
)

console.log('OpenAI model-list filter checks passed.')
