import type { OdooPublicStatus } from '../../../shared/ipc'
import { isValidOdooModelName } from '../../../shared/odoo-read-policy'

export interface OdooRecordRef {
  id: number
  model: string
  label: string
}

const recordKeys: Record<string, { model: string; label: string }> = {
  moveId: { model: 'account.move', label: 'Odoo bill' },
  billId: { model: 'account.move', label: 'Odoo bill' },
  opportunityId: { model: 'crm.lead', label: 'Opportunity' },
  partnerId: { model: 'res.partner', label: 'Vendor' },
  taxId: { model: 'account.tax', label: 'Tax' },
  accountId: { model: 'account.account', label: 'Account' },
  currencyId: { model: 'res.currency', label: 'Currency' },
  journalId: { model: 'account.journal', label: 'Journal' }
}

const arrayRecordKeys: Record<string, { model: string; label: string }> = {
  billIds: { model: 'account.move', label: 'Odoo bill' },
  opportunityIds: { model: 'crm.lead', label: 'Opportunity' }
}

export const odooRecordUrl = (
  gadget: OdooPublicStatus,
  model: string,
  id: number
): string | undefined => {
  if (gadget.mode !== 'live' || !gadget.url || !Number.isInteger(id) || id <= 0) return undefined
  try {
    const url = new URL('/web', gadget.url)
    if (gadget.database) url.searchParams.set('db', gadget.database)
    url.hash = new URLSearchParams({ id: String(id), model, view_type: 'form' }).toString()
    return url.toString()
  } catch {
    return undefined
  }
}

export const odooRecordRefsFromOutput = (value: unknown): OdooRecordRef[] => {
  const records = new Map<string, OdooRecordRef>()
  const visited = new WeakSet<object>()

  const add = (definition: { model: string; label: string }, id: unknown): void => {
    if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) return
    const key = `${definition.model}:${id}`
    records.set(key, { ...definition, id })
  }

  const visit = (item: unknown, depth: number): void => {
    if (!item || typeof item !== 'object' || depth > 8 || visited.has(item)) return
    visited.add(item)
    if (Array.isArray(item)) {
      item.forEach((child) => visit(child, depth + 1))
      return
    }
    for (const [key, child] of Object.entries(item as Record<string, unknown>)) {
      if (key === 'odooRecords' && Array.isArray(child)) {
        child.forEach((candidate) => {
          if (!candidate || typeof candidate !== 'object') return
          const record = candidate as Record<string, unknown>
          if (
            typeof record.model === 'string' &&
            isValidOdooModelName(record.model) &&
            typeof record.label === 'string'
          ) {
            add({ model: record.model, label: record.label }, record.id)
          }
        })
      }
      const definition = recordKeys[key]
      if (definition) add(definition, child)
      const arrayDefinition = arrayRecordKeys[key]
      if (arrayDefinition && Array.isArray(child)) child.forEach((id) => add(arrayDefinition, id))
      visit(child, depth + 1)
    }
  }

  visit(value, 0)
  return [...records.values()]
}
