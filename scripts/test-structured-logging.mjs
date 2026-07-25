import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLocalLogger } from '../src/shared/local-logger.ts'

const directory = await mkdtemp(join(tmpdir(), 'sydekyks-logging-'))
const secret = 'throwaway-secret-value-that-must-never-appear'
try {
  const logger = createLocalLogger({
    directory,
    filename: 'release.jsonl',
    scope: 'release-test',
    maximumBytes: 600,
    retainedFiles: 3
  })
  for (let index = 0; index < 30; index += 1) {
    logger.info('rotation.event', {
      index,
      apiKey: secret,
      authorization: `Bearer ${secret}`,
      nested: { password: secret },
      ordinary: 'This non-secret audit context should remain visible.'
    })
  }
  await logger.flush()
  const files = (await readdir(directory)).filter((name) => name.startsWith('release.jsonl'))
  if (!files.includes('release.jsonl.1')) throw new Error('The JSONL log did not rotate')
  if (files.length > 4) throw new Error('The JSONL log exceeded its retention limit')
  for (const file of files) {
    const path = join(directory, file)
    const content = await readFile(path, 'utf8')
    if (content.includes(secret)) throw new Error(`Secret redaction failed in ${file}`)
    for (const line of content.trim().split('\n').filter(Boolean)) JSON.parse(line)
    const metadata = await stat(path)
    if ((metadata.mode & 0o077) !== 0) throw new Error(`${file} is readable outside its owner`)
  }
  console.log(
    'Structured logging passed: JSONL, secret redaction, owner-only files, rotation, retention.'
  )
} finally {
  await rm(directory, { recursive: true, force: true })
}
