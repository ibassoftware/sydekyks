/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { cp, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorkerHarness } from './lib/worker-harness.mjs'

const testRoot = await mkdtemp(join(tmpdir(), 'sydekyks-recovery-'))
const dataDirectory = join(testRoot, 'runtime')
const logDirectory = join(testRoot, 'logs')
const backupDirectory = join(testRoot, 'backup')
const automationName = 'Recovery marker automation'

const databaseFiles = async () =>
  (await readdir(dataDirectory)).filter(
    (name) => name.endsWith('.db') || name.endsWith('.db-wal') || name.endsWith('.db-shm')
  )

const copyDatabaseSet = async (from, to) => {
  await mkdir(to, { recursive: true, mode: 0o700 })
  for (const name of await readdir(from)) {
    if (name.endsWith('.db') || name.endsWith('.db-wal') || name.endsWith('.db-shm')) {
      await cp(join(from, name), join(to, name))
    }
  }
}

let worker
try {
  worker = await new WorkerHarness({ dataDirectory, logDirectory }).start()
  await worker.json('/sydekyks/automations', {
    method: 'POST',
    body: {
      name: automationName,
      sidekickId: 'nudge',
      prompt: 'Review open opportunities and summarize which need attention.',
      trigger: {
        kind: 'schedule',
        schedule: {
          kind: 'interval',
          every: 3,
          unit: 'days',
          time: '09:00',
          timezone: 'UTC',
          anchorAt: new Date().toISOString()
        }
      },
      approvalMode: 'read-only',
      missedRunPolicy: 'run-on-start',
      status: 'draft'
    }
  })
  await worker.stop()
  worker = undefined

  const createdDatabases = await databaseFiles()
  if (createdDatabases.filter((name) => name.endsWith('.db')).length !== 2) {
    throw new Error('The worker did not create both durable databases')
  }
  await copyDatabaseSet(dataDirectory, backupDirectory)

  worker = await new WorkerHarness({ dataDirectory, logDirectory }).start()
  const beforeDelete = await worker.json('/sydekyks/bootstrap')
  const marker = beforeDelete.automations.find((automation) => automation.name === automationName)
  if (!marker) throw new Error('The recovery marker was not durable before rollback')
  await worker.json(`/sydekyks/automations/${marker.id}`, { method: 'DELETE' })
  await worker.stop()
  worker = undefined

  await rm(dataDirectory, { recursive: true, force: true })
  await copyDatabaseSet(backupDirectory, dataDirectory)
  worker = await new WorkerHarness({ dataDirectory, logDirectory }).start()
  const restored = await worker.json('/sydekyks/bootstrap')
  if (!restored.automations.some((automation) => automation.name === automationName)) {
    throw new Error('Restoring the database set did not recover the saved automation')
  }
  console.log(
    'Database recovery passed: both SQLite databases were backed up as a set, rolled back, reopened, and retained durable state.'
  )
} finally {
  await worker?.stop().catch(() => undefined)
  await rm(testRoot, { recursive: true, force: true })
}
