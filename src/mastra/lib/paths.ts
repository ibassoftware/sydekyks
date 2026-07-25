import { existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const findProjectRoot = (start: string): string => {
  let candidate = resolve(start)
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(resolve(candidate, 'package.json'))) return candidate
    const parent = dirname(candidate)
    if (parent === candidate) break
    candidate = parent
  }
  return resolve(start)
}

const projectRoot = findProjectRoot(process.cwd())
const configuredDataDirectory = process.env.SYDEKYKS_DATA_DIR?.trim()

// Electron always supplies an absolute, per-user directory. The project-local
// fallback exists only for explicit, standalone development of the Mastra app.
export const dataDirectory = configuredDataDirectory
  ? resolve(configuredDataDirectory)
  : resolve(projectRoot, 'data')
mkdirSync(dataDirectory, { recursive: true, mode: 0o700 })

export const appDatabasePath = resolve(dataDirectory, 'sydekyks-app.db')
export const mastraDatabasePath = resolve(dataDirectory, 'sydekyks-mastra.db')
export const appDatabaseUrl = `file:${appDatabasePath}`
export const mastraDatabaseUrl = `file:${mastraDatabasePath}`
