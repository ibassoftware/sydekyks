import type { Mission } from '../lib/types'
import { Icon, type IconName } from './Icon'

const labels: Record<Mission['status'], string> = {
  running: 'Running',
  needs_attention: 'Needs attention',
  waiting_approval: 'Needs approval',
  completed: 'Completed',
  declined: 'Declined',
  failed: 'Failed'
}

const icons: Record<Mission['status'], IconName> = {
  running: 'refresh',
  needs_attention: 'alert',
  waiting_approval: 'clock',
  completed: 'check',
  declined: 'stop',
  failed: 'alert'
}

export function StatusBadge({ status }: { status: Mission['status'] }): React.JSX.Element {
  return (
    <span className={`status-badge status-${status}`}>
      <Icon name={icons[status]} size={14} />
      {labels[status]}
    </span>
  )
}
