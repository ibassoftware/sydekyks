import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const testDirectory = await mkdtemp(join(tmpdir(), 'sydekyks-mission-notifications-'))
const bundleDirectory = await mkdtemp(join(import.meta.dirname, '.mission-notifications-'))
process.env.SYDEKYKS_DATA_DIR = testDirectory

let appStore

try {
  const bundledStorePath = join(bundleDirectory, 'app-store-test.cjs')
  await build({
    bundle: true,
    entryPoints: [join(import.meta.dirname, '../src/mastra/lib/app-store.ts')],
    format: 'cjs',
    outfile: bundledStorePath,
    platform: 'node'
  })
  ;({ appStore } = await import(pathToFileURL(bundledStorePath).href))

  const waitingApproval = await appStore.createMission({
    kind: 'ledger.vendor-bill',
    sydekyk: 'Ledger',
    title: 'Approval required',
    summary: 'Waiting for approval.',
    status: 'waiting_approval'
  })
  const needsAttention = await appStore.createMission({
    kind: 'automation.schema-drift',
    sydekyk: 'Renewals',
    title: 'Review required',
    summary: 'Needs attention.',
    status: 'needs_attention'
  })
  const completed = await appStore.createMission({
    kind: 'automation.agent',
    sydekyk: 'Nudge',
    title: 'Complete',
    summary: 'No action required.',
    status: 'completed'
  })

  const acknowledged = await appStore.acknowledgeMissions([
    waitingApproval.id,
    needsAttention.id,
    completed.id
  ])
  if (acknowledged !== 2) throw new Error(`Expected 2 acknowledgements, received ${acknowledged}`)

  const missions = await appStore.listMissions()
  if (!missions.find((mission) => mission.id === waitingApproval.id)?.acknowledgedAt) {
    throw new Error('Waiting approval notification was not acknowledged')
  }
  if (!missions.find((mission) => mission.id === needsAttention.id)?.acknowledgedAt) {
    throw new Error('Needs-attention notification was not acknowledged')
  }
  if (missions.find((mission) => mission.id === completed.id)?.acknowledgedAt) {
    throw new Error('Completed mission was incorrectly acknowledged')
  }

  await appStore.updateMission(waitingApproval.id, { status: 'running' })
  await appStore.updateMission(waitingApproval.id, { status: 'waiting_approval' })
  if ((await appStore.getMission(waitingApproval.id))?.acknowledgedAt) {
    throw new Error('A newly reopened approval retained its old acknowledgement')
  }

  console.log(
    'Mission notification checks passed: clearing hides seen alerts without resolving missions, and reopened work becomes visible again.'
  )
} finally {
  await appStore?.close()
  await Promise.all([
    rm(testDirectory, { recursive: true, force: true }),
    rm(bundleDirectory, { recursive: true, force: true })
  ])
}
