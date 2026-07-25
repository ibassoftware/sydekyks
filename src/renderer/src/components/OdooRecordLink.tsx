import type { OdooPublicStatus } from '../../../shared/ipc'
import type { OdooRecordRef } from '../lib/odoo-links'
import { odooRecordUrl } from '../lib/odoo-links'
import { Icon } from './Icon'

export function OdooRecordLink({
  gadget,
  record,
  label
}: {
  gadget: OdooPublicStatus
  record: OdooRecordRef
  label?: string
}): React.JSX.Element {
  const text = label ?? `${record.label} #${record.id}`
  const href = odooRecordUrl(gadget, record.model, record.id)

  if (!href) {
    return (
      <span className="odoo-record-link unavailable" title="Connect live Odoo to open this record">
        <Icon name="database" size={14} />
        {text}
      </span>
    )
  }

  return (
    <a
      aria-label={`${text} — open in Odoo`}
      className="odoo-record-link"
      href={href}
      rel="noreferrer"
      target="_blank"
    >
      <Icon name="database" size={14} />
      {text}
      <Icon name="external" size={12} />
    </a>
  )
}
