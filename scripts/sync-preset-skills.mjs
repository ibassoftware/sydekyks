/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { format } from 'prettier'

const root = process.cwd()
const skillsRoot = path.join(root, 'skills')
const outputPath = path.join(root, 'src/mastra/sidekicks/preset-skills.generated.ts')

const parse = (markdown, id) => {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n\n?([\s\S]*)$/)
  if (!match) throw new Error(`${id}/SKILL.md needs YAML frontmatter`)
  const frontmatter = Object.fromEntries(
    match[1].split('\n').map((line) => {
      const separator = line.indexOf(':')
      if (separator < 1) throw new Error(`${id}/SKILL.md has invalid frontmatter`)
      return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()]
    })
  )
  if (frontmatter.name !== id) throw new Error(`${id}/SKILL.md name must match its folder`)
  if (!frontmatter.description) throw new Error(`${id}/SKILL.md needs a description`)
  return {
    id,
    name: id[0].toUpperCase() + id.slice(1),
    description: frontmatter.description,
    instructions: match[2].trim()
  }
}

const directories = (await readdir(skillsRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()
const presets = await Promise.all(
  directories.map(async (id) =>
    parse(await readFile(path.join(skillsRoot, id, 'SKILL.md'), 'utf8'), id)
  )
)
const source = await format(
  `// Generated from skills/*/SKILL.md. Run \`npm run skills:sync\` after editing a preset.
export interface PresetSidekick {
  id: string
  name: string
  description: string
  instructions: string
}

export const presetSidekicks: PresetSidekick[] = ${JSON.stringify(presets, null, 2)}
`,
  {
    parser: 'typescript',
    singleQuote: true,
    semi: false,
    printWidth: 100,
    trailingComma: 'none'
  }
)
await writeFile(outputPath, source)
console.log(`Synced ${presets.length} preset skills.`)
