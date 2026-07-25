import { createStep, createWorkflow } from '@mastra/core/workflows'
import { z } from 'zod'
import {
  accountsPayableBillFactSchema,
  mirrorResultSchema,
  mirrorScanInputSchema
} from '../../../domain/schemas'
import { analyzeDuplicateBills } from '../intelligence-service'
import { readAccountsPayableContext } from '../../shared/accounts-payable-facts'

const mirrorContextSchema = z.object({
  request: mirrorScanInputSchema,
  bills: z.array(accountsPayableBillFactSchema),
  warnings: z.array(z.string())
})

const validateRequest = createStep({
  id: 'validate-mirror-request',
  description: 'Validate the duplicate-bill scan scope and trigger source.',
  inputSchema: mirrorScanInputSchema,
  outputSchema: mirrorScanInputSchema,
  execute: async ({ inputData }) => inputData
})

const gatherBillContext = createStep({
  id: 'watch-vendor-bills',
  description: 'Read bounded vendor bills, vendor identities, and invoice lines through Odoo.',
  inputSchema: mirrorScanInputSchema,
  outputSchema: mirrorContextSchema,
  execute: async ({ inputData }) => {
    const context = await readAccountsPayableContext(inputData)
    return { request: inputData, bills: context.bills, warnings: context.warnings }
  }
})

const assessDuplicates = createStep({
  id: 'screen-and-confirm-duplicates',
  description: 'Use Mirror Intelligence to screen candidate pairs and confirm them by line item.',
  inputSchema: mirrorContextSchema,
  outputSchema: mirrorResultSchema,
  execute: async ({ inputData }) => {
    if (inputData.bills.length < 2) {
      return {
        outcome: 'not-enough-bills' as const,
        message: `Mirror found ${inputData.bills.length} vendor bill in the scan window; at least two are needed for comparison.`,
        totalBills: inputData.bills.length,
        candidateCount: 0,
        alertCount: 0
      }
    }
    const intelligence = await analyzeDuplicateBills(inputData.bills, inputData.warnings)
    if (!intelligence.assessment) {
      return {
        outcome: 'no-candidates' as const,
        message: `Mirror used AI to screen ${inputData.bills.length} bills and found no pair that warranted line-item confirmation.`,
        totalBills: inputData.bills.length,
        candidateCount: 0,
        alertCount: 0
      }
    }
    const alertCount = intelligence.assessment.pairs.filter(
      (pair) => pair.verdict !== 'not_duplicate'
    ).length
    return {
      outcome: 'completed' as const,
      message:
        alertCount === 0
          ? `Mirror screened ${inputData.bills.length} bills and rejected all ${intelligence.assessment.pairs.length} candidate pairs after AI line-item review.`
          : `Mirror screened ${inputData.bills.length} bills and flagged ${alertCount} pair${alertCount === 1 ? '' : 's'} for duplicate-payment review.`,
      totalBills: inputData.bills.length,
      candidateCount: intelligence.assessment.pairs.length,
      alertCount,
      assessment: intelligence.assessment
    }
  }
})

export const mirrorDuplicateBillsWorkflow = createWorkflow({
  id: 'mirror-duplicate-bills',
  inputSchema: mirrorScanInputSchema,
  outputSchema: mirrorResultSchema
})
  .then(validateRequest)
  .then(gatherBillContext)
  .then(assessDuplicates)
  .commit()
