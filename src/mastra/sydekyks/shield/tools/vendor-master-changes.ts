import { createHash } from 'node:crypto'
import type { ShieldVendorChangeFact } from '../../../domain/schemas'
import { odooGadget } from '../../../gadgets/odoo-gateway'
import type { AccountsPayablePartnerFact } from '../../shared/accounts-payable-facts'
import {
  availableOdooFields,
  normalizeOdooDate,
  relationId,
  relationIds,
  relationName,
  stringValue
} from '../../shared/accounts-payable-facts'

const messageFieldsWanted = [
  'model',
  'res_id',
  'date',
  'author_id',
  'tracking_value_ids',
  'subject'
]
const trackingFieldsWanted = [
  'field_id',
  'old_value_char',
  'new_value_char',
  'old_value_text',
  'new_value_text',
  'old_value_integer',
  'new_value_integer',
  'old_value_float',
  'new_value_float'
]

const displayValue = (
  record: Record<string, unknown>,
  prefix: 'old' | 'new'
): string | undefined => {
  const value =
    record[`${prefix}_value_char`] ??
    record[`${prefix}_value_text`] ??
    record[`${prefix}_value_integer`] ??
    record[`${prefix}_value_float`]
  if (typeof value === 'number') return String(value)
  return stringValue(value)
}

const sensitiveFieldPattern = /bank|account|iban|routing|swift|bic|tax|vat/i

const valueForModel = (field: string, value: string | undefined): string | undefined => {
  if (!value || !sensitiveFieldPattern.test(field)) return value
  const fingerprint = createHash('sha256')
    .update(value.trim().toLowerCase())
    .digest('hex')
    .slice(0, 16)
  return `opaque fingerprint ${fingerprint}`
}

export const readVendorMasterChanges = async (
  partners: AccountsPayablePartnerFact[],
  lookbackDays: number,
  now = new Date()
): Promise<{ changes: ShieldVendorChangeFact[]; warnings: string[] }> => {
  if (partners.length === 0) return { changes: [], warnings: [] }
  const gateway = odooGadget.getGateway()
  const warnings: string[] = []
  const partnerById = new Map(partners.map((partner) => [partner.id, partner]))
  const cutoff = now.getTime() - lookbackDays * 86_400_000
  let messages: Array<Record<string, unknown> & { id: number }> = []
  try {
    const messageFields = await availableOdooFields('mail.message', messageFieldsWanted)
    messages = await gateway.searchRead(
      'mail.message',
      [
        ['model', '=', 'res.partner'],
        ['res_id', 'in', partners.map((partner) => partner.id)]
      ],
      messageFields,
      250
    )
  } catch {
    warnings.push('Odoo did not expose detailed vendor-master message history.')
  }

  const recentMessages = messages.filter((message) => {
    const changedAt = normalizeOdooDate(message.date)
    return !changedAt || new Date(changedAt).getTime() >= cutoff
  })
  const trackingIds = [
    ...new Set(recentMessages.flatMap((message) => relationIds(message.tracking_value_ids)))
  ]
  let trackingValues: Array<Record<string, unknown> & { id: number }> = []
  if (trackingIds.length > 0) {
    try {
      const trackingFields = await availableOdooFields('mail.tracking.value', trackingFieldsWanted)
      trackingValues = await gateway.read('mail.tracking.value', trackingIds, trackingFields)
    } catch {
      warnings.push('Odoo did not allow detailed vendor-master field-change values.')
    }
  }
  const trackingById = new Map(trackingValues.map((tracking) => [tracking.id, tracking]))
  const detailed = recentMessages.flatMap((message) => {
    const partnerId = relationId(message.res_id)
    const partner = partnerId ? partnerById.get(partnerId) : undefined
    if (!partner) return []
    return relationIds(message.tracking_value_ids).flatMap((trackingId) => {
      const tracking = trackingById.get(trackingId)
      if (!tracking) return []
      const field = relationName(tracking.field_id) ?? 'Vendor field'
      return [
        {
          id: `tracking:${trackingId}`,
          partnerId: partner.id,
          partnerName: partner.name,
          changedAt: normalizeOdooDate(message.date),
          field,
          previousValue: valueForModel(field, displayValue(tracking, 'old')),
          currentValue: valueForModel(field, displayValue(tracking, 'new')),
          author: relationName(message.author_id),
          source: 'tracking' as const
        }
      ]
    })
  })
  const partnersWithDetailedChanges = new Set(detailed.map((change) => change.partnerId))
  const metadata = partners.flatMap((partner) => {
    if (partnersWithDetailedChanges.has(partner.id)) return []
    const changedAt = partner.updatedAt ?? partner.createdAt
    if (!changedAt || new Date(changedAt).getTime() < cutoff) return []
    return [
      {
        id: `partner:${partner.id}:metadata`,
        partnerId: partner.id,
        partnerName: partner.name,
        changedAt,
        field: 'Vendor record metadata',
        currentValue: 'Vendor record was created or updated; field-level tracking was unavailable.',
        source: 'record-metadata' as const
      }
    ]
  })
  return { changes: [...detailed, ...metadata], warnings }
}
