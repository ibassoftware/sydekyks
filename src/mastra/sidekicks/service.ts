import { appStore } from '../lib/app-store'
import {
  sidekickCapabilitySchema,
  sidekickCreateSchema,
  sidekickUpdateSchema,
  type SidekickCapability,
  type SidekickRecord
} from '../domain/schemas'

const slugify = (name: string): string =>
  name
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64) || 'sidekick'

export const listSidekicks = (activeOnly = false): Promise<SidekickRecord[]> =>
  appStore.listSidekicks({ activeOnly })

export const createSidekick = async (rawInput: unknown): Promise<SidekickRecord> => {
  const input = sidekickCreateSchema.parse(rawInput)
  const baseId = slugify(input.name)
  let id = baseId
  let suffix = 2
  while (await appStore.getSidekick(id)) id = `${baseId}-${suffix++}`
  return appStore.createSidekick({ id, ...input, source: 'user' })
}

export const updateSidekick = async (id: string, rawUpdate: unknown): Promise<SidekickRecord> =>
  appStore.updateSidekick(id, sidekickUpdateSchema.parse(rawUpdate))

export const setSidekickCapability = async (
  sidekickId: string,
  rawCapability: unknown
): Promise<SidekickCapability> => {
  const capability = sidekickCapabilitySchema.parse(rawCapability)
  return appStore.setSidekickCapability(sidekickId, capability)
}
