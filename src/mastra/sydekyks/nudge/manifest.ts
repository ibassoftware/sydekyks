import type { SydekykManifest } from '../contracts'

export const nudgeManifest: SydekykManifest = {
  id: 'nudge',
  name: 'Nudge',
  role: 'CRM vigilance Sydekyk',
  mode: 'companion-operator',
  kind: 'hybrid',
  status: 'ready',
  description: 'Finds Odoo opportunities that may be quietly losing momentum.',
  capabilities: [
    'AI opportunity assessment',
    'Activity-gap detection',
    'Recent-message context',
    'Flexible automations'
  ],
  gadgets: ['AI', 'Odoo'],
  requiredGadgets: ['AI', 'Odoo'],
  capabilityGrants: [
    {
      gadget: 'Odoo',
      operations: ['read', 'search'],
      models: ['crm.lead', 'mail.activity', 'mail.message']
    }
  ],
  intelligence: [
    {
      id: 'assess-pipeline-attention',
      purpose: 'recommend',
      outputSchema: 'nudgeAssessmentModelOutputSchema',
      promptVersion: 'nudge-attention-v1',
      required: true,
      reviewBelowConfidence: 0.65,
      allowedCandidateKinds: ['crm.lead']
    }
  ],
  triggers: ['chat', 'schedule'],
  workflowIds: ['nudge-stale-opportunities']
}
