import { createHash } from 'node:crypto'
import type { AccountsPayableBillFact } from '../../domain/schemas'
import { odooGadget, odooGadgetReady } from '../../gadgets/odoo-gateway'

const billFieldsWanted = [
  'name',
  'ref',
  'move_type',
  'partner_id',
  'invoice_date',
  'create_date',
  'write_date',
  'state',
  'payment_state',
  'currency_id',
  'amount_untaxed',
  'amount_total'
]
const partnerFieldsWanted = [
  'name',
  'vat',
  'bank_ids',
  'email',
  'create_date',
  'write_date',
  'supplier_rank'
]
const bankFieldsWanted = ['partner_id', 'acc_number', 'sanitized_acc_number']
const lineFieldsWanted = [
  'move_id',
  'name',
  'quantity',
  'price_unit',
  'price_subtotal',
  'account_id',
  'display_type'
]

type OdooRecord = Record<string, unknown> & { id: number }

export interface AccountsPayablePartnerFact {
  id: number
  name: string
  email?: string
  taxIdFingerprint?: string
  bankFingerprints: string[]
  createdAt?: string
  updatedAt?: string
}

export interface AccountsPayableContext {
  bills: AccountsPayableBillFact[]
  partners: AccountsPayablePartnerFact[]
  warnings: string[]
}

export const availableOdooFields = async (model: string, wanted: string[]): Promise<string[]> => {
  const schema = await odooGadget.getGateway().fieldsGet(model, wanted)
  return wanted.filter((field) => field in schema)
}

export const relationId = (value: unknown): number | undefined =>
  Array.isArray(value) && typeof value[0] === 'number'
    ? value[0]
    : typeof value === 'number' && Number.isInteger(value)
      ? value
      : undefined

export const relationName = (value: unknown): string | undefined =>
  Array.isArray(value) && typeof value[1] === 'string'
    ? value[1]
    : typeof value === 'string' && value.trim()
      ? value.trim()
      : undefined

export const relationIds = (value: unknown): number[] => {
  if (!Array.isArray(value)) return []
  if (typeof value[0] === 'number' && typeof value[1] === 'string') return [value[0]]
  return value.filter((candidate): candidate is number => Number.isInteger(candidate))
}

export const stringValue = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined

export const numberValue = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

export const normalizeOdooDate = (value: unknown): string | undefined => {
  const text = stringValue(value)
  if (!text) return undefined
  const parsed = new Date(
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text) ? `${text.replace(' ', 'T')}Z` : text
  )
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString()
}

const fingerprint = (value: unknown): string | undefined => {
  const normalized = stringValue(value)
    ?.replace(/[^a-z0-9]/gi, '')
    .toLocaleUpperCase()
  return normalized ? createHash('sha256').update(normalized).digest('hex').slice(0, 16) : undefined
}

const recordTimestamp = (record: OdooRecord): string | undefined =>
  normalizeOdooDate(record.write_date) ??
  normalizeOdooDate(record.create_date) ??
  normalizeOdooDate(record.invoice_date)

export const readAccountsPayableContext = async ({
  limit,
  lookbackDays,
  now = new Date()
}: {
  limit: number
  lookbackDays: number
  now?: Date
}): Promise<AccountsPayableContext> => {
  await odooGadgetReady
  const gateway = odooGadget.getGateway()
  const warnings: string[] = []
  const billFields = await availableOdooFields('account.move', billFieldsWanted)
  if (!billFields.includes('move_type')) {
    throw new Error(
      'Odoo did not expose account.move.move_type, so bills and credit notes cannot be compared safely.'
    )
  }
  const billDomain: Array<[string, string, unknown]> = []
  billDomain.push(['move_type', 'in', ['in_invoice', 'in_refund']])
  if (billFields.includes('state')) billDomain.push(['state', '!=', 'cancel'])
  const rawBills = await gateway.searchRead('account.move', billDomain, billFields, 250)
  const cutoff = now.getTime() - lookbackDays * 86_400_000
  const recentBills = rawBills
    .filter((bill) => {
      const timestamp = recordTimestamp(bill)
      return !timestamp || new Date(timestamp).getTime() >= cutoff
    })
    .sort((left, right) =>
      (recordTimestamp(right) ?? '').localeCompare(recordTimestamp(left) ?? '')
    )
    .slice(0, limit)
  if (recentBills.length === 0) return { bills: [], partners: [], warnings }

  const partnerIds = [
    ...new Set(
      recentBills
        .map((bill) => relationId(bill.partner_id))
        .filter((id): id is number => Boolean(id))
    )
  ]
  const partnerFields = await availableOdooFields('res.partner', partnerFieldsWanted)
  const rawPartners =
    partnerIds.length > 0 ? await gateway.read('res.partner', partnerIds, partnerFields) : []
  const bankIds = [...new Set(rawPartners.flatMap((partner) => relationIds(partner.bank_ids)))]
  let rawBanks: OdooRecord[] = []
  if (bankIds.length > 0) {
    try {
      const bankFields = await availableOdooFields('res.partner.bank', bankFieldsWanted)
      rawBanks = await gateway.read('res.partner.bank', bankIds, bankFields)
    } catch {
      warnings.push('Odoo did not allow access to vendor bank identity data for this scan.')
    }
  }

  const bankFingerprintsByPartner = new Map<number, string[]>()
  for (const bank of rawBanks) {
    const partnerId = relationId(bank.partner_id)
    const bankFingerprint = fingerprint(bank.sanitized_acc_number ?? bank.acc_number)
    if (!partnerId || !bankFingerprint) continue
    const current = bankFingerprintsByPartner.get(partnerId) ?? []
    if (!current.includes(bankFingerprint)) current.push(bankFingerprint)
    bankFingerprintsByPartner.set(partnerId, current)
  }

  const partners: AccountsPayablePartnerFact[] = rawPartners.map((partner) => ({
    id: partner.id,
    name: stringValue(partner.name) ?? `Vendor ${partner.id}`,
    email: stringValue(partner.email),
    taxIdFingerprint: fingerprint(partner.vat),
    bankFingerprints: bankFingerprintsByPartner.get(partner.id) ?? [],
    createdAt: normalizeOdooDate(partner.create_date),
    updatedAt: normalizeOdooDate(partner.write_date)
  }))
  const partnerById = new Map(partners.map((partner) => [partner.id, partner]))

  const billIds = recentBills.map((bill) => bill.id)
  const lineFields = await availableOdooFields('account.move.line', lineFieldsWanted)
  const rawLines = await gateway.searchRead(
    'account.move.line',
    [['move_id', 'in', billIds]],
    lineFields,
    Math.min(1_000, Math.max(100, billIds.length * 20))
  )

  const bills: AccountsPayableBillFact[] = recentBills.flatMap((bill) => {
    const partnerId = relationId(bill.partner_id)
    const amountTotal = numberValue(bill.amount_total)
    const moveType = stringValue(bill.move_type)
    if (
      !partnerId ||
      amountTotal === undefined ||
      (moveType !== 'in_invoice' && moveType !== 'in_refund')
    ) {
      return []
    }
    const partner = partnerById.get(partnerId)
    const lines = rawLines
      .filter((line) => relationId(line.move_id) === bill.id)
      .filter(
        (line) => !['line_section', 'line_note'].includes(stringValue(line.display_type) ?? '')
      )
      .slice(0, 50)
      .map((line) => ({
        id: line.id,
        description: stringValue(line.name),
        quantity: numberValue(line.quantity),
        unitPrice: numberValue(line.price_unit),
        subtotal: numberValue(line.price_subtotal),
        account: relationName(line.account_id)
      }))
    return [
      {
        id: bill.id,
        number: stringValue(bill.name) ?? `Bill ${bill.id}`,
        reference: stringValue(bill.ref),
        moveType,
        partnerId,
        partnerName: partner?.name ?? relationName(bill.partner_id) ?? `Vendor ${partnerId}`,
        taxIdFingerprint: partner?.taxIdFingerprint,
        bankFingerprints: partner?.bankFingerprints ?? [],
        invoiceDate: stringValue(bill.invoice_date),
        createdAt: normalizeOdooDate(bill.create_date),
        updatedAt: normalizeOdooDate(bill.write_date),
        state: stringValue(bill.state) ?? 'unknown',
        paymentState: stringValue(bill.payment_state),
        currency: relationName(bill.currency_id),
        amountUntaxed: numberValue(bill.amount_untaxed),
        amountTotal,
        lines
      }
    ]
  })

  return { bills, partners, warnings }
}
