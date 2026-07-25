import type { SydekykManifest } from '../contracts'

export const mirrorManifest: SydekykManifest = {
  id: 'mirror',
  name: 'Mirror',
  role: 'Accounts-payable watchdog',
  mode: 'companion-operator',
  kind: 'hybrid',
  status: 'ready',
  description: 'Catches likely duplicate vendor bills before you pay twice.',
  capabilities: [
    'AI duplicate screening',
    'Reference collision analysis',
    'Split-vendor identity matching',
    'Line-item confirmation',
    'Flexible automations'
  ],
  gadgets: ['AI', 'Odoo'],
  requiredGadgets: ['AI', 'Odoo'],
  capabilityGrants: [
    {
      gadget: 'Odoo',
      operations: ['read', 'search'],
      models: ['account.move', 'account.move.line', 'res.partner', 'res.partner.bank']
    }
  ],
  intelligence: [
    {
      id: 'screen-duplicate-candidates',
      purpose: 'classify',
      outputSchema: 'mirrorScreeningModelOutputSchema',
      promptVersion: 'mirror-screen-v1',
      required: true,
      reviewBelowConfidence: 0.7,
      allowedCandidateKinds: ['account.move']
    },
    {
      id: 'confirm-duplicate-pairs',
      purpose: 'recommend',
      outputSchema: 'mirrorConfirmationModelOutputSchema',
      promptVersion: 'mirror-confirm-v1',
      required: true,
      reviewBelowConfidence: 0.75,
      allowedCandidateKinds: ['account.move', 'account.move.line']
    }
  ],
  triggers: ['chat', 'schedule'],
  workflowIds: ['mirror-duplicate-bills']
}
