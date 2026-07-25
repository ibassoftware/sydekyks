import type { SydekykManifest } from '../contracts'

export const shieldManifest: SydekykManifest = {
  id: 'shield',
  name: 'Shield',
  role: 'Accounts-payable risk sentinel',
  mode: 'companion-operator',
  kind: 'hybrid',
  status: 'ready',
  description: 'Turns vendor-bill and vendor-master signals into a ranked auditor brief.',
  capabilities: [
    'Vendor-bill monitoring',
    'Vendor-master change context',
    'AI fraud-risk assessment',
    'Ranked review queue',
    'Auditor briefing'
  ],
  gadgets: ['AI', 'Odoo'],
  requiredGadgets: ['AI', 'Odoo'],
  capabilityGrants: [
    {
      gadget: 'Odoo',
      operations: ['read', 'search'],
      models: [
        'account.move',
        'account.move.line',
        'res.partner',
        'res.partner.bank',
        'mail.message',
        'mail.tracking.value'
      ]
    }
  ],
  intelligence: [
    {
      id: 'assess-fraud-risk',
      purpose: 'recommend',
      outputSchema: 'shieldAssessmentModelOutputSchema',
      promptVersion: 'shield-assess-v1',
      required: true,
      reviewBelowConfidence: 0.7,
      allowedCandidateKinds: ['account.move', 'res.partner', 'mail.tracking.value']
    },
    {
      id: 'brief-auditor',
      purpose: 'synthesize',
      outputSchema: 'shieldBriefModelOutputSchema',
      promptVersion: 'shield-brief-v1',
      required: true,
      allowedCandidateKinds: ['account.move']
    }
  ],
  triggers: ['chat', 'schedule'],
  workflowIds: ['shield-fraud-review']
}
