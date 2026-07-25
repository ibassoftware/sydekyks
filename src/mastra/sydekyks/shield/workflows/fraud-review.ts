import { createStep, createWorkflow } from '@mastra/core/workflows'
import { z } from 'zod'
import {
  accountsPayableBillFactSchema,
  shieldResultSchema,
  shieldScanInputSchema,
  shieldVendorChangeFactSchema
} from '../../../domain/schemas'
import { readAccountsPayableContext } from '../../shared/accounts-payable-facts'
import { assessAndBriefFraudRisk } from '../intelligence-service'
import { readVendorMasterChanges } from '../tools/vendor-master-changes'

const shieldContextSchema = z.object({
  request: shieldScanInputSchema,
  bills: z.array(accountsPayableBillFactSchema),
  changes: z.array(shieldVendorChangeFactSchema),
  warnings: z.array(z.string())
})

const validateRequest = createStep({
  id: 'validate-shield-request',
  description: 'Validate the fraud-risk review scope and trigger source.',
  inputSchema: shieldScanInputSchema,
  outputSchema: shieldScanInputSchema,
  execute: async ({ inputData }) => inputData
})

const watch = createStep({
  id: 'watch-bills-and-vendor-master',
  description: 'Watch bounded vendor bills, invoice lines, identities, and vendor-master changes.',
  inputSchema: shieldScanInputSchema,
  outputSchema: shieldContextSchema,
  execute: async ({ inputData }) => {
    const accountsPayable = await readAccountsPayableContext(inputData)
    const vendorMaster = await readVendorMasterChanges(
      accountsPayable.partners,
      inputData.lookbackDays
    )
    return {
      request: inputData,
      bills: accountsPayable.bills,
      changes: vendorMaster.changes,
      warnings: [...accountsPayable.warnings, ...vendorMaster.warnings]
    }
  }
})

const assessRankAndBrief = createStep({
  id: 'assess-rank-and-brief',
  description: 'Assess every bill with AI, rank model scores, and synthesize an auditor brief.',
  inputSchema: shieldContextSchema,
  outputSchema: shieldResultSchema,
  execute: async ({ inputData }) => {
    if (inputData.bills.length === 0) {
      return {
        outcome: 'no-bills' as const,
        message: 'Shield found no vendor bills in the selected watch window.',
        totalBills: 0,
        reviewCount: 0,
        phases: [
          {
            id: 'watch' as const,
            label: 'Watch' as const,
            status: 'completed' as const,
            summary: 'No vendor bills entered the bounded watch window.'
          },
          {
            id: 'assess' as const,
            label: 'Assess' as const,
            status: 'completed' as const,
            summary: 'There were no bills for AI risk assessment.'
          },
          {
            id: 'rank' as const,
            label: 'Rank' as const,
            status: 'completed' as const,
            summary: 'The review queue is empty.'
          },
          {
            id: 'brief' as const,
            label: 'Brief' as const,
            status: 'completed' as const,
            summary: 'No auditor alert was required.'
          }
        ]
      }
    }
    const intelligence = await assessAndBriefFraudRisk(
      inputData.bills,
      inputData.changes,
      inputData.warnings
    )
    const reviewCount = intelligence.assessment.bills.filter(
      (bill) => bill.reviewRecommended
    ).length
    return {
      outcome: 'completed' as const,
      message:
        reviewCount === 0
          ? `Shield assessed ${inputData.bills.length} bills and prepared a clear review brief.`
          : `Shield assessed ${inputData.bills.length} bills and ranked ${reviewCount} for auditor review.`,
      totalBills: inputData.bills.length,
      reviewCount,
      phases: [
        {
          id: 'watch' as const,
          label: 'Watch' as const,
          status: 'completed' as const,
          summary: `Read ${inputData.bills.length} bills and ${inputData.changes.length} vendor-master change signals.`
        },
        {
          id: 'assess' as const,
          label: 'Assess' as const,
          status: 'completed' as const,
          summary: `AI assessed every bill with ${inputData.warnings.length} context warning${inputData.warnings.length === 1 ? '' : 's'}.`
        },
        {
          id: 'rank' as const,
          label: 'Rank' as const,
          status: 'completed' as const,
          summary: `Ordered the AI-scored queue; ${reviewCount} bill${reviewCount === 1 ? '' : 's'} need review.`
        },
        {
          id: 'brief' as const,
          label: 'Brief' as const,
          status: 'completed' as const,
          summary: intelligence.brief.headline
        }
      ],
      assessment: intelligence.assessment,
      brief: intelligence.brief
    }
  }
})

export const shieldFraudReviewWorkflow = createWorkflow({
  id: 'shield-fraud-review',
  inputSchema: shieldScanInputSchema,
  outputSchema: shieldResultSchema
})
  .then(validateRequest)
  .then(watch)
  .then(assessRankAndBrief)
  .commit()
