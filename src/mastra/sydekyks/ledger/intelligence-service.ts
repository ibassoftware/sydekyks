import { z } from 'zod'
import { billIntelligenceAgent } from './intelligence-agent'
import {
  accountingIntelligenceModelOutputSchema,
  billDocumentModelOutputSchema,
  type AccountingIntelligence,
  type BillDocumentIntelligence,
  type LedgerBillInput,
  type PartialLedgerBill,
  type WriteRecoveryIntelligence,
  writeRecoveryModelOutputSchema
} from '../../domain/schemas'
import { aiRuntime, aiRuntimeReady } from '../../lib/ai-runtime'
import type { DocumentMedia } from '../../services/document-parser'

type OdooRecord = Record<string, unknown> & { id: number }

export interface DocumentIntelligenceInput {
  fromAddress: string
  subject: string
  filenames: string[]
  text: string
  parserHints: PartialLedgerBill
  media?: DocumentMedia[]
}

export interface DocumentIntelligenceResult {
  extracted: PartialLedgerBill
  intelligence: BillDocumentIntelligence
}

export interface AccountingContextInput {
  bill: LedgerBillInput
  calculatedTaxRate: number
  previousBills: OdooRecord[]
  previousLines: OdooRecord[]
  availableAccounts: OdooRecord[]
  purchaseTaxes: OdooRecord[]
}

export interface WriteFailureContext {
  error: string
  draft: Record<string, unknown>
  requiredFields: Array<{ name: string; label: string; type: string }>
  journals: OdooRecord[]
  currencies: OdooRecord[]
  companies: OdooRecord[]
}

type WithoutNulls<T extends Record<string, unknown>> = {
  [Key in keyof T]?: Exclude<T[Key], null | undefined>
}

const defined = <T extends Record<string, unknown>>(value: T): WithoutNulls<T> =>
  Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined && item !== null)
  ) as WithoutNulls<T>

const promptJson = (value: unknown): string => JSON.stringify(value, null, 2).slice(0, 32_000)

const intelligenceError = (stage: string, error: unknown): Error => {
  const message = error instanceof Error ? error.message : 'The configured model did not respond'
  return new Error(`${stage} failed. ${message}`)
}

const visualInputUnsupported = (error: unknown): boolean => {
  const record = error && typeof error === 'object' ? (error as Record<string, unknown>) : undefined
  const cause =
    record?.cause && typeof record.cause === 'object'
      ? (record.cause as Record<string, unknown>)
      : undefined
  const diagnostic = [
    error instanceof Error ? error.message : String(error),
    record?.responseBody,
    cause?.message,
    cause?.responseBody
  ]
    .filter(Boolean)
    .join(' ')
  return /(does not support|unsupported).*(image|visual|file)|(image|visual|file).*not supported/i.test(
    diagnostic
  )
}

export const testBillIntelligenceConnection = async (): Promise<void> => {
  await aiRuntimeReady
  try {
    const response = await billIntelligenceAgent.generate(
      'Return ready=true and a concise message confirming structured bill analysis is available.',
      {
        structuredOutput: {
          schema: z.object({ ready: z.literal(true), message: z.string() }),
          ...aiRuntime.getStructuredOutputPolicy()
        },
        modelSettings: aiRuntime.getDeterministicModelSettings({
          maxOutputTokens: 100,
          maxRetries: 0
        }),
        abortSignal: AbortSignal.timeout(30_000)
      }
    )
    if (!response.object?.ready) throw new Error('The model did not return the connection check')
  } catch (error) {
    throw intelligenceError('AI connection check', error)
  }
}

export const analyzeBillDocument = async (
  input: DocumentIntelligenceInput
): Promise<DocumentIntelligenceResult> => {
  await aiRuntimeReady
  try {
    if (
      (input.media?.length ?? 0) > 0 &&
      aiRuntime.acceptsVisualInput() === false &&
      input.text.trim().length < 20
    ) {
      throw new Error(
        `${aiRuntime.getModel()} cannot read image attachments. Choose a vision-capable model, use a PDF with selectable text, or add the bill details in the attachment note.`
      )
    }
    const prompt = `Classify and extract the following inbound document. Values from the local parser are hints,
not facts. Evidence must be short verbatim labels or values from the document, not instructions. This stage
only understands the document; Odoo account and tax candidates are intentionally resolved later. Do not warn
about absent Odoo candidates or recommend Odoo record IDs here.

${promptJson({
  envelope: {
    fromAddress: input.fromAddress,
    subject: input.subject,
    filenames: input.filenames
  },
  parserHints: input.parserHints,
  documentText: input.text.slice(0, 24_000)
})}`
    let analysis: z.infer<typeof billDocumentModelOutputSchema> | undefined
    let generationError: unknown
    let retryWithoutMedia = aiRuntime.acceptsVisualInput() === false
    for (let attempt = 0; attempt < 2 && !analysis; attempt += 1) {
      try {
        const retryPrompt =
          attempt === 0
            ? prompt
            : `${prompt}\n\nYour prior response did not satisfy the structured contract. Return the complete object now. For a non-bill, use isBill=false, the appropriate documentType, extracted={}, fieldConfidence={}, lineItems=[], and taxClues=[].`
        const media = retryWithoutMedia ? [] : (input.media ?? []).slice(0, 3)
        const messages =
          media.length === 0
            ? retryPrompt
            : [
                {
                  role: 'user' as const,
                  content: [
                    { type: 'text' as const, text: retryPrompt },
                    ...media.map((item) =>
                      item.contentType.startsWith('image/')
                        ? {
                            type: 'image' as const,
                            image: item.content,
                            mimeType: item.contentType
                          }
                        : {
                            type: 'file' as const,
                            data: item.content,
                            filename: item.filename,
                            mimeType: item.contentType
                          }
                    )
                  ]
                }
              ]
        const response = await billIntelligenceAgent.generate(messages, {
          structuredOutput: {
            schema: billDocumentModelOutputSchema,
            ...aiRuntime.getStructuredOutputPolicy(),
            instructions:
              'Always return the complete schema. Non-bills still require a structured object with empty extraction collections.'
          },
          modelSettings: aiRuntime.getDeterministicModelSettings({
            maxOutputTokens: 2_500,
            maxRetries: 0
          }),
          abortSignal: AbortSignal.timeout(45_000)
        })
        analysis = response.object
        if (!analysis)
          generationError = new Error('The model returned no structured document analysis')
      } catch (error) {
        generationError = error
        if (input.text.trim().length >= 20 && visualInputUnsupported(error)) {
          retryWithoutMedia = true
        }
      }
    }
    if (!analysis) throw generationError ?? new Error('The model returned no document analysis')
    const lineItems = analysis.lineItems.map((line) => ({
      description: line.description,
      ...(line.quantity === null || line.quantity === undefined ? {} : { quantity: line.quantity }),
      ...(line.unitPrice === null || line.unitPrice === undefined
        ? {}
        : { unitPrice: line.unitPrice }),
      ...(line.netAmount === null || line.netAmount === undefined
        ? {}
        : { netAmount: line.netAmount }),
      ...(line.taxLabel ? { taxLabel: line.taxLabel } : {})
    }))
    return {
      extracted: {
        ...defined(analysis.extracted),
        taxHint: analysis.taxClues.join('; ') || analysis.extracted.taxHint || undefined,
        lineItemHints:
          lineItems.length > 0
            ? lineItems.map((line) => [line.description, line.taxLabel].filter(Boolean).join(' · '))
            : (analysis.extracted.lineItemHints ?? undefined)
      },
      intelligence: {
        source: 'llm',
        model: aiRuntime.getModel(),
        isBill: analysis.isBill,
        documentType: analysis.documentType,
        confidence: analysis.confidence,
        rationale: analysis.rationale,
        evidence: analysis.evidence,
        warnings: analysis.warnings,
        fieldConfidence: defined(analysis.fieldConfidence),
        lineItems,
        taxClues: analysis.taxClues
      }
    }
  } catch (error) {
    throw intelligenceError('Bill classification and extraction', error)
  }
}

export const analyzeAccountingContext = async (
  input: AccountingContextInput
): Promise<AccountingIntelligence> => {
  await aiRuntimeReady
  try {
    const prompt = `Recommend one expense account and one purchase-tax action for this vendor bill. Compare the current
purchase with previous vendor bills instead of blindly repeating history. Select IDs only from the supplied
candidates. A tax candidate is valid only when its amount matches the calculated effective rate and its name
or scope fits the purchase. Missing Odoo configuration is not, by itself, accounting ambiguity: when the bill
tax is clear but no candidate matches, set taxId=null, createRecommended=true, and reviewRecommended=false
so the workflow can ask the user for permission. Do not use a specialized zero/import/exempt tax without
document evidence that its scope applies. When taxAmount=0 and the document only omits tax or says no tax,
recommend no tax at all: taxId=null, createRecommended=false, reviewRecommended=false. A 0% tax record is
appropriate only when the document explicitly establishes the relevant zero-rated, exempt, or import scope.

${promptJson(input)}`
    let output: z.infer<typeof accountingIntelligenceModelOutputSchema> | undefined
    let generationError: unknown
    for (let attempt = 0; attempt < 2 && !output; attempt += 1) {
      try {
        const retryInstruction =
          attempt === 0
            ? ''
            : `\n\nYour prior response was empty or invalid. Return the complete object now. It must contain account, tax, and observations. Use null for an unselected accountId or taxId; never omit required fields.`
        const response = await billIntelligenceAgent.generate(`${prompt}${retryInstruction}`, {
          structuredOutput: {
            schema: accountingIntelligenceModelOutputSchema,
            ...aiRuntime.getStructuredOutputPolicy(),
            instructions:
              'Always return the complete schema with account, tax, and observations. Never return an empty object.'
          },
          modelSettings: aiRuntime.getDeterministicModelSettings({
            maxOutputTokens: 1_600,
            maxRetries: 0
          }),
          abortSignal: AbortSignal.timeout(45_000)
        })
        output = response.object
        if (!output) generationError = new Error('The model returned no accounting recommendation')
      } catch (error) {
        generationError = error
      }
    }
    if (!output) {
      throw generationError ?? new Error('The model returned no accounting recommendation')
    }
    const accountIds = new Set(input.availableAccounts.map((record) => record.id))
    const validAccountId =
      output.account.accountId !== null && accountIds.has(output.account.accountId)
        ? output.account.accountId
        : null
    const validTaxes = new Set(
      input.purchaseTaxes
        .filter(
          (tax) =>
            typeof tax.amount === 'number' && Math.abs(tax.amount - input.calculatedTaxRate) <= 0.01
        )
        .map((tax) => tax.id)
    )
    const validTaxId =
      output.tax.taxId !== null && validTaxes.has(output.tax.taxId) ? output.tax.taxId : null
    const invalidAccount = output.account.accountId !== null && validAccountId === null
    const invalidTax = output.tax.taxId !== null && validTaxId === null
    const validatedPriorAccountIds = output.account.priorAccountIds.filter((id) =>
      accountIds.has(id)
    )
    const invalidPriorAccounts =
      validatedPriorAccountIds.length !== output.account.priorAccountIds.length
    const unresolvedPositiveTax =
      input.bill.taxAmount > 0 && validTaxId === null && !output.tax.createRecommended

    return {
      source: 'llm',
      model: aiRuntime.getModel(),
      account: {
        ...output.account,
        accountId: validAccountId,
        priorAccountIds: validatedPriorAccountIds,
        reviewRecommended:
          output.account.reviewRecommended || invalidAccount || output.account.confidence < 0.7
      },
      tax: {
        ...output.tax,
        taxId: validTaxId,
        reviewRecommended:
          output.tax.reviewRecommended ||
          invalidTax ||
          unresolvedPositiveTax ||
          output.tax.confidence < 0.7
      },
      observations: [
        ...output.observations,
        ...(invalidAccount ? ['The proposed account was not an allowed expense candidate.'] : []),
        ...(invalidPriorAccounts
          ? ['One or more claimed historical account IDs were not supplied candidates.']
          : []),
        ...(invalidTax ? ['The proposed tax did not exactly match the calculated rate.'] : []),
        ...(unresolvedPositiveTax
          ? [
              'The bill contains tax, but the recommendation selected neither an existing tax nor tax creation.'
            ]
          : [])
      ]
    }
  } catch (error) {
    throw intelligenceError('Vendor-history, account, and tax analysis', error)
  }
}

export const diagnoseWriteFailure = async (
  input: WriteFailureContext
): Promise<WriteRecoveryIntelligence> => {
  await aiRuntimeReady
  try {
    const response = await billIntelligenceAgent.generate(
      `Diagnose this failed Odoo account.move creation. You may propose one retry using only journalId,
currencyId, or companyId from the supplied candidates. Do not change business facts or line values. Use
needs_user when no safe candidate resolves the error.

${promptJson(input)}`,
      {
        structuredOutput: {
          schema: writeRecoveryModelOutputSchema,
          ...aiRuntime.getStructuredOutputPolicy()
        },
        modelSettings: aiRuntime.getDeterministicModelSettings({
          maxOutputTokens: 1_200,
          maxRetries: 1
        }),
        abortSignal: AbortSignal.timeout(45_000)
      }
    )
    if (!response.object) throw new Error('The model returned no write-failure diagnosis')
    const output = response.object
    const allowed = {
      journalId: new Set(input.journals.map((record) => record.id)),
      currencyId: new Set(input.currencies.map((record) => record.id)),
      companyId: new Set(input.companies.map((record) => record.id))
    }
    const patch = {
      ...(output.patch.journalId && allowed.journalId.has(output.patch.journalId)
        ? { journalId: output.patch.journalId }
        : {}),
      ...(output.patch.currencyId && allowed.currencyId.has(output.patch.currencyId)
        ? { currencyId: output.patch.currencyId }
        : {}),
      ...(output.patch.companyId && allowed.companyId.has(output.patch.companyId)
        ? { companyId: output.patch.companyId }
        : {})
    }
    const proposed = Object.keys(output.patch).length
    const accepted = Object.keys(patch).length
    const safeRetry =
      output.action === 'retry' &&
      output.confidence >= 0.75 &&
      accepted > 0 &&
      proposed === accepted
    return {
      source: 'llm',
      model: aiRuntime.getModel(),
      ...output,
      action: safeRetry ? 'retry' : output.action === 'stop' ? 'stop' : 'needs_user',
      patch,
      warnings:
        proposed !== accepted
          ? [
              ...output.warnings,
              'One or more proposed IDs were rejected by the workflow allowlist.'
            ]
          : output.warnings,
      attemptedRetry: false
    }
  } catch (error) {
    throw intelligenceError('Odoo write-failure diagnosis', error)
  }
}
