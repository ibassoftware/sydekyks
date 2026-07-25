import { appStore } from '../lib/app-store'
import {
  inboundReviewPolicySchema,
  type InboundReviewPolicy,
  type SydekykManifest,
  type SydekykRosterEntry
} from './contracts'
import { ledgerManifest } from './ledger/manifest'
import { mirrorManifest } from './mirror/manifest'
import { nudgeManifest } from './nudge/manifest'
import { shieldManifest } from './shield/manifest'

const sydManifest: SydekykManifest = {
  id: 'syd',
  name: 'Syd',
  role: 'Steward',
  mode: 'companion-only',
  kind: 'agent',
  status: 'ready',
  description: 'Coordinates your Sydekyks and presents one clear answer.',
  capabilities: ['Conversation', 'Delegation', 'Status synthesis'],
  gadgets: ['AI'],
  requiredGadgets: ['AI'],
  capabilityGrants: [],
  intelligence: [
    {
      id: 'route-and-synthesize',
      purpose: 'synthesize',
      outputSchema: 'conversational Markdown',
      promptVersion: 'syd-steward-v2',
      required: true
    }
  ],
  triggers: ['chat'],
  workflowIds: []
}

const manifests = new Map(
  [sydManifest, ledgerManifest, nudgeManifest, mirrorManifest, shieldManifest].map(
    (manifest) => [manifest.id, manifest] as const
  )
)

const inboundPolicyKey = (sydekykId: string): string => `sydekyk.${sydekykId}.inbound-review-policy`

export const getSydekykManifest = (sydekykId: string): SydekykManifest | undefined =>
  manifests.get(sydekykId)

export const getInboundReviewPolicy = async (
  sydekykId: string
): Promise<InboundReviewPolicy | undefined> => {
  const manifest = getSydekykManifest(sydekykId)
  if (!manifest?.defaultInboundPolicy) return undefined
  const saved = await appStore.getSetting<unknown>(inboundPolicyKey(sydekykId))
  const parsed = inboundReviewPolicySchema.safeParse(saved)
  return parsed.success ? parsed.data : manifest.defaultInboundPolicy
}

export const setInboundReviewPolicy = async (
  sydekykId: string,
  input: unknown
): Promise<InboundReviewPolicy> => {
  const manifest = getSydekykManifest(sydekykId)
  if (!manifest?.defaultInboundPolicy) {
    throw new Error(`${manifest?.name ?? sydekykId} does not accept inbound work`)
  }
  const policy = inboundReviewPolicySchema.parse(input)
  await appStore.setSetting(inboundPolicyKey(sydekykId), policy)
  return policy
}

export const listSydekyks = async (): Promise<SydekykRosterEntry[]> => {
  const automations = await appStore.listAutomations()
  return Promise.all(
    [...manifests.values()].map(async ({ defaultInboundPolicy, ...manifest }) => ({
      ...manifest,
      inboundPolicy: defaultInboundPolicy ? await getInboundReviewPolicy(manifest.id) : undefined,
      automationCount: automations.filter((automation) => automation.ownerSydekykId === manifest.id)
        .length
    }))
  )
}
