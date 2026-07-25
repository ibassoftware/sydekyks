import { appStore } from '../lib/app-store'
import {
  inboundReviewPolicySchema,
  type InboundReviewPolicy,
  type SydekykManifest
} from './contracts'
import { ledgerManifest } from './ledger/manifest'

const manifests = new Map([[ledgerManifest.id, ledgerManifest] as const])

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
