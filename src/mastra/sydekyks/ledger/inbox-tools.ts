import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { imapPublicStatusSchema } from '../../domain/schemas'
import { imapGadget } from '../../gadgets/imap-gateway'
import { appStore } from '../../lib/app-store'
import { inboundReviewPolicySchema } from '../contracts'
import { getInboundReviewPolicy, setInboundReviewPolicy } from '../registry'

const handlingSchema = z.enum([
  'review-every-bill',
  'auto-create-confident-drafts',
  'auto-create-complete-drafts'
])

const setupSchema = z.object({
  inbox: imapPublicStatusSchema,
  policy: inboundReviewPolicySchema,
  handling: handlingSchema,
  effect: z.string()
})

const handlingForPolicy = (
  reviewMode: 'always' | 'when-uncertain' | 'automatic'
): z.infer<typeof handlingSchema> => {
  if (reviewMode === 'when-uncertain') return 'auto-create-confident-drafts'
  if (reviewMode === 'automatic') return 'auto-create-complete-drafts'
  return 'review-every-bill'
}

const effectForHandling = (handling: z.infer<typeof handlingSchema>): string => {
  if (handling === 'auto-create-confident-drafts') {
    return 'Complete vendor bills above the confidence threshold and without warnings may proceed automatically to an Odoo draft; uncertain bills stop for review.'
  }
  if (handling === 'auto-create-complete-drafts') {
    return 'Every complete email classified as a vendor bill may proceed automatically to an Odoo draft; incomplete bills stop for review.'
  }
  return 'Every detected vendor bill stops for human review before Ledger prepares an Odoo draft.'
}

const currentSetup = async (): Promise<z.infer<typeof setupSchema>> => {
  const policy = await getInboundReviewPolicy('ledger')
  if (!policy) throw new Error('Ledger inbound processing is unavailable')
  const handling = handlingForPolicy(policy.reviewMode)
  return {
    inbox: imapGadget.getStatus(),
    policy,
    handling,
    effect: effectForHandling(handling)
  }
}

export const inspectLedgerInboxTool = createTool({
  id: 'inspect-ledger-inbox',
  description:
    'Inspect whether the Email inbox Gadget is connected, how often it checks for mail, and whether Ledger reviews or automatically prepares draft vendor bills. Use this before answering or changing an email-to-bill request.',
  inputSchema: z.object({}),
  outputSchema: setupSchema,
  execute: currentSetup
})

export const configureLedgerInboxTool = createTool({
  id: 'configure-ledger-inbox',
  description:
    'Configure the connected Email inbox Gadget and Ledger’s sealed email-to-draft-bill path. Use checkEveryMinutes 1440 for once per day. Choose review-every-bill by default; use an automatic mode only when the user explicitly requests automatic Odoo draft creation. This changes future processing and pauses for approval.',
  inputSchema: z.object({
    checkEveryMinutes: z
      .number()
      .int()
      .min(1)
      .max(1_440)
      .describe('Inbox polling cadence in minutes; 1440 means once per day'),
    handling: handlingSchema,
    confidenceThreshold: z
      .number()
      .min(0.5)
      .max(1)
      .default(0.9)
      .describe('Used by auto-create-confident-drafts; 0.9 is the safe default')
  }),
  outputSchema: setupSchema.extend({ missionId: z.string().uuid() }),
  requireApproval: true,
  execute: async ({ checkEveryMinutes, handling, confidenceThreshold }) => {
    const status = imapGadget.getStatus()
    if (!status.configured || !status.connected) {
      throw new Error(
        'Connect the Email inbox Gadget before enabling recurring email-to-bill processing'
      )
    }
    const reviewMode =
      handling === 'review-every-bill'
        ? 'always'
        : handling === 'auto-create-confident-drafts'
          ? 'when-uncertain'
          : 'automatic'
    await imapGadget.setPollInterval(checkEveryMinutes)
    await setInboundReviewPolicy('ledger', { reviewMode, confidenceThreshold })
    const mission = await appStore.createMission({
      kind: 'ledger.inbox-configuration',
      sydekyk: 'Ledger',
      title: 'Configure email-to-bill processing',
      summary: `Ledger will check the connected inbox every ${checkEveryMinutes} minute${checkEveryMinutes === 1 ? '' : 's'}. ${effectForHandling(handling)}`,
      status: 'completed',
      payload: { checkEveryMinutes, handling, confidenceThreshold }
    })
    return { ...(await currentSetup()), missionId: mission.id }
  }
})
