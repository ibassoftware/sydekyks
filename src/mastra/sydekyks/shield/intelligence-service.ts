import {
  shieldAssessmentModelOutputSchema,
  shieldBriefGenerationModelOutputSchema,
  shieldBriefModelOutputSchema,
  type AccountsPayableBillFact,
  type ShieldResult,
  type ShieldVendorChangeFact
} from '../../domain/schemas'
import { aiRuntime, aiRuntimeReady } from '../../lib/ai-runtime'
import { normalizeShieldBrief } from './brief-contract'
import { shieldIntelligenceAgent } from './intelligence-agent'

type ShieldAssessment = NonNullable<ShieldResult['assessment']>
type ShieldBrief = NonNullable<ShieldResult['brief']>

const riskBand = (score: number): 'critical' | 'high' | 'medium' | 'low' =>
  score >= 80 ? 'critical' : score >= 60 ? 'high' : score >= 30 ? 'medium' : 'low'

const intelligenceError = (error: unknown, stage: 'Assess' | 'Brief'): Error => {
  const message = error instanceof Error ? error.message : 'The configured model did not respond'
  return new Error(`Shield ${stage.toLocaleLowerCase()} failed. ${message}`)
}

const evidenceIdsFor = (
  bills: AccountsPayableBillFact[],
  changes: ShieldVendorChangeFact[]
): Set<string> =>
  new Set([
    ...bills.flatMap((bill) => [
      `bill:${bill.id}`,
      `partner:${bill.partnerId}`,
      ...bill.lines.map((line) => `line:${line.id}`)
    ]),
    ...changes.map((change) => `change:${change.id}`)
  ])

export const assessAndBriefFraudRisk = async (
  bills: AccountsPayableBillFact[],
  changes: ShieldVendorChangeFact[],
  contextWarnings: string[] = []
): Promise<{ assessment: ShieldAssessment; brief: ShieldBrief }> => {
  await aiRuntimeReady
  let currentStage: 'Assess' | 'Brief' = 'Assess'
  try {
    const checkedAt = new Date().toISOString()
    const assessments: ShieldAssessment['bills'] = []
    const summaries: string[] = []
    for (let index = 0; index < bills.length; index += 8) {
      const batch = bills.slice(index, index + 8)
      const partnerIds = new Set(batch.map((bill) => bill.partnerId))
      const batchChanges = changes.filter((change) => partnerIds.has(change.partnerId))
      const allowedEvidenceIds = evidenceIdsFor(batch, batchChanges)
      let object: typeof shieldAssessmentModelOutputSchema._output | undefined
      let validatedBatch: ShieldAssessment['bills'] | undefined
      let priorError: unknown
      const prompt = `Assess every supplied vendor bill for payment-review risk. Use contextual judgment and
plausible benign explanations; do not accuse anyone of fraud. Return one assessment for every bill ID.
Use these risk bands exactly: critical 80-100, high 60-79, medium 30-59, low 0-29. Evidence record IDs
must come from the supplied bill:<id>, line:<id>, partner:<id>, and change:<id> identifiers.

${JSON.stringify(
  {
    promptVersion: 'shield-assess-v1',
    checkedAt,
    contextWarnings,
    allowedEvidenceIds: [...allowedEvidenceIds],
    bills: batch.map((bill) => ({
      ...bill,
      evidenceId: `bill:${bill.id}`,
      partnerEvidenceId: `partner:${bill.partnerId}`,
      lines: bill.lines.map((line) => ({ ...line, evidenceId: `line:${line.id}` }))
    })),
    vendorMasterChanges: batchChanges.map((change) => ({
      ...change,
      evidenceId: `change:${change.id}`
    }))
  },
  null,
  2
)}`
      for (let attempt = 0; attempt < 2 && !validatedBatch; attempt += 1) {
        try {
          const response = await shieldIntelligenceAgent.generate(
            attempt === 0
              ? prompt
              : `${prompt}\n\nYour prior response violated the contract. Return all ${batch.length} supplied bill IDs exactly once with a risk level consistent with its score.`,
            {
              structuredOutput: {
                schema: shieldAssessmentModelOutputSchema,
                ...aiRuntime.getStructuredOutputPolicy(),
                instructions: `Return exactly ${batch.length} bill assessment${batch.length === 1 ? '' : 's'}.`
              },
              modelSettings: aiRuntime.getDeterministicModelSettings({
                maxOutputTokens: 5_000,
                maxRetries: 0
              }),
              abortSignal: AbortSignal.timeout(75_000)
            }
          )
          object = response.object
          if (!object) {
            priorError = new Error('The model returned no fraud-risk assessment')
            continue
          }
          const allowedBillIds = new Set(batch.map((bill) => bill.id))
          const seen = new Set<number>()
          const validated = object.bills.flatMap((assessment) => {
            if (
              !allowedBillIds.has(assessment.billId) ||
              seen.has(assessment.billId) ||
              assessment.indicators.some((indicator) =>
                indicator.evidenceRecordIds.some((id) => !allowedEvidenceIds.has(id))
              )
            ) {
              return []
            }
            seen.add(assessment.billId)
            return [{ ...assessment, riskLevel: riskBand(assessment.riskScore) }]
          })
          if (validated.length !== batch.length || object.bills.length !== batch.length) {
            priorError = new Error('The model returned invalid bill or evidence IDs')
            object = undefined
            continue
          }
          validatedBatch = validated
        } catch (error) {
          priorError = error
        }
      }
      if (!object || !validatedBatch) {
        throw priorError ?? new Error('The model returned no valid fraud-risk assessment')
      }
      assessments.push(...validatedBatch)
      summaries.push(object.summary)
    }

    const ranked = assessments.sort(
      (left, right) => right.riskScore - left.riskScore || right.confidence - left.confidence
    )
    const assessment: ShieldAssessment = {
      source: 'llm',
      model: aiRuntime.getModel(),
      promptVersion: 'shield-assess-v1',
      checkedAt,
      summary: summaries.join(' '),
      bills: ranked
    }
    const reviewQueue = ranked.filter((item) => item.reviewRecommended)
    const billById = new Map(bills.map((bill) => [bill.id, bill]))
    currentStage = 'Brief'
    const briefPrompt = `Brief the auditor on the ranked review queue. Return one alert for every reviewRecommended bill and
no others, preserving risk order. Make supporting evidence legible and distinguish observed facts from
interpretation. Put the strongest evidence first and return no more than 6 supporting-evidence items and
4 auditor questions per alert. Keep each brief concise. If the queue is empty, return a clear overview and
no alerts.

${JSON.stringify({ promptVersion: 'shield-brief-v1', assessmentSummary: assessment.summary, requiredBillIdsInOrder: reviewQueue.map((item) => item.billId), reviewQueue: reviewQueue.map((item) => ({ assessment: item, bill: billById.get(item.billId) })) }, null, 2)}`
    let briefObject: typeof shieldBriefModelOutputSchema._output | undefined
    let briefError: unknown
    const expectedIds = reviewQueue.map((item) => item.billId)
    for (let attempt = 0; attempt < 2 && !briefObject; attempt += 1) {
      try {
        const response = await shieldIntelligenceAgent.generate(
          attempt === 0
            ? briefPrompt
            : `${briefPrompt}\n\nYour prior brief violated the contract. Return each required bill ID exactly once and no other IDs. Every alert must have 1-6 supportingEvidence items and 0-4 auditorQuestions. Do not add extra evidence to be comprehensive.`,
          {
            structuredOutput: {
              schema: shieldBriefGenerationModelOutputSchema,
              ...aiRuntime.getStructuredOutputPolicy(),
              instructions: `Return exactly ${reviewQueue.length} auditor alert${reviewQueue.length === 1 ? '' : 's'}, with at most 6 supporting-evidence items and 4 auditor questions per alert.`
            },
            modelSettings: aiRuntime.getDeterministicModelSettings({
              maxOutputTokens: 8_000,
              maxRetries: 0
            }),
            abortSignal: AbortSignal.timeout(75_000)
          }
        )
        if (!response.object) {
          briefError = new Error('The model returned no auditor brief')
          continue
        }
        const normalized = normalizeShieldBrief(response.object)
        const alertById = new Map(normalized.alerts.map((alert) => [alert.billId, alert]))
        if (
          alertById.size !== expectedIds.length ||
          normalized.alerts.length !== expectedIds.length ||
          expectedIds.some((id) => !alertById.has(id))
        ) {
          briefError = new Error('The auditor brief returned invalid bill IDs')
          continue
        }
        briefObject = {
          ...normalized,
          alerts: expectedIds.map((id) => alertById.get(id)!)
        }
      } catch (error) {
        briefError = error
      }
    }
    if (!briefObject) throw briefError ?? new Error('The model returned no valid auditor brief')
    return {
      assessment,
      brief: {
        source: 'llm',
        model: aiRuntime.getModel(),
        promptVersion: 'shield-brief-v1',
        ...briefObject
      }
    }
  } catch (error) {
    throw intelligenceError(error, currentStage)
  }
}

export const testShieldIntelligenceConnection = async (): Promise<void> => {
  await assessAndBriefFraudRisk(
    [
      {
        id: 81,
        number: 'BILL/CAPABILITY/RISK',
        reference: 'CAP-RISK-1',
        moveType: 'in_invoice',
        partnerId: 18,
        partnerName: 'Capability Vendor',
        bankFingerprints: ['capability-bank'],
        invoiceDate: '2026-07-20',
        createdAt: '2026-07-20T10:05:00.000Z',
        state: 'draft',
        paymentState: 'not_paid',
        currency: 'EUR',
        amountTotal: 9_999,
        lines: [{ id: 811, description: 'Capability risk check', subtotal: 9_999 }]
      }
    ],
    [
      {
        id: 'capability-change',
        partnerId: 18,
        partnerName: 'Capability Vendor',
        changedAt: '2026-07-20T10:00:00.000Z',
        field: 'Bank Accounts',
        previousValue: 'old',
        currentValue: 'new',
        source: 'tracking'
      }
    ]
  )
}
