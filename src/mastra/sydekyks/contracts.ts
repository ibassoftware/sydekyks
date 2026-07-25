import { z } from 'zod'

export const inboundReviewModeSchema = z.enum(['always', 'when-uncertain', 'automatic'])

export const inboundReviewPolicySchema = z.object({
  reviewMode: inboundReviewModeSchema,
  confidenceThreshold: z.number().min(0.5).max(1)
})

export type InboundReviewPolicy = z.infer<typeof inboundReviewPolicySchema>

export interface CapabilityGrant {
  gadget: string
  operations: Array<'read' | 'search' | 'create' | 'write'>
  models?: string[]
}

export interface IntelligenceMoment {
  id: string
  purpose: 'classify' | 'extract' | 'recommend' | 'diagnose' | 'synthesize'
  outputSchema: string
  promptVersion: string
  required: true
  reviewBelowConfidence?: number
  allowedCandidateKinds?: string[]
}

export interface SydekykManifest {
  id: string
  name: string
  role: string
  mode: 'companion-operator' | 'companion-only' | 'automation-only'
  kind: 'agent' | 'workflow' | 'hybrid'
  status: string
  description: string
  capabilities: string[]
  gadgets: string[]
  requiredGadgets: string[]
  capabilityGrants: CapabilityGrant[]
  intelligence: IntelligenceMoment[]
  triggers: Array<'chat' | 'email' | 'schedule'>
  workflowIds: string[]
  defaultInboundPolicy?: InboundReviewPolicy
}

export interface SydekykRosterEntry extends Omit<SydekykManifest, 'defaultInboundPolicy'> {
  inboundPolicy?: InboundReviewPolicy
  automationCount: number
}
