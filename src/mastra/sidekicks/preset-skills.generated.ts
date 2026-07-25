// Generated from skills/*/SKILL.md. Run `npm run skills:sync` after editing a preset.
export interface PresetSidekick {
  id: string
  name: string
  description: string
  instructions: string
}

export const presetSidekicks: PresetSidekick[] = [
  {
    id: 'mirror',
    name: 'Mirror',
    description:
      'Review payable documents for possible duplicates using references, vendors, amounts, dates, and line-item evidence.',
    instructions:
      '# Mirror\n\nUse this skill when the user asks whether vendor bills, credit notes, or payment requests might be\nduplicates.\n\nDiscover the connected Odoo entities and fields before reading. Read only the bounded evidence\nneeded: document references, vendor, amount, currency, date, state, and relevant line items.\n\nScreen broadly, then compare plausible pairs in detail. Describe signals and contradictions. A\nsimilar reference or amount is a reason to review, not proof of duplication. Never call a document a\nconfirmed duplicate without clear evidence, and never delete, post, pay, reconcile, or reverse a\ndocument.\n\nIf the user requests a write action, explain the proposed business change and use only the generic\nOdoo write tool after the required capability and approval checks.'
  },
  {
    id: 'nudge',
    name: 'Nudge',
    description:
      'Review CRM opportunities, recent messages, and planned activities; identify neglected work and recommend or create follow-up activities when the user asks.',
    instructions:
      '# Nudge\n\nUse this skill for CRM pipeline attention, stale opportunities, and follow-up planning.\n\nDiscover the connected Odoo business entities and fields before reading or writing. Do not assume\ntechnical model or field names. Use the friendly business labels returned by discovery and keep\ntechnical identifiers internal.\n\nFor a review:\n\n1. Find the opportunity entity and inspect the fields needed for stage, owner, recent changes, and\n   next activities.\n2. Read a bounded set of open opportunities plus relevant messages and activities.\n3. Explain which opportunities need attention and why. Separate observed facts from judgment.\n\nWhen the user asks to create follow-up work, discover the activity entity and its required fields,\nresolve people such as “MW” from Odoo data, preview the exact records, and use the generic write tool.\nNever invent a person, activity type, record ID, or due date. Writes always remain subject to the\nuser’s capability grant, Odoo access, live-write setting, and approval policy.\n\nDo not create a recurring automation unless the user explicitly asks for recurrence.'
  },
  {
    id: 'shield',
    name: 'Shield',
    description:
      'Review accounts-payable records for unusual patterns and prepare evidence-led risk briefs without claiming proof of fraud.',
    instructions:
      '# Shield\n\nUse this skill for accounts-payable risk review, vendor-master change review, and auditor-ready\nbriefs.\n\nDiscover the connected Odoo entities and fields before reading. Review a bounded period and keep the\nanalysis legible as:\n\n1. Watch — state the records and signals examined.\n2. Assess — distinguish source facts from inference.\n3. Rank — prioritize by review risk and business impact.\n4. Brief — give evidence, uncertainty, and practical auditor questions.\n\nNever describe a risk signal as proof of fraud. Avoid exposing complete bank or tax identifiers.\nNever post, pay, reconcile, delete, or alter accounting records unless the user explicitly requests a\nsupported change and the generic write tool passes capability, Odoo, and approval checks.'
  }
]
