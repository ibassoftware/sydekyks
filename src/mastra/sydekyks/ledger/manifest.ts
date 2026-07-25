import type { SydekykManifest } from '../contracts'

export const ledgerManifest: SydekykManifest = {
  id: 'ledger',
  name: 'Ledger',
  role: 'Accounting Sydekyk',
  mode: 'companion-operator',
  kind: 'hybrid',
  status: 'ready',
  description: 'Checks vendor bills and prepares draft bills in Odoo.',
  capabilities: [
    'AI bill classification',
    'Vendor matching',
    'Accounting recommendations',
    'Tax checks',
    'Draft recovery'
  ],
  gadgets: ['AI', 'Odoo', 'Inbound email'],
  requiredGadgets: ['AI', 'Odoo'],
  capabilityGrants: [
    {
      gadget: 'Odoo',
      operations: ['read', 'search', 'create'],
      models: [
        'res.partner',
        'account.tax',
        'account.account',
        'account.move',
        'account.move.line',
        'res.currency',
        'res.company',
        'account.journal'
      ]
    },
    { gadget: 'Inbound email', operations: ['read'] }
  ],
  intelligence: [
    {
      id: 'classify-and-extract-bill',
      purpose: 'extract',
      outputSchema: 'billDocumentModelOutputSchema',
      promptVersion: 'ledger-document-v1',
      required: true,
      reviewBelowConfidence: 0.9
    },
    {
      id: 'recommend-account-and-tax',
      purpose: 'recommend',
      outputSchema: 'accountingIntelligenceModelOutputSchema',
      promptVersion: 'ledger-accounting-v1',
      required: true,
      reviewBelowConfidence: 0.75,
      allowedCandidateKinds: ['account.account', 'account.tax']
    },
    {
      id: 'diagnose-write-failure',
      purpose: 'diagnose',
      outputSchema: 'writeRecoveryModelOutputSchema',
      promptVersion: 'ledger-write-recovery-v1',
      required: true,
      allowedCandidateKinds: ['account.journal', 'res.currency', 'res.company']
    }
  ],
  triggers: ['chat', 'email'],
  workflowIds: ['ledger-vendor-bill'],
  defaultInboundPolicy: {
    reviewMode: 'always',
    confidenceThreshold: 0.9
  }
}
