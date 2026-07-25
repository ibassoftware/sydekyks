import { useMemo, useState } from 'react'
import type { OdooPublicStatus } from '../../../shared/ipc'
import { acknowledgeMissionNotifications, decideLedgerApproval } from '../lib/api'
import { friendlyError } from '../lib/errors'
import { odooRecordRefsFromOutput } from '../lib/odoo-links'
import type { Automation, InboundEmail, Mission } from '../lib/types'
import { Icon } from '../components/Icon'
import { StatusBadge } from '../components/StatusBadge'
import { LedgerDocumentReviewCard } from '../components/LedgerDocumentReviewCard'
import { OdooRecordLink } from '../components/OdooRecordLink'
import { AutomationsPanel } from './AutomationsPanel'

const approvalPayload = (mission: Mission): Record<string, unknown> | undefined => {
  const payloads = mission.result?.suspendPayload
  return payloads ? Object.values(payloads)[0] : undefined
}

interface MissionControlProps {
  automations: Automation[]
  gadget: OdooPublicStatus
  emails: InboundEmail[]
  initialTab?: 'activity' | 'automations'
  missions: Mission[]
  onChanged: () => Promise<void>
}

export function MissionControlView({
  automations,
  gadget,
  emails,
  initialTab = 'activity',
  missions,
  onChanged
}: MissionControlProps): React.JSX.Element {
  const [selectedTab, setSelectedTab] = useState<'activity' | 'automations'>(initialTab)
  const [actionId, setActionId] = useState<string>()
  const [error, setError] = useState<string>()
  const inboundEmails = useMemo(
    () => emails.filter((email) => email.sourceType === 'email'),
    [emails]
  )
  const unseen = missions.filter(
    (mission) =>
      ['needs_attention', 'waiting_approval'].includes(mission.status) && !mission.acknowledgedAt
  )
  const active = missions.filter((mission) =>
    ['running', 'waiting_approval'].includes(mission.status)
  ).length
  const completed = missions.filter((mission) => mission.status === 'completed').length
  const attention = missions.filter((mission) => mission.status === 'needs_attention').length

  const decide = async (mission: Mission, approved: boolean, remember: boolean): Promise<void> => {
    setActionId(mission.id)
    setError(undefined)
    try {
      await decideLedgerApproval(mission.id, approved, remember)
      await onChanged()
    } catch (cause) {
      setError(friendlyError(cause, 'The approval could not be recorded.'))
    } finally {
      setActionId(undefined)
    }
  }

  const clearNotifications = async (): Promise<void> => {
    if (unseen.length === 0) return
    setActionId('notifications')
    setError(undefined)
    try {
      await acknowledgeMissionNotifications(unseen.map((mission) => mission.id))
      await onChanged()
    } catch (cause) {
      setError(friendlyError(cause, 'Notifications could not be cleared.'))
    } finally {
      setActionId(undefined)
    }
  }

  return (
    <section
      className="page-view scroll-view mission-control-view"
      aria-labelledby="missions-title"
    >
      <header className="view-header split-header">
        <div>
          <p className="eyebrow">Operations</p>
          <h1 id="missions-title">Mission Control</h1>
          <p>One audit trail for Ledger, Sidekick work, Odoo changes, and automations.</p>
        </div>
        {unseen.length > 0 && (
          <button
            className="secondary-button"
            disabled={actionId === 'notifications'}
            onClick={() => void clearNotifications()}
            type="button"
          >
            <Icon name="check" size={18} />
            Clear {unseen.length} {unseen.length === 1 ? 'notification' : 'notifications'}
          </button>
        )}
      </header>

      <div aria-label="Mission Control sections" className="mission-tabs" role="tablist">
        <button
          aria-selected={selectedTab === 'activity'}
          className={selectedTab === 'activity' ? 'active' : ''}
          onClick={() => setSelectedTab('activity')}
          role="tab"
          type="button"
        >
          Activity
        </button>
        <button
          aria-selected={selectedTab === 'automations'}
          className={selectedTab === 'automations' ? 'active' : ''}
          onClick={() => setSelectedTab('automations')}
          role="tab"
          type="button"
        >
          Automations
          {automations.length > 0 && <span>{automations.length}</span>}
        </button>
      </div>

      {selectedTab === 'automations' ? (
        <AutomationsPanel automations={automations} onChanged={onChanged} />
      ) : (
        <>
          <div className="metric-row" aria-label="Mission summary">
            <div className="metric-card">
              <span>Active</span>
              <strong>{active}</strong>
            </div>
            <div className="metric-card">
              <span>Completed</span>
              <strong>{completed}</strong>
            </div>
            <div className="metric-card">
              <span>Needs attention</span>
              <strong>{attention}</strong>
            </div>
            <div className="metric-card">
              <span>Odoo mode</span>
              <strong>{gadget.mode === 'live' ? 'Live' : 'Demo'}</strong>
            </div>
          </div>

          {error && (
            <div className="inline-alert error" role="alert">
              <Icon name="alert" size={18} />
              {error}
            </div>
          )}

          <section className="mission-section email-inbox" aria-labelledby="email-inbox-title">
            <div className="section-title">
              <div>
                <p className="eyebrow">Sealed Ledger workflow</p>
                <h2 id="email-inbox-title">Inbound bills</h2>
              </div>
              <span>{inboundEmails.length}</span>
            </div>
            {inboundEmails.length === 0 ? (
              <div className="empty-surface">
                <Icon name="mail" size={24} />
                <h3>No inbound bills</h3>
                <p>Connect IMAP or send a bill document to Syd.</p>
              </div>
            ) : (
              <div className="email-review-list">
                {inboundEmails.slice(0, 10).map((email) => (
                  <LedgerDocumentReviewCard
                    collapseContext
                    document={email}
                    key={`${email.id}-${email.updatedAt}`}
                    onChanged={onChanged}
                  />
                ))}
              </div>
            )}
          </section>

          <section className="mission-section" aria-labelledby="activity-title">
            <div className="section-title">
              <div>
                <p className="eyebrow">Local audit trail</p>
                <h2 id="activity-title">Recent activity</h2>
              </div>
              <span>{missions.length}</span>
            </div>
            {missions.length === 0 ? (
              <div className="empty-surface">
                <Icon name="bolt" size={24} />
                <h3>No missions yet</h3>
                <p>Ask Syd to review or change something in your connected business systems.</p>
              </div>
            ) : (
              <div className="mission-list">
                {missions.map((mission) => {
                  const payload = approvalPayload(mission)
                  const records = odooRecordRefsFromOutput(mission.result)
                  return (
                    <article className={`mission-card ${mission.status}`} key={mission.id}>
                      <div className="mission-content">
                        <div className="mission-header">
                          <div>
                            <span className="mission-agent">{mission.sydekyk}</span>
                            <h3>{mission.title}</h3>
                          </div>
                          <StatusBadge status={mission.status} />
                        </div>
                        <p>{friendlyError(mission.summary)}</p>
                        <small>
                          {new Date(mission.updatedAt).toLocaleString(undefined, {
                            dateStyle: 'medium',
                            timeStyle: 'short'
                          })}
                        </small>
                        {records.length > 0 && (
                          <div className="odoo-record-links">
                            {records.map((record) => (
                              <OdooRecordLink
                                gadget={gadget}
                                key={`${record.model}-${record.id}`}
                                record={record}
                              />
                            ))}
                          </div>
                        )}
                        {mission.status === 'waiting_approval' &&
                          mission.kind === 'ledger.vendor-bill' && (
                            <div className="approval-panel">
                              <strong>{String(payload?.title ?? 'Ledger needs approval')}</strong>
                              <p>{String(payload?.message ?? mission.summary)}</p>
                              <div className="approval-actions">
                                <button
                                  className="ghost-button"
                                  disabled={actionId === mission.id}
                                  onClick={() => void decide(mission, false, false)}
                                  type="button"
                                >
                                  Decline
                                </button>
                                <button
                                  className="secondary-button"
                                  disabled={actionId === mission.id}
                                  onClick={() => void decide(mission, true, false)}
                                  type="button"
                                >
                                  Approve once
                                </button>
                                <button
                                  className="primary-button"
                                  disabled={actionId === mission.id}
                                  onClick={() => void decide(mission, true, true)}
                                  type="button"
                                >
                                  Approve and remember
                                </button>
                              </div>
                            </div>
                          )}
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
          </section>
        </>
      )}
    </section>
  )
}
