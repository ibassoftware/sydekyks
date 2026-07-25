import { createStep, createWorkflow } from '@mastra/core/workflows'
import { z } from 'zod'
import {
  accountingIntelligenceSchema,
  approvalDecisionSchema,
  ledgerBillInputSchema,
  writeRecoveryIntelligenceSchema
} from '../../../domain/schemas'
import { odooGadget, odooGadgetReady } from '../../../gadgets/odoo-gateway'
import { appStore } from '../../../lib/app-store'
import { analyzeAccountingContext, diagnoseWriteFailure } from '../intelligence-service'

const preparedBillSchema = z.object({
  bill: ledgerBillInputSchema,
  duplicate: z
    .object({
      id: z.number(),
      name: z.string().optional(),
      ref: z.string().optional()
    })
    .optional(),
  partnerId: z.number().optional(),
  partnerName: z.string(),
  partnerPermission: z.boolean(),
  taxId: z.number().optional(),
  taxName: z.string().optional(),
  taxRate: z.number(),
  taxPermission: z.boolean(),
  accountId: z.number().optional(),
  accountName: z.string().optional(),
  accountSource: z.enum(['ai-recommendation', 'missing']),
  currencyId: z.number().optional(),
  currencyName: z.string().optional(),
  intelligence: accountingIntelligenceSchema.optional(),
  checks: z.array(z.string())
})

const authorizedBillSchema = preparedBillSchema.extend({
  partnerId: z.number().optional(),
  decision: z.enum(['continue', 'declined', 'duplicate']),
  declinedReason: z.string().optional()
})

const ledgerResultSchema = z.object({
  outcome: z.enum(['created', 'dry-run', 'needs-review', 'declined', 'duplicate']),
  message: z.string(),
  moveId: z.number().optional(),
  partnerId: z.number().optional(),
  taxId: z.number().optional(),
  accountId: z.number().optional(),
  currencyId: z.number().optional(),
  intelligence: accountingIntelligenceSchema.optional(),
  writeRecovery: writeRecoveryIntelligenceSchema.optional(),
  checks: z.array(z.string()),
  draft: z.record(z.string(), z.unknown()).optional()
})

const intakeStep = createStep({
  id: 'validate-bill',
  description: 'Validate and normalize the vendor bill supplied to Ledger.',
  inputSchema: ledgerBillInputSchema,
  outputSchema: ledgerBillInputSchema,
  execute: async ({ inputData }) => inputData
})

const mayWriteBill = (bill: z.infer<typeof ledgerBillInputSchema>): boolean => {
  const status = odooGadget.getStatus()
  return bill.confirmWrite && (status.mode === 'demo' || status.liveWrites)
}

const reconcileStep = createStep({
  id: 'reconcile-odoo',
  description: 'Check duplicates, partner, tax, vendor history, and available account titles.',
  inputSchema: ledgerBillInputSchema,
  outputSchema: preparedBillSchema,
  execute: async ({ inputData: bill }) => {
    await odooGadgetReady
    const gateway = odooGadget.getGateway()
    const checks: string[] = []

    const partners = await gateway.searchRead(
      'res.partner',
      [['name', '=ilike', bill.vendorName]],
      ['name', 'supplier_rank'],
      1
    )
    const partner = partners[0]
    const partnerName = partner && typeof partner.name === 'string' ? partner.name : bill.vendorName
    checks.push(
      partner ? `Matched vendor ${partnerName}` : `Vendor ${bill.vendorName} does not exist`
    )

    const partnerScope = `vendor:${bill.vendorName.trim().toLocaleLowerCase()}`
    const partnerPermission = partner
      ? true
      : await appStore.hasPermission('odoo.partner.create', partnerScope)
    if (!partner && partnerPermission)
      checks.push('Stored permission allows this vendor to be created')

    const taxRate =
      bill.untaxedAmount > 0 ? Number(((bill.taxAmount / bill.untaxedAmount) * 100).toFixed(4)) : 0
    const duplicates = partner
      ? await gateway.searchRead(
          'account.move',
          [
            ['move_type', '=', 'in_invoice'],
            ['partner_id', '=', partner.id],
            ['ref', '=', bill.invoiceNumber]
          ],
          ['name', 'ref'],
          1
        )
      : []
    const duplicate = duplicates[0]
      ? {
          id: duplicates[0].id,
          name: typeof duplicates[0].name === 'string' ? duplicates[0].name : undefined,
          ref: typeof duplicates[0].ref === 'string' ? duplicates[0].ref : undefined
        }
      : undefined
    checks.push(
      duplicate
        ? `Duplicate reference found for ${partnerName} on move ${duplicate.id}`
        : partner
          ? `No duplicate reference found for ${partnerName}`
          : 'No existing vendor matched; no vendor-specific duplicate exists'
    )

    if (duplicate) {
      return {
        bill,
        duplicate,
        partnerId: partner?.id,
        partnerName,
        partnerPermission,
        taxRate,
        taxPermission: false,
        accountSource: 'missing' as const,
        checks
      }
    }

    const [purchaseTaxes, currencies] = await Promise.all([
      gateway.searchRead(
        'account.tax',
        [['type_tax_use', '=', 'purchase']],
        ['name', 'amount', 'active'],
        50
      ),
      gateway.searchRead(
        'res.currency',
        [
          ['name', '=', bill.currency],
          ['active', '=', true]
        ],
        ['name', 'symbol', 'active'],
        2
      )
    ])
    const currency = currencies[0]
    checks.push(
      currency
        ? `Matched currency ${String(currency.name)}`
        : `Currency ${bill.currency} is not active in Odoo`
    )
    let account: (Record<string, unknown> & { id: number }) | undefined
    let accountSource: 'ai-recommendation' | 'missing' = 'missing'
    let previousBills: Array<Record<string, unknown> & { id: number }> = []
    let previousLines: Array<Record<string, unknown> & { id: number }> = []
    let historicalAccounts: Array<Record<string, unknown> & { id: number }> = []
    if (partner) {
      ;[previousBills, previousLines] = await Promise.all([
        gateway.searchRead(
          'account.move',
          [
            ['partner_id', '=', partner.id],
            ['move_type', '=', 'in_invoice'],
            ['state', '=', 'posted']
          ],
          ['name', 'ref', 'invoice_date', 'amount_total', 'currency_id'],
          12
        ),
        gateway.searchRead(
          'account.move.line',
          [
            ['partner_id', '=', partner.id],
            ['parent_state', '=', 'posted'],
            ['display_type', '=', 'product']
          ],
          ['account_id', 'name', 'move_id'],
          20
        )
      ])
      const historicalAccountIds = [
        ...new Set(
          previousLines
            .map((line) => line.account_id)
            .filter(Array.isArray)
            .map((relation) => relation[0])
            .filter((id): id is number => typeof id === 'number')
        )
      ]
      historicalAccounts =
        historicalAccountIds.length > 0
          ? await gateway.read('account.account', historicalAccountIds, [
              'code',
              'name',
              'account_type'
            ])
          : []
    }

    const availableAccounts = await gateway.searchRead(
      'account.account',
      [['account_type', 'in', ['expense', 'expense_depreciation', 'expense_direct_cost']]],
      ['code', 'name', 'account_type'],
      100
    )

    const accountCandidates = [...availableAccounts]
    for (const historical of historicalAccounts) {
      if (!accountCandidates.some((candidate) => candidate.id === historical.id)) {
        accountCandidates.push(historical)
      }
    }
    const intelligence = await analyzeAccountingContext({
      bill,
      calculatedTaxRate: taxRate,
      previousBills,
      previousLines,
      availableAccounts: accountCandidates,
      purchaseTaxes
    })

    const intelligentAccount = accountCandidates.find(
      (candidate) => candidate.id === intelligence.account.accountId
    )
    if (intelligentAccount) {
      account = intelligentAccount
      accountSource = 'ai-recommendation'
    }
    const tax = purchaseTaxes.find((candidate) => candidate.id === intelligence.tax.taxId)

    checks.push(tax ? `Matched ${String(tax.name)}` : `No purchase tax exactly matches ${taxRate}%`)
    const taxPermission = tax
      ? true
      : await appStore.hasPermission('odoo.tax.create', `purchase:${taxRate}`)
    if (!tax && taxPermission)
      checks.push('Stored permission allows this purchase tax to be created')

    checks.push(
      `Ledger Intelligence (${intelligence.source}): ${intelligence.account.rationale}`,
      `Tax analysis: ${intelligence.tax.rationale}`,
      ...intelligence.observations
    )

    checks.push(
      account
        ? `Selected ${String(account.code ?? '')} ${String(account.name ?? '')} from ${accountSource}`
        : 'No suitable account title was found'
    )

    return {
      bill,
      duplicate,
      partnerId: partner?.id,
      partnerName,
      partnerPermission,
      taxId: tax?.id,
      taxName: typeof tax?.name === 'string' ? tax.name : undefined,
      taxRate,
      taxPermission,
      accountId: account?.id,
      accountName: typeof account?.name === 'string' ? account.name : undefined,
      accountSource,
      currencyId: currency?.id,
      currencyName: typeof currency?.name === 'string' ? currency.name : undefined,
      intelligence,
      checks
    }
  }
})

const authorizePartnerStep = createStep({
  id: 'authorize-partner',
  description: 'Suspend for explicit permission before Ledger creates a missing Odoo partner.',
  inputSchema: preparedBillSchema,
  outputSchema: authorizedBillSchema,
  resumeSchema: approvalDecisionSchema,
  suspendSchema: z.object({
    type: z.literal('partner-create'),
    title: z.string(),
    message: z.string(),
    vendorName: z.string(),
    capability: z.string()
  }),
  execute: async ({ inputData, resumeData, suspend }) => {
    if (inputData.duplicate) return { ...inputData, decision: 'duplicate' as const }
    const intelligence = inputData.intelligence
    if (!intelligence) throw new Error('Ledger Intelligence did not return accounting context')
    const taxNeedsReview = intelligence.tax.reviewRecommended && !intelligence.tax.createRecommended
    if (
      !inputData.currencyId ||
      !inputData.accountId ||
      intelligence.account.reviewRecommended ||
      taxNeedsReview
    ) {
      return { ...inputData, decision: 'continue' as const }
    }
    if (inputData.partnerId) return { ...inputData, decision: 'continue' as const }
    if (!mayWriteBill(inputData.bill)) {
      return { ...inputData, decision: 'continue' as const }
    }

    if (!inputData.partnerPermission && resumeData === undefined) {
      return suspend({
        type: 'partner-create',
        title: 'Create missing Odoo partner?',
        message: `${inputData.partnerName} is not in Odoo. Ledger needs permission to create the vendor before preparing this bill.`,
        vendorName: inputData.partnerName,
        capability: 'odoo.partner.create'
      })
    }

    if (!inputData.partnerPermission && resumeData?.approved === false) {
      return {
        ...inputData,
        decision: 'declined' as const,
        declinedReason: 'Permission to create the missing vendor partner was declined.'
      }
    }

    if (resumeData?.remember) {
      await appStore.grantPermission(
        'odoo.partner.create',
        `vendor:${inputData.partnerName.trim().toLocaleLowerCase()}`
      )
    }
    return {
      ...inputData,
      partnerPermission: true,
      decision: 'continue' as const,
      checks: [
        ...inputData.checks,
        `Vendor creation authorized; ${inputData.partnerName} will be created after all approval gates pass`
      ]
    }
  }
})

const authorizeTaxStep = createStep({
  id: 'authorize-tax',
  description: 'Suspend for explicit permission before Ledger creates a missing Odoo purchase tax.',
  inputSchema: authorizedBillSchema,
  outputSchema: authorizedBillSchema,
  resumeSchema: approvalDecisionSchema,
  suspendSchema: z.object({
    type: z.literal('tax-create'),
    title: z.string(),
    message: z.string(),
    taxRate: z.number(),
    capability: z.string()
  }),
  execute: async ({ inputData, resumeData, suspend }) => {
    if (
      inputData.decision !== 'continue' ||
      inputData.taxId ||
      !inputData.accountId ||
      !inputData.currencyId
    )
      return inputData
    const intelligence = inputData.intelligence
    if (!intelligence) throw new Error('Ledger Intelligence did not return accounting context')
    if (!intelligence.tax.createRecommended || intelligence.account.reviewRecommended) {
      return inputData
    }
    if (!mayWriteBill(inputData.bill)) return inputData

    if (!inputData.taxPermission && resumeData === undefined) {
      return suspend({
        type: 'tax-create',
        title: `Create ${inputData.taxRate}% purchase tax?`,
        message: `Ledger could not find a ${inputData.taxRate}% purchase tax in Odoo. Permission is required before creating accounting configuration.`,
        taxRate: inputData.taxRate,
        capability: 'odoo.tax.create'
      })
    }

    if (!inputData.taxPermission && resumeData?.approved === false) {
      return {
        ...inputData,
        decision: 'declined' as const,
        declinedReason: `Permission to create the missing ${inputData.taxRate}% purchase tax was declined.`
      }
    }

    if (resumeData?.remember) {
      await appStore.grantPermission('odoo.tax.create', `purchase:${inputData.taxRate}`)
    }
    return {
      ...inputData,
      taxPermission: true,
      checks: [
        ...inputData.checks,
        `Tax creation authorized; ${inputData.taxRate}% purchase tax will be created after all approval gates pass`
      ]
    }
  }
})

const applyConfigurationStep = createStep({
  id: 'apply-approved-configuration',
  description: 'Create approved missing Odoo configuration only after every approval gate passes.',
  inputSchema: authorizedBillSchema,
  outputSchema: authorizedBillSchema,
  execute: async ({ inputData }) => {
    if (inputData.decision !== 'continue') return inputData
    const intelligence = inputData.intelligence
    if (!intelligence) throw new Error('Ledger Intelligence did not return accounting context')

    const needsPartner = !inputData.partnerId
    const needsTax = !inputData.taxId && intelligence.tax.createRecommended
    const taxName = `Purchase Tax ${inputData.taxRate}%`
    if (!mayWriteBill(inputData.bill)) {
      return {
        ...inputData,
        partnerId: needsPartner ? -1 : inputData.partnerId,
        taxId: needsTax ? -1 : inputData.taxId,
        taxName: needsTax ? taxName : inputData.taxName,
        checks: [
          ...inputData.checks,
          ...(needsPartner
            ? [
                `Planned vendor partner ${inputData.partnerName}; no partner was written in dry-run mode`
              ]
            : []),
          ...(needsTax ? [`Planned ${taxName}; no tax was written in dry-run mode`] : [])
        ]
      }
    }

    if (needsPartner && !inputData.partnerPermission) {
      throw new Error('Ledger cannot create the missing vendor without permission')
    }
    if (needsTax && !inputData.taxPermission) {
      throw new Error('Ledger cannot create the missing purchase tax without permission')
    }

    const gateway = odooGadget.getGateway()
    let partnerId = inputData.partnerId
    let taxId = inputData.taxId
    const checks = [...inputData.checks]
    if (needsPartner) {
      partnerId = await gateway.create('res.partner', {
        name: inputData.partnerName,
        supplier_rank: 1,
        company_type: 'company'
      })
      checks.push(`Created vendor partner ${inputData.partnerName} (${partnerId})`)
    }
    if (needsTax) {
      taxId = await gateway.create('account.tax', {
        name: taxName,
        amount: inputData.taxRate,
        amount_type: 'percent',
        type_tax_use: 'purchase',
        active: true
      })
      checks.push(`Created ${taxName} (${taxId})`)
    }
    return {
      ...inputData,
      partnerId,
      taxId,
      taxName: needsTax ? taxName : inputData.taxName,
      checks
    }
  }
})

const createDraftStep = createStep({
  id: 'create-draft-bill',
  description: 'Prepare or create the Odoo draft vendor bill after all checks and permissions.',
  inputSchema: authorizedBillSchema,
  outputSchema: ledgerResultSchema,
  execute: async ({ inputData }) => {
    if (inputData.decision === 'duplicate') {
      return {
        outcome: 'duplicate' as const,
        message: `Ledger stopped because ${inputData.bill.invoiceNumber} already exists in Odoo.`,
        intelligence: inputData.intelligence,
        checks: inputData.checks
      }
    }
    if (inputData.decision === 'declined') {
      return {
        outcome: 'declined' as const,
        message: `Ledger stopped. ${inputData.declinedReason ?? 'A required permission was declined.'}`,
        intelligence: inputData.intelligence,
        checks: inputData.checks
      }
    }
    const intelligence = inputData.intelligence
    if (!intelligence) throw new Error('Ledger Intelligence did not return accounting context')
    const taxNeedsReview = intelligence.tax.reviewRecommended && !intelligence.tax.createRecommended
    const intelligenceNeedsReview =
      !inputData.currencyId ||
      !inputData.accountId ||
      intelligence.account.reviewRecommended ||
      taxNeedsReview
    if (intelligenceNeedsReview) {
      return {
        outcome: 'needs-review' as const,
        message: !inputData.currencyId
          ? `Currency ${inputData.bill.currency} is not active in Odoo. No records were written.`
          : !inputData.accountId
            ? 'Ledger Intelligence could not select a valid account from the Odoo candidates. No records were written.'
            : 'Ledger Intelligence found accounting ambiguity. No records were written; review the AI recommendation and available Odoo configuration.',
        partnerId: inputData.partnerId,
        taxId: inputData.taxId,
        accountId: inputData.accountId,
        currencyId: inputData.currencyId,
        intelligence,
        checks: inputData.checks
      }
    }
    if (!inputData.partnerId) throw new Error('Ledger cannot create a bill without a partner')

    const draft: Record<string, unknown> = {
      move_type: 'in_invoice',
      partner_id: inputData.partnerId,
      currency_id: inputData.currencyId,
      invoice_date: inputData.bill.invoiceDate,
      ref: inputData.bill.invoiceNumber,
      invoice_line_ids: [
        [
          0,
          0,
          {
            name: inputData.bill.description,
            quantity: 1,
            price_unit: inputData.bill.untaxedAmount,
            account_id: inputData.accountId,
            ...(inputData.taxId ? { tax_ids: [[6, 0, [inputData.taxId]]] } : {})
          }
        ]
      ]
    }

    const status = odooGadget.getStatus()
    const mayWrite = inputData.bill.confirmWrite && (status.mode === 'demo' || status.liveWrites)
    if (!mayWrite) {
      return {
        outcome: 'dry-run' as const,
        message:
          status.mode === 'live' && !status.liveWrites
            ? 'Ledger prepared the draft, but live Odoo writes are disabled in the Gadget.'
            : 'Ledger prepared a dry-run. Confirm draft creation to write it.',
        partnerId: inputData.partnerId,
        taxId: inputData.taxId,
        accountId: inputData.accountId,
        currencyId: inputData.currencyId,
        intelligence,
        checks: inputData.checks,
        draft
      }
    }

    const gateway = odooGadget.getGateway()
    let moveId: number
    let writeRecovery: z.infer<typeof writeRecoveryIntelligenceSchema> | undefined
    try {
      moveId = await gateway.create('account.move', draft)
    } catch (error) {
      const originalError = error instanceof Error ? error.message : 'Odoo draft creation failed'
      const [fieldMetadata, journals, currencies, companies] = await Promise.all([
        gateway.fieldsGet('account.move').catch(() => ({})),
        gateway
          .searchRead('account.journal', [['type', '=', 'purchase']], ['name', 'code', 'type'], 20)
          .catch(() => []),
        gateway
          .searchRead(
            'res.currency',
            [['name', '=', inputData.bill.currency]],
            ['name', 'symbol', 'active'],
            10
          )
          .catch(() => []),
        gateway.searchRead('res.company', [], ['name'], 20).catch(() => [])
      ])
      const requiredFields = Object.entries(fieldMetadata)
        .filter(([, metadata]) =>
          Boolean(
            metadata && typeof metadata === 'object' && 'required' in metadata && metadata.required
          )
        )
        .map(([name, metadata]) => ({
          name,
          label:
            metadata && typeof metadata === 'object' && 'string' in metadata
              ? String(metadata.string)
              : name,
          type:
            metadata && typeof metadata === 'object' && 'type' in metadata
              ? String(metadata.type)
              : 'unknown'
        }))
      writeRecovery = await diagnoseWriteFailure({
        error: originalError,
        draft,
        requiredFields,
        journals,
        currencies,
        companies
      })

      if (writeRecovery.action !== 'retry') {
        return {
          outcome: 'needs-review' as const,
          message: `Odoo rejected the draft. Ledger Intelligence recommends human review: ${writeRecovery.rationale}`,
          partnerId: inputData.partnerId,
          taxId: inputData.taxId,
          accountId: inputData.accountId,
          currencyId: inputData.currencyId,
          intelligence,
          writeRecovery,
          checks: [...inputData.checks, `Odoo create failed: ${originalError}`],
          draft
        }
      }

      const retryDraft = {
        ...draft,
        ...(writeRecovery.patch.journalId ? { journal_id: writeRecovery.patch.journalId } : {}),
        ...(writeRecovery.patch.currencyId ? { currency_id: writeRecovery.patch.currencyId } : {}),
        ...(writeRecovery.patch.companyId ? { company_id: writeRecovery.patch.companyId } : {})
      }
      writeRecovery = { ...writeRecovery, attemptedRetry: true }
      try {
        moveId = await gateway.create('account.move', retryDraft)
        draft.journal_id = retryDraft.journal_id
        draft.currency_id = retryDraft.currency_id
        draft.company_id = retryDraft.company_id
        writeRecovery = { ...writeRecovery, retrySucceeded: true }
      } catch (retryError) {
        const retryMessage =
          retryError instanceof Error ? retryError.message : 'The AI-guided retry failed'
        writeRecovery = {
          ...writeRecovery,
          retrySucceeded: false,
          warnings: [...writeRecovery.warnings, `Retry failed: ${retryMessage}`]
        }
        return {
          outcome: 'needs-review' as const,
          message: `Odoo rejected the draft after one safe AI-guided retry: ${retryMessage}`,
          partnerId: inputData.partnerId,
          taxId: inputData.taxId,
          accountId: inputData.accountId,
          currencyId: inputData.currencyId,
          intelligence,
          writeRecovery,
          checks: [...inputData.checks, `Odoo create failed: ${originalError}`],
          draft: retryDraft
        }
      }
    }

    const verification = await gateway.read(
      'account.move',
      [moveId],
      ['name', 'ref', 'state', 'partner_id', 'currency_id']
    )

    return {
      outcome: 'created' as const,
      message: `Ledger created draft vendor bill ${moveId} and read it back from Odoo.`,
      moveId,
      partnerId: inputData.partnerId,
      taxId: inputData.taxId,
      accountId: inputData.accountId,
      currencyId: inputData.currencyId,
      intelligence,
      writeRecovery,
      checks: [
        ...inputData.checks,
        `Verified draft ${moveId}: ${JSON.stringify(verification[0] ?? {})}`
      ],
      draft
    }
  }
})

export const ledgerVendorBillWorkflow = createWorkflow({
  id: 'ledger-vendor-bill',
  description:
    'Ledger checks and prepares an Odoo vendor bill with durable partner and tax creation approvals.',
  inputSchema: ledgerBillInputSchema,
  outputSchema: ledgerResultSchema
})
  .then(intakeStep)
  .then(reconcileStep)
  .then(authorizePartnerStep)
  .then(authorizeTaxStep)
  .then(applyConfigurationStep)
  .then(createDraftStep)
  .commit()

export type LedgerWorkflowResult = z.infer<typeof ledgerResultSchema>
