import {
  mirrorConfirmationModelOutputSchema,
  mirrorScreeningModelOutputSchema,
  type AccountsPayableBillFact,
  type MirrorAssessment
} from '../../domain/schemas'
import { aiRuntime, aiRuntimeReady } from '../../lib/ai-runtime'
import { areDuplicateComparableDocuments } from './document-compatibility'
import { mirrorIntelligenceAgent } from './intelligence-agent'

interface ValidatedScreeningCandidate {
  billIds: [number, number]
  signals: Array<
    | 'reference_collision'
    | 'same_vendor_amount_date'
    | 'shared_tax_id'
    | 'shared_bank_account'
    | 'resubmission_pattern'
    | 'other'
  >
  confidence: number
  rationale: string
}

export interface MirrorIntelligenceResult {
  screening: {
    summary: string
    candidates: ValidatedScreeningCandidate[]
    warnings: string[]
  }
  assessment?: MirrorAssessment
}

const pairKey = (ids: readonly number[]): string => [...ids].sort((a, b) => a - b).join(':')

const intelligenceError = (error: unknown): Error => {
  const message = error instanceof Error ? error.message : 'The configured model did not respond'
  return new Error(`Duplicate bill analysis failed. ${message}`)
}

const compactBill = (bill: AccountsPayableBillFact): Omit<AccountsPayableBillFact, 'lines'> => {
  const compact: Partial<AccountsPayableBillFact> = { ...bill }
  delete compact.lines
  return compact as Omit<AccountsPayableBillFact, 'lines'>
}

const screenCandidates = async (
  bills: AccountsPayableBillFact[],
  contextWarnings: string[]
): Promise<MirrorIntelligenceResult['screening']> => {
  const allowedIds = new Set(bills.map((bill) => bill.id))
  const billById = new Map(bills.map((bill) => [bill.id, bill]))
  let lastIssue = 'The model returned no duplicate-candidate screening'
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await mirrorIntelligenceAgent.generate(
      `Screen the supplied vendor bills for every plausible duplicate pair. This is an intelligence decision,
not a deterministic threshold. Explicitly consider: exact or similar invoice references; same vendor plus
amount and date even if references differ; separate partner IDs sharing an opaque Tax ID or bank fingerprint;
and resubmission patterns. Vendor bills have moveType in_invoice; vendor credit notes have moveType in_refund.
Never pair different moveType values: a credit note reverses or adjusts a bill and is not a duplicate merely
because its values mirror the bill. An R-prefixed number is not evidence of resubmission when moveType is
in_refund. Do not call two documents duplicates yet. Select only same-type pairs that merit the full line-item
confirmation pass, and use only the supplied bill IDs.
${attempt > 0 ? `Your previous response was invalid: ${lastIssue}. Repair it using only these bill IDs: ${[...allowedIds].join(', ')}.` : ''}

${JSON.stringify({ promptVersion: 'mirror-screen-v1', contextWarnings, bills: bills.map(compactBill) }, null, 2)}`,
      {
        structuredOutput: {
          schema: mirrorScreeningModelOutputSchema,
          ...aiRuntime.getStructuredOutputPolicy(),
          instructions: 'Return only plausible pairs made from the supplied bill IDs.'
        },
        modelSettings: aiRuntime.getDeterministicModelSettings({
          maxOutputTokens: 3_500,
          maxRetries: 1
        }),
        abortSignal: AbortSignal.timeout(75_000)
      }
    )
    if (!response.object) continue
    const seen = new Set<string>()
    const candidates = response.object.candidates.flatMap((candidate) => {
      const [left, right] = candidate.billIds
      const key = pairKey(candidate.billIds)
      const leftBill = billById.get(left)
      const rightBill = billById.get(right)
      if (
        left === right ||
        !allowedIds.has(left) ||
        !allowedIds.has(right) ||
        !leftBill ||
        !rightBill ||
        !areDuplicateComparableDocuments(leftBill, rightBill) ||
        seen.has(key)
      ) {
        return []
      }
      seen.add(key)
      return [{ ...candidate, billIds: [left, right] as [number, number] }]
    })
    if (candidates.length !== response.object.candidates.length) {
      lastIssue = 'The response contained an invented, repeated, or invalid candidate pair'
      continue
    }
    return {
      summary: response.object.summary,
      candidates,
      warnings: [...contextWarnings, ...response.object.warnings]
    }
  }
  throw new Error(lastIssue)
}

const confirmCandidates = async (
  bills: AccountsPayableBillFact[],
  screening: MirrorIntelligenceResult['screening']
): Promise<MirrorAssessment> => {
  const billById = new Map(bills.map((bill) => [bill.id, bill]))
  const batches: ValidatedScreeningCandidate[][] = []
  for (let index = 0; index < screening.candidates.length; index += 8) {
    batches.push(screening.candidates.slice(index, index + 8))
  }
  const pairs: MirrorAssessment['pairs'] = []
  const summaries: string[] = []
  for (const [batchIndex, candidates] of batches.entries()) {
    if (
      candidates.some((candidate) => {
        const left = billById.get(candidate.billIds[0])
        const right = billById.get(candidate.billIds[1])
        return !left || !right || !areDuplicateComparableDocuments(left, right)
      })
    ) {
      throw new Error('The screening stage supplied a bill and credit-note pair for confirmation')
    }
    const allowedPairs = new Set(candidates.map((candidate) => pairKey(candidate.billIds)))
    const pairContext = candidates.map((candidate) => ({
      screening: candidate,
      firstBill: billById.get(candidate.billIds[0]),
      secondBill: billById.get(candidate.billIds[1])
    }))
    let validated: MirrorAssessment['pairs'] | undefined
    let summary = ''
    let lastIssue = 'The model returned no duplicate confirmation'
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await mirrorIntelligenceAgent.generate(
        `Confirm or reject each screened duplicate-bill hypothesis using the full line items and identity facts.
Return exactly one verdict for every supplied pair. A likely_duplicate verdict needs strong evidence; use
possible_duplicate when evidence is meaningful but incomplete. Do not treat shared amount alone as enough.
Every supplied pair has the same moveType. Never reinterpret in_refund as a resubmitted in_invoice, and never
use an R-prefixed credit-note number as evidence of resubmission.
This is bounded batch ${batchIndex + 1}.
${attempt > 0 ? `Your previous response was invalid: ${lastIssue}. Repair it and return each allowed pair exactly once.` : ''}

${JSON.stringify({ promptVersion: 'mirror-confirm-v1', pairs: pairContext }, null, 2)}`,
        {
          structuredOutput: {
            schema: mirrorConfirmationModelOutputSchema,
            ...aiRuntime.getStructuredOutputPolicy(),
            instructions: `Return exactly ${candidates.length} pair verdict${candidates.length === 1 ? '' : 's'}.`
          },
          modelSettings: aiRuntime.getDeterministicModelSettings({
            maxOutputTokens: 4_500,
            maxRetries: 1
          }),
          abortSignal: AbortSignal.timeout(75_000)
        }
      )
      if (!response.object) continue
      const seen = new Set<string>()
      const candidateVerdicts = response.object.pairs.flatMap((pair) => {
        const key = pairKey(pair.billIds)
        if (!allowedPairs.has(key) || seen.has(key)) return []
        seen.add(key)
        return [pair]
      })
      if (
        candidateVerdicts.length !== candidates.length ||
        response.object.pairs.length !== candidates.length
      ) {
        lastIssue = 'The response did not include every allowed pair exactly once'
        continue
      }
      validated = candidateVerdicts
      summary = response.object.summary
      break
    }
    if (!validated) throw new Error(lastIssue)
    pairs.push(...validated)
    summaries.push(summary)
  }
  return {
    source: 'llm',
    model: aiRuntime.getModel(),
    promptVersion: 'mirror-confirm-v1',
    checkedAt: new Date().toISOString(),
    summary: summaries.join(' '),
    pairs,
    screening: {
      promptVersion: 'mirror-screen-v1',
      summary: screening.summary,
      candidateCount: screening.candidates.length,
      warnings: screening.warnings
    }
  }
}

export const analyzeDuplicateBills = async (
  bills: AccountsPayableBillFact[],
  contextWarnings: string[] = []
): Promise<MirrorIntelligenceResult> => {
  await aiRuntimeReady
  try {
    const screening = await screenCandidates(bills, contextWarnings)
    return {
      screening,
      assessment:
        screening.candidates.length > 0 ? await confirmCandidates(bills, screening) : undefined
    }
  } catch (error) {
    throw intelligenceError(error)
  }
}

export const testMirrorIntelligenceConnection = async (): Promise<void> => {
  await analyzeDuplicateBills([
    {
      id: 91,
      number: 'BILL/CAPABILITY/1',
      reference: 'CAPABILITY-100',
      moveType: 'in_invoice',
      partnerId: 8,
      partnerName: 'Capability Vendor',
      taxIdFingerprint: 'same-tax',
      bankFingerprints: ['same-bank'],
      invoiceDate: '2026-07-01',
      state: 'posted',
      paymentState: 'not_paid',
      currency: 'EUR',
      amountTotal: 120,
      lines: [{ id: 901, description: 'Capability check', quantity: 1, subtotal: 100 }]
    },
    {
      id: 92,
      number: 'BILL/CAPABILITY/2',
      reference: 'CAPABILITY-100',
      moveType: 'in_invoice',
      partnerId: 8,
      partnerName: 'Capability Vendor',
      taxIdFingerprint: 'same-tax',
      bankFingerprints: ['same-bank'],
      invoiceDate: '2026-07-01',
      state: 'draft',
      paymentState: 'not_paid',
      currency: 'EUR',
      amountTotal: 120,
      lines: [{ id: 902, description: 'Capability check', quantity: 1, subtotal: 100 }]
    }
  ])
}
