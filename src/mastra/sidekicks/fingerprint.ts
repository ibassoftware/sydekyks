import { createHash } from 'node:crypto'
import type { SidekickCapability } from '../domain/schemas'

export const sidekickScopeFingerprint = (capabilities: SidekickCapability[]): string =>
  createHash('sha256')
    .update(
      JSON.stringify(
        capabilities
          .map((capability) => ({
            model: capability.model,
            operations: [...capability.operations].sort()
          }))
          .sort((left, right) => left.model.localeCompare(right.model))
      )
    )
    .digest('hex')
