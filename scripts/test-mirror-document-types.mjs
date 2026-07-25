import { strict as assert } from 'node:assert'
import { areDuplicateComparableDocuments } from '../src/mastra/sydekyks/mirror/document-compatibility.ts'

const vendorBill = { id: 15, moveType: 'in_invoice' }
const secondVendorBill = { id: 16, moveType: 'in_invoice' }
const vendorCreditNote = { id: 21, moveType: 'in_refund' }
const secondVendorCreditNote = { id: 22, moveType: 'in_refund' }

assert.equal(
  areDuplicateComparableDocuments(vendorBill, secondVendorBill),
  true,
  'Two vendor bills should remain eligible for duplicate screening'
)
assert.equal(
  areDuplicateComparableDocuments(vendorCreditNote, secondVendorCreditNote),
  true,
  'Two vendor credit notes should remain eligible for duplicate screening'
)
assert.equal(
  areDuplicateComparableDocuments(vendorBill, vendorCreditNote),
  false,
  'A vendor bill and vendor credit note must never be duplicate candidates'
)

console.log('Mirror document-type checks passed: bills and credit notes stay in separate pools.')
