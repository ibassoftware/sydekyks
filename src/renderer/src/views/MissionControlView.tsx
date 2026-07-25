import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { OdooPublicStatus } from '../../../shared/ipc'
import { acknowledgeMissionNotifications, decideLedgerApproval, startLedgerBill } from '../lib/api'
import { friendlyError } from '../lib/errors'
import { odooRecordRefsFromOutput } from '../lib/odoo-links'
import type { Automation, InboundEmail, Mission } from '../lib/types'
import { Icon } from '../components/Icon'
import { StatusBadge } from '../components/StatusBadge'
import { LedgerDocumentReviewCard } from '../components/LedgerDocumentReviewCard'
import { OdooRecordLink } from '../components/OdooRecordLink'
import { Pagination } from '../components/Pagination'
import { AutomationsPanel } from './AutomationsPanel'

interface BillForm {
  vendorName: string
  invoiceNumber: string
  invoiceDate: string
  currency: string
  untaxedAmount: string
  taxAmount: string
  totalAmount: string
  description: string
  accountHint: string
  confirmWrite: boolean
}

interface AccountingIntelligenceView {
  source: 'llm'
  account: { confidence: number; rationale: string; reviewRecommended: boolean }
  tax: { confidence: number; rationale: string; reviewRecommended: boolean }
  observations: string[]
}

interface WriteRecoveryView {
  source: 'llm'
  action: string
  confidence: number
  rationale: string
  attemptedRetry: boolean
  retrySucceeded?: boolean
}

interface NudgeAssessmentView {
  source: 'llm'
  checkedAt: string
  summary: string
  opportunities: Array<{
    opportunityId: number
    opportunityName: string
    stale: boolean
    priority: 'high' | 'medium' | 'low' | 'healthy'
    confidence: number
    staleSince: string | null
    reasons: string[]
    recommendedAction: string
  }>
}

interface MirrorAssessmentView {
  source: 'llm'
  checkedAt: string
  summary: string
  screening: { summary: string; candidateCount: number; warnings: string[] }
  pairs: Array<{
    billIds: [number, number]
    verdict: 'likely_duplicate' | 'possible_duplicate' | 'not_duplicate'
    priority: 'high' | 'medium' | 'low' | 'clear'
    confidence: number
    rationale: string
    evidence: string[]
    recommendedAction: string
    warnings: string[]
  }>
}

interface ShieldResultView {
  phases: Array<{
    id: 'watch' | 'assess' | 'rank' | 'brief'
    label: 'Watch' | 'Assess' | 'Rank' | 'Brief'
    status: 'completed'
    summary: string
  }>
  assessment?: {
    source: 'llm'
    summary: string
    bills: Array<{
      billId: number
      riskScore: number
      riskLevel: 'critical' | 'high' | 'medium' | 'low'
      confidence: number
      reviewRecommended: boolean
      rationale: string
      indicators: Array<{ signal: string; explanation: string; evidenceRecordIds: string[] }>
      mitigatingFactors: string[]
      warnings: string[]
    }>
  }
  brief?: {
    source: 'llm'
    headline: string
    overview: string
    alerts: Array<{
      billId: number
      title: string
      brief: string
      supportingEvidence: string[]
      auditorQuestions: string[]
    }>
  }
}

const today = new Date().toISOString().slice(0, 10)

const blankBill = (): BillForm => ({
  vendorName: 'Acme Supplies',
  invoiceNumber: `ACME-${Date.now().toString().slice(-6)}`,
  invoiceDate: today,
  currency: 'EUR',
  untaxedAmount: '100',
  taxAmount: '12',
  totalAmount: '112',
  description: 'Office supplies',
  accountHint: '',
  confirmWrite: false
})

const approvalPayload = (mission: Mission): Record<string, unknown> | undefined => {
  const payloads = mission.result?.suspendPayload
  return payloads ? Object.values(payloads)[0] : undefined
}

const resultOutput = (mission: Mission): Record<string, unknown> | undefined =>
  mission.result?.result

const activityPageSize = 4
type ActivityPage = 'inbound' | 'shield' | 'mirror' | 'nudge' | 'ledger'

interface MissionControlProps {
  automations: Automation[]
  gadget: OdooPublicStatus
  emails: InboundEmail[]
  initialTab?: 'activity' | 'automations'
  missions: Mission[]
  onChanged: () => Promise<void>
}

function MissionDisclosure({
  children,
  label,
  meta
}: {
  children: ReactNode
  label: string
  meta?: string
}): React.JSX.Element {
  return (
    <details className="mission-disclosure">
      <summary>
        <span>
          <Icon name="document" size={17} />
          {label}
        </span>
        <span className="mission-disclosure-meta">
          {meta}
          <Icon name="chevron-down" size={17} />
        </span>
      </summary>
      <div className="mission-disclosure-content">{children}</div>
    </details>
  )
}

function MissionErrorDetails({ mission }: { mission: Mission }): React.JSX.Element | null {
  if (!['failed', 'needs_attention'].includes(mission.status)) return null
  const diagnostic = mission.result?.diagnostic
  const storedError = mission.result?.error
  if (!diagnostic && !storedError && !mission.runId) return null
  const staleNudgeLabel = storedError
    ?.toLocaleLowerCase()
    .includes('could not produce nudge’s required assessment format')
  const details = diagnostic ?? {
    code: 'RECORDED_FAILURE',
    stage: 'Mission',
    message: staleNudgeLabel
      ? 'The AI response did not match the fields required by this mission.'
      : (storedError ?? mission.summary),
    nextStep:
      'Retry the mission. If it fails again, use the run ID to review the application logs.',
    model: undefined
  }

  return (
    <details className="mission-error-details">
      <summary>
        <span>
          <Icon name="alert" size={16} />
          Error details
        </span>
        <span>
          For operators
          <Icon name="chevron-down" size={16} />
        </span>
      </summary>
      <div className="mission-error-content">
        <dl>
          <div>
            <dt>Stage</dt>
            <dd>{details.stage}</dd>
          </div>
          <div>
            <dt>Error code</dt>
            <dd>{details.code}</dd>
          </div>
          {details.model && (
            <div>
              <dt>AI configuration</dt>
              <dd>{details.model}</dd>
            </div>
          )}
          {mission.runId && (
            <div>
              <dt>Run ID</dt>
              <dd>{mission.runId}</dd>
            </div>
          )}
        </dl>
        <p>{details.message}</p>
        <p>
          <strong>Next step:</strong> {details.nextStep}
        </p>
      </div>
    </details>
  )
}

export function MissionControlView({
  automations,
  gadget,
  emails,
  initialTab = 'activity',
  missions,
  onChanged
}: MissionControlProps): React.JSX.Element {
  const [bill, setBill] = useState<BillForm>(blankBill)
  const [submitting, setSubmitting] = useState(false)
  const [actionId, setActionId] = useState<string>()
  const [error, setError] = useState<string>()
  const [clearingNotifications, setClearingNotifications] = useState(false)
  const [notificationMessage, setNotificationMessage] = useState('')
  const [notificationError, setNotificationError] = useState<string>()
  const [showWorkbench, setShowWorkbench] = useState(false)
  const [selectedTab, setSelectedTab] = useState<'activity' | 'automations'>(initialTab)
  const [activityPages, setActivityPages] = useState<Record<ActivityPage, number>>({
    inbound: 1,
    shield: 1,
    mirror: 1,
    nudge: 1,
    ledger: 1
  })
  const developerWorkbenchAvailable = import.meta.env.DEV
  const ledgerMissions = useMemo(
    () => missions.filter((mission) => mission.kind === 'ledger.vendor-bill'),
    [missions]
  )
  const nudgeMissions = useMemo(
    () => missions.filter((mission) => mission.kind === 'nudge.stale-opportunities'),
    [missions]
  )
  const mirrorMissions = useMemo(
    () => missions.filter((mission) => mission.kind === 'mirror.duplicate-bills'),
    [missions]
  )
  const shieldMissions = useMemo(
    () => missions.filter((mission) => mission.kind === 'shield.fraud-review'),
    [missions]
  )
  const inboundEmails = useMemo(
    () => emails.filter((email) => email.sourceType === 'email'),
    [emails]
  )
  const pageFor = (key: ActivityPage, totalItems: number): number =>
    Math.min(activityPages[key], Math.max(1, Math.ceil(totalItems / activityPageSize)))
  const pageItems = <Item,>(items: Item[], key: ActivityPage): Item[] => {
    const page = pageFor(key, items.length)
    return items.slice((page - 1) * activityPageSize, page * activityPageSize)
  }
  const setActivityPage = (key: ActivityPage, page: number): void => {
    setActivityPages((current) => ({ ...current, [key]: page }))
  }
  const visibleInboundEmails = pageItems(inboundEmails, 'inbound')
  const visibleShieldMissions = pageItems(shieldMissions, 'shield')
  const visibleMirrorMissions = pageItems(mirrorMissions, 'mirror')
  const visibleNudgeMissions = pageItems(nudgeMissions, 'nudge')
  const visibleLedgerMissions = pageItems(ledgerMissions, 'ledger')
  const active = missions.filter((mission) =>
    ['running', 'waiting_approval'].includes(mission.status)
  ).length
  const completed = missions.filter((mission) => mission.status === 'completed').length
  const attention = missions.filter((mission) => mission.status === 'needs_attention').length
  const unseenAttentionMissions = missions.filter(
    (mission) =>
      ['needs_attention', 'waiting_approval'].includes(mission.status) && !mission.acknowledgedAt
  )

  const update = <K extends keyof BillForm>(key: K, value: BillForm[K]): void => {
    setBill((current) => ({ ...current, [key]: value }))
  }

  const loadDemo = (example: 'existing' | 'missing-vendor' | 'missing-tax'): void => {
    const next = blankBill()
    if (example === 'missing-vendor') {
      next.vendorName = 'Wayne Office Goods'
      next.invoiceNumber = `WAYNE-${Date.now().toString().slice(-6)}`
      next.accountHint = 'Office Supplies'
    }
    if (example === 'missing-tax') {
      next.invoiceNumber = `ACME-TAX-${Date.now().toString().slice(-6)}`
      next.taxAmount = '10'
      next.totalAmount = '110'
    }
    setBill(next)
    setError(undefined)
  }

  const submitBill = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    setSubmitting(true)
    setError(undefined)
    try {
      await startLedgerBill({
        ...bill,
        untaxedAmount: Number(bill.untaxedAmount),
        taxAmount: Number(bill.taxAmount),
        totalAmount: Number(bill.totalAmount),
        accountHint: bill.accountHint || undefined
      })
      setBill(blankBill())
      await onChanged()
    } catch (cause) {
      setError(friendlyError(cause, 'Ledger could not start the workflow.'))
    } finally {
      setSubmitting(false)
    }
  }

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
    if (clearingNotifications || unseenAttentionMissions.length === 0) return
    setClearingNotifications(true)
    setNotificationError(undefined)
    setNotificationMessage('')
    try {
      const { acknowledged } = await acknowledgeMissionNotifications(
        unseenAttentionMissions.map((mission) => mission.id)
      )
      setNotificationMessage(
        `${acknowledged} ${acknowledged === 1 ? 'notification' : 'notifications'} cleared. The mission records and any required actions remain available.`
      )
      await onChanged()
    } catch (cause) {
      setNotificationError(
        friendlyError(cause, 'Mission Control could not clear the notifications.')
      )
    } finally {
      setClearingNotifications(false)
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
          <p>See what your Sydekyks did, what is moving, and where you are needed.</p>
        </div>
        <div className="mission-header-actions">
          {unseenAttentionMissions.length > 0 && (
            <button
              aria-busy={clearingNotifications}
              className="secondary-button notification-clear-button"
              disabled={clearingNotifications}
              onClick={() => void clearNotifications()}
              type="button"
            >
              <Icon name={clearingNotifications ? 'refresh' : 'check'} size={18} />
              {clearingNotifications
                ? 'Clearing…'
                : `Clear ${unseenAttentionMissions.length} ${
                    unseenAttentionMissions.length === 1 ? 'notification' : 'notifications'
                  }`}
            </button>
          )}
          {developerWorkbenchAvailable && selectedTab === 'activity' && (
            <button
              className="secondary-button"
              onClick={() => setShowWorkbench((value) => !value)}
              type="button"
            >
              <Icon name="document" size={18} />
              {showWorkbench ? 'Hide workbench' : 'New Ledger mission'}
            </button>
          )}
        </div>
        <p aria-live="polite" className="sr-only">
          {notificationMessage}
        </p>
      </header>

      {notificationError && (
        <div className="inline-alert error mission-notification-alert" role="alert">
          <Icon name="alert" size={18} />
          <span>{notificationError}</span>
        </div>
      )}

      <div
        aria-label="Mission Control sections"
        className="mission-tabs"
        onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
          const tabs = Array.from(
            event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')
          )
          const currentIndex = Math.max(
            0,
            tabs.indexOf(document.activeElement as HTMLButtonElement)
          )
          const nextIndex =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? tabs.length - 1
                : event.key === 'ArrowRight'
                  ? (currentIndex + 1) % tabs.length
                  : (currentIndex - 1 + tabs.length) % tabs.length
          event.preventDefault()
          tabs[nextIndex]?.focus()
          tabs[nextIndex]?.click()
        }}
        role="tablist"
      >
        <button
          aria-selected={selectedTab === 'activity'}
          className={selectedTab === 'activity' ? 'active' : ''}
          onClick={() => setSelectedTab('activity')}
          role="tab"
          tabIndex={selectedTab === 'activity' ? 0 : -1}
          type="button"
        >
          Activity
        </button>
        <button
          aria-selected={selectedTab === 'automations'}
          className={selectedTab === 'automations' ? 'active' : ''}
          onClick={() => setSelectedTab('automations')}
          role="tab"
          tabIndex={selectedTab === 'automations' ? 0 : -1}
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

          <section className="mission-section email-inbox" aria-labelledby="email-inbox-title">
            <div className="section-title">
              <div>
                <p className="eyebrow">Inbound workflow</p>
                <h2 id="email-inbox-title">Inbound bills</h2>
              </div>
              <span>
                {inboundEmails.length} email{inboundEmails.length === 1 ? '' : 's'}
              </span>
            </div>
            {inboundEmails.length === 0 ? (
              <div className="empty-surface">
                <Icon name="mail" size={24} />
                <h3>No inbound bills</h3>
                <p>Connect IMAP or process the sample email from Gadgets.</p>
              </div>
            ) : (
              <>
                <div className="email-review-list">
                  {visibleInboundEmails.map((email) => {
                    const ledgerMission = missions.find(
                      (mission) => mission.id === email.ledgerMissionId
                    )
                    const odooRecords = odooRecordRefsFromOutput(ledgerMission?.result)
                    return (
                      <div className="email-review-entry" key={`${email.id}-${email.updatedAt}`}>
                        <LedgerDocumentReviewCard
                          collapseContext
                          document={email}
                          onChanged={onChanged}
                        />
                        {odooRecords.length > 0 && (
                          <div className="odoo-record-links document-record-links">
                            {odooRecords.map((record) => (
                              <OdooRecordLink
                                gadget={gadget}
                                key={`${record.model}-${record.id}`}
                                record={record}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
                <Pagination
                  label="Inbound bills"
                  onPageChange={(page) => setActivityPage('inbound', page)}
                  page={pageFor('inbound', inboundEmails.length)}
                  pageSize={activityPageSize}
                  totalItems={inboundEmails.length}
                />
              </>
            )}
          </section>

          {developerWorkbenchAvailable && showWorkbench && (
            <section className="surface workbench" aria-labelledby="workbench-title">
              <div className="surface-heading">
                <div className="sydekyk-avatar ledger-avatar">L</div>
                <div>
                  <p className="eyebrow">Ledger workflow</p>
                  <h2 id="workbench-title">Test a vendor bill</h2>
                </div>
                <span className="mode-badge">
                  {gadget.mode === 'live' ? gadget.label : 'Isolated demo data'}
                </span>
              </div>
              <div className="demo-actions" aria-label="Load example bill">
                <button onClick={() => loadDemo('existing')} type="button">
                  Existing vendor example
                </button>
                <button onClick={() => loadDemo('missing-vendor')} type="button">
                  Missing vendor + approval
                </button>
                <button onClick={() => loadDemo('missing-tax')} type="button">
                  Missing tax + approval
                </button>
              </div>
              <form className="form-grid ledger-form" onSubmit={(event) => void submitBill(event)}>
                <label>
                  <span>Vendor name</span>
                  <input
                    required
                    value={bill.vendorName}
                    onChange={(e) => update('vendorName', e.target.value)}
                  />
                </label>
                <label>
                  <span>Invoice number</span>
                  <input
                    required
                    value={bill.invoiceNumber}
                    onChange={(e) => update('invoiceNumber', e.target.value)}
                  />
                </label>
                <label>
                  <span>Invoice date</span>
                  <input
                    required
                    type="date"
                    value={bill.invoiceDate}
                    onChange={(e) => update('invoiceDate', e.target.value)}
                  />
                </label>
                <label>
                  <span>Currency</span>
                  <input
                    maxLength={3}
                    required
                    value={bill.currency}
                    onChange={(e) => update('currency', e.target.value.toUpperCase())}
                  />
                </label>
                <label>
                  <span>Untaxed amount</span>
                  <input
                    min="0"
                    required
                    step="0.01"
                    type="number"
                    value={bill.untaxedAmount}
                    onChange={(e) => update('untaxedAmount', e.target.value)}
                  />
                </label>
                <label>
                  <span>Tax amount</span>
                  <input
                    min="0"
                    required
                    step="0.01"
                    type="number"
                    value={bill.taxAmount}
                    onChange={(e) => update('taxAmount', e.target.value)}
                  />
                </label>
                <label>
                  <span>Total amount</span>
                  <input
                    min="0.01"
                    required
                    step="0.01"
                    type="number"
                    value={bill.totalAmount}
                    onChange={(e) => update('totalAmount', e.target.value)}
                  />
                </label>
                <label>
                  <span>
                    Account hint <small>optional</small>
                  </span>
                  <input
                    value={bill.accountHint}
                    onChange={(e) => update('accountHint', e.target.value)}
                  />
                </label>
                <label className="span-two">
                  <span>Line description</span>
                  <input
                    required
                    value={bill.description}
                    onChange={(e) => update('description', e.target.value)}
                  />
                </label>
                <label className="toggle-field span-two">
                  <input
                    checked={bill.confirmWrite}
                    onChange={(e) => update('confirmWrite', e.target.checked)}
                    type="checkbox"
                  />
                  <span className="toggle-track" aria-hidden="true">
                    <span />
                  </span>
                  <span>
                    <strong>Create the draft</strong>
                    <small>
                      {gadget.mode === 'live'
                        ? 'Requires live writes to be enabled in the Gadget.'
                        : 'Writes only to the isolated demo Odoo.'}
                    </small>
                  </span>
                </label>
                <div className="form-footer span-two">
                  <p>
                    <Icon name="shield" size={16} /> Ledger always checks duplicate, vendor, tax,
                    history, and account title first.
                  </p>
                  <button className="primary-button" disabled={submitting} type="submit">
                    {submitting ? (
                      <Icon name="refresh" size={18} />
                    ) : (
                      <Icon name="bolt" size={18} />
                    )}
                    {submitting ? 'Starting…' : 'Send to Ledger'}
                  </button>
                </div>
              </form>
            </section>
          )}

          {error && (
            <div className="inline-alert error" role="alert">
              <Icon name="alert" size={18} />
              <span>{error}</span>
            </div>
          )}

          <section className="mission-section" aria-labelledby="shield-timeline-title">
            <div className="section-title">
              <div>
                <p className="eyebrow">From signal to sign-off</p>
                <h2 id="shield-timeline-title">Shield activity</h2>
              </div>
              <span>
                {shieldMissions.length} review{shieldMissions.length === 1 ? '' : 's'}
              </span>
            </div>
            {shieldMissions.length === 0 ? (
              <div className="empty-surface">
                <Icon name="shield" size={24} />
                <h3>No AP risk reviews yet</h3>
                <p>Run Shield once or give it a recurring watch in Automations.</p>
              </div>
            ) : (
              <>
                <div className="mission-list">
                  {visibleShieldMissions.map((mission) => {
                    const output = resultOutput(mission) as ShieldResultView | undefined
                    const alertByBillId = new Map(
                      (output?.brief?.alerts ?? []).map((alert) => [alert.billId, alert])
                    )
                    const reviewQueue =
                      output?.assessment?.bills.filter((bill) => bill.reviewRecommended) ?? []
                    return (
                      <article
                        className={`mission-card shield-mission ${mission.status}`}
                        key={mission.id}
                      >
                        <div className="mission-rail">
                          <span />
                          <i />
                        </div>
                        <div className="mission-content">
                          <div className="mission-header">
                            <div>
                              <span className="mission-agent">Shield</span>
                              <h3>{mission.title}</h3>
                            </div>
                            <StatusBadge status={mission.status} />
                          </div>
                          <p>{friendlyError(mission.summary)}</p>
                          {(output?.phases || output?.brief) && (
                            <MissionDisclosure
                              label="View review details"
                              meta={
                                reviewQueue.length > 0
                                  ? `${reviewQueue.length} flagged`
                                  : 'No risks flagged'
                              }
                            >
                              {output?.phases && (
                                <div className="shield-phases" aria-label="Shield workflow phases">
                                  {output.phases.map((phase, index) => (
                                    <article key={phase.id}>
                                      <span>{String(index + 1).padStart(2, '0')}</span>
                                      <div>
                                        <strong>{phase.label}</strong>
                                        <p>{phase.summary}</p>
                                      </div>
                                    </article>
                                  ))}
                                </div>
                              )}
                              {output?.brief && (
                                <div className="specialist-intelligence shield-intelligence">
                                  <div className="nudge-intelligence-heading">
                                    <span className="ai-mark">
                                      <Icon name="sparkles" size={17} />
                                    </span>
                                    <div>
                                      <strong>{output.brief.headline}</strong>
                                      <span>{output.brief.overview}</span>
                                    </div>
                                  </div>
                                  {reviewQueue.length === 0 ? (
                                    <p className="nudge-clear">
                                      <Icon name="check" size={17} /> The AI review queue is clear.
                                    </p>
                                  ) : (
                                    <div className="nudge-findings">
                                      {reviewQueue.map((finding) => {
                                        const alert = alertByBillId.get(finding.billId)
                                        return (
                                          <article
                                            className={`nudge-finding shield-risk ${finding.riskLevel}`}
                                            key={finding.billId}
                                          >
                                            <div>
                                              <strong>
                                                <OdooRecordLink
                                                  gadget={gadget}
                                                  label={
                                                    alert?.title ?? `Odoo bill #${finding.billId}`
                                                  }
                                                  record={{
                                                    id: finding.billId,
                                                    model: 'account.move',
                                                    label: 'Odoo bill'
                                                  }}
                                                />
                                              </strong>
                                              <span>
                                                {finding.riskScore}/100 · {finding.riskLevel}
                                              </span>
                                              <span>
                                                {Math.round(finding.confidence * 100)}% confidence
                                              </span>
                                            </div>
                                            <p>{alert?.brief ?? finding.rationale}</p>
                                            {(alert?.supportingEvidence.length ?? 0) > 0 && (
                                              <ul>
                                                {alert?.supportingEvidence.map((evidence) => (
                                                  <li key={evidence}>{evidence}</li>
                                                ))}
                                              </ul>
                                            )}
                                          </article>
                                        )
                                      })}
                                    </div>
                                  )}
                                </div>
                              )}
                            </MissionDisclosure>
                          )}
                          <MissionErrorDetails mission={mission} />
                          <time dateTime={mission.updatedAt}>
                            {new Date(mission.updatedAt).toLocaleString()}
                          </time>
                        </div>
                      </article>
                    )
                  })}
                </div>
                <Pagination
                  label="Shield activity"
                  onPageChange={(page) => setActivityPage('shield', page)}
                  page={pageFor('shield', shieldMissions.length)}
                  pageSize={activityPageSize}
                  totalItems={shieldMissions.length}
                />
              </>
            )}
          </section>

          <section className="mission-section" aria-labelledby="mirror-timeline-title">
            <div className="section-title">
              <div>
                <p className="eyebrow">Accounts-payable watchdog</p>
                <h2 id="mirror-timeline-title">Mirror activity</h2>
              </div>
              <span>
                {mirrorMissions.length} scan{mirrorMissions.length === 1 ? '' : 's'}
              </span>
            </div>
            {mirrorMissions.length === 0 ? (
              <div className="empty-surface">
                <Icon name="document" size={24} />
                <h3>No duplicate scans yet</h3>
                <p>Run Mirror once or schedule a quiet recurring duplicate watch.</p>
              </div>
            ) : (
              <>
                <div className="mission-list">
                  {visibleMirrorMissions.map((mission) => {
                    const output = resultOutput(mission)
                    const assessment = output?.assessment as MirrorAssessmentView | undefined
                    const findings =
                      assessment?.pairs.filter((pair) => pair.verdict !== 'not_duplicate') ?? []
                    return (
                      <article
                        className={`mission-card mirror-mission ${mission.status}`}
                        key={mission.id}
                      >
                        <div className="mission-rail">
                          <span />
                          <i />
                        </div>
                        <div className="mission-content">
                          <div className="mission-header">
                            <div>
                              <span className="mission-agent">Mirror</span>
                              <h3>{mission.title}</h3>
                            </div>
                            <StatusBadge status={mission.status} />
                          </div>
                          <p>{friendlyError(mission.summary)}</p>
                          {assessment && (
                            <MissionDisclosure
                              label="View duplicate analysis"
                              meta={
                                findings.length > 0
                                  ? `${findings.length} candidate${findings.length === 1 ? '' : 's'}`
                                  : 'No duplicates'
                              }
                            >
                              <div className="specialist-intelligence mirror-intelligence">
                                <div className="nudge-intelligence-heading">
                                  <span className="ai-mark">
                                    <Icon name="sparkles" size={17} />
                                  </span>
                                  <div>
                                    <strong>Mirror Intelligence</strong>
                                    <span>
                                      {assessment.screening.summary} {assessment.summary}
                                    </span>
                                  </div>
                                </div>
                                {findings.length === 0 ? (
                                  <p className="nudge-clear">
                                    <Icon name="check" size={17} /> AI rejected every screened pair
                                    after line-item review.
                                  </p>
                                ) : (
                                  <div className="nudge-findings">
                                    {findings.map((finding) => (
                                      <article
                                        className={`nudge-finding mirror-finding ${finding.priority}`}
                                        key={finding.billIds.join('-')}
                                      >
                                        <div>
                                          <strong className="odoo-inline-records">
                                            <OdooRecordLink
                                              gadget={gadget}
                                              record={{
                                                id: finding.billIds[0],
                                                model: 'account.move',
                                                label: 'Odoo bill'
                                              }}
                                            />
                                            <span>and</span>
                                            <OdooRecordLink
                                              gadget={gadget}
                                              record={{
                                                id: finding.billIds[1],
                                                model: 'account.move',
                                                label: 'Odoo bill'
                                              }}
                                            />
                                          </strong>
                                          <span>{finding.verdict.replaceAll('_', ' ')}</span>
                                          <span>
                                            {Math.round(finding.confidence * 100)}% confidence
                                          </span>
                                        </div>
                                        <p>{finding.rationale}</p>
                                        <ul>
                                          {finding.evidence.map((evidence) => (
                                            <li key={evidence}>{evidence}</li>
                                          ))}
                                        </ul>
                                        <p>
                                          <strong>Suggested:</strong> {finding.recommendedAction}
                                        </p>
                                      </article>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </MissionDisclosure>
                          )}
                          <MissionErrorDetails mission={mission} />
                          <time dateTime={mission.updatedAt}>
                            {new Date(mission.updatedAt).toLocaleString()}
                          </time>
                        </div>
                      </article>
                    )
                  })}
                </div>
                <Pagination
                  label="Mirror activity"
                  onPageChange={(page) => setActivityPage('mirror', page)}
                  page={pageFor('mirror', mirrorMissions.length)}
                  pageSize={activityPageSize}
                  totalItems={mirrorMissions.length}
                />
              </>
            )}
          </section>

          <section className="mission-section" aria-labelledby="nudge-timeline-title">
            <div className="section-title">
              <div>
                <p className="eyebrow">CRM watch</p>
                <h2 id="nudge-timeline-title">Nudge activity</h2>
              </div>
              <span>
                {nudgeMissions.length} check{nudgeMissions.length === 1 ? '' : 's'}
              </span>
            </div>
            {nudgeMissions.length === 0 ? (
              <div className="empty-surface">
                <Icon name="sparkles" size={24} />
                <h3>No pipeline checks yet</h3>
                <p>Open Automations to run Nudge once or create a recurring check.</p>
              </div>
            ) : (
              <>
                <div className="mission-list nudge-mission-list">
                  {visibleNudgeMissions.map((mission) => {
                    const output = resultOutput(mission)
                    const assessment = output?.assessment as NudgeAssessmentView | undefined
                    const findings = assessment?.opportunities.filter((item) => item.stale) ?? []
                    return (
                      <article
                        className={`mission-card nudge-mission ${mission.status}`}
                        key={mission.id}
                      >
                        <div className="mission-rail">
                          <span />
                          <i />
                        </div>
                        <div className="mission-content">
                          <div className="mission-header">
                            <div>
                              <span className="mission-agent">Nudge</span>
                              <h3>{mission.title}</h3>
                            </div>
                            <StatusBadge status={mission.status} />
                          </div>
                          <p>{friendlyError(mission.summary)}</p>
                          {assessment && (
                            <MissionDisclosure
                              label="View pipeline analysis"
                              meta={
                                findings.length > 0
                                  ? `${findings.length} stale`
                                  : 'Nothing needs attention'
                              }
                            >
                              <div className="nudge-intelligence">
                                <div className="nudge-intelligence-heading">
                                  <span className="ai-mark">
                                    <Icon name="sparkles" size={17} />
                                  </span>
                                  <div>
                                    <strong>Nudge Intelligence</strong>
                                    <span>{assessment.summary}</span>
                                  </div>
                                </div>
                                {findings.length === 0 ? (
                                  <p className="nudge-clear">
                                    <Icon name="check" size={17} /> No opportunity needs attention
                                    right now.
                                  </p>
                                ) : (
                                  <div className="nudge-findings">
                                    {findings.map((finding) => (
                                      <article
                                        className={`nudge-finding ${finding.priority}`}
                                        key={finding.opportunityId}
                                      >
                                        <div>
                                          <strong>
                                            <OdooRecordLink
                                              gadget={gadget}
                                              label={finding.opportunityName}
                                              record={{
                                                id: finding.opportunityId,
                                                model: 'crm.lead',
                                                label: 'Opportunity'
                                              }}
                                            />
                                          </strong>
                                          <span>{finding.priority} priority</span>
                                          <span>
                                            {Math.round(finding.confidence * 100)}% confidence
                                          </span>
                                        </div>
                                        <ul>
                                          {finding.reasons.map((reason) => (
                                            <li key={reason}>{reason}</li>
                                          ))}
                                        </ul>
                                        <p>
                                          <strong>Suggested:</strong> {finding.recommendedAction}
                                        </p>
                                      </article>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </MissionDisclosure>
                          )}
                          <MissionErrorDetails mission={mission} />
                          <time dateTime={mission.updatedAt}>
                            {new Date(mission.updatedAt).toLocaleString()}
                          </time>
                        </div>
                      </article>
                    )
                  })}
                </div>
                <Pagination
                  label="Nudge activity"
                  onPageChange={(page) => setActivityPage('nudge', page)}
                  page={pageFor('nudge', nudgeMissions.length)}
                  pageSize={activityPageSize}
                  totalItems={nudgeMissions.length}
                />
              </>
            )}
          </section>

          <section className="mission-section" aria-labelledby="timeline-title">
            <div className="section-title">
              <div>
                <p className="eyebrow">Journal</p>
                <h2 id="timeline-title">Ledger activity</h2>
              </div>
              <span>
                {ledgerMissions.length} mission{ledgerMissions.length === 1 ? '' : 's'}
              </span>
            </div>
            {ledgerMissions.length === 0 ? (
              <div className="empty-surface">
                <Icon name="bolt" size={24} />
                <h3>No missions yet</h3>
                <p>Run an example above to see Ledger’s workflow here.</p>
              </div>
            ) : (
              <>
                <div className="mission-list">
                  {visibleLedgerMissions.map((mission) => {
                    const approval = approvalPayload(mission)
                    const suspendedStep = Object.keys(mission.result?.suspendPayload ?? {})[0]
                    const completedBeforeApproval =
                      suspendedStep === 'authorize-partner'
                        ? 2
                        : suspendedStep === 'authorize-tax'
                          ? 3
                          : 0
                    const output = resultOutput(mission)
                    const checks = Array.isArray(output?.checks) ? (output.checks as string[]) : []
                    const intelligence = output?.intelligence as
                      AccountingIntelligenceView | undefined
                    const writeRecovery = output?.writeRecovery as WriteRecoveryView | undefined
                    const odooRecords = odooRecordRefsFromOutput(output)
                    return (
                      <article className={`mission-card ${mission.status}`} key={mission.id}>
                        <div className="mission-rail">
                          <span />
                          <i />
                        </div>
                        <div className="mission-content">
                          <div className="mission-header">
                            <div>
                              <span className="mission-agent">Ledger</span>
                              <h3>{mission.title}</h3>
                            </div>
                            <StatusBadge status={mission.status} />
                          </div>
                          <p>{friendlyError(mission.summary)}</p>
                          {odooRecords.length > 0 && (
                            <div className="odoo-record-links" aria-label="Related Odoo records">
                              {odooRecords.map((record) => (
                                <OdooRecordLink
                                  gadget={gadget}
                                  key={`${record.model}-${record.id}`}
                                  record={record}
                                />
                              ))}
                            </div>
                          )}
                          {approval && mission.status === 'waiting_approval' && (
                            <div className="approval-card">
                              <div className="approval-icon">
                                <Icon name="shield" />
                              </div>
                              <div>
                                <strong>{String(approval.title ?? 'Approval needed')}</strong>
                                <p>{friendlyError(String(approval.message ?? mission.summary))}</p>
                              </div>
                              <div className="approval-actions">
                                <button
                                  className="ghost-button danger"
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
                                  Allow once
                                </button>
                                <button
                                  className="primary-button"
                                  disabled={actionId === mission.id}
                                  onClick={() => void decide(mission, true, true)}
                                  type="button"
                                >
                                  Allow & remember
                                </button>
                              </div>
                            </div>
                          )}
                          <MissionDisclosure
                            label={
                              writeRecovery
                                ? 'Review workflow and failure details'
                                : 'View workflow details'
                            }
                            meta={
                              checks.length > 0
                                ? `${checks.length} check${checks.length === 1 ? '' : 's'}`
                                : undefined
                            }
                          >
                            <div className="workflow-steps" aria-label="Workflow steps">
                              {[
                                'Validate',
                                'Reconcile',
                                'Partner',
                                'Tax',
                                'Configure',
                                'Draft'
                              ].map((step, index) => (
                                <span
                                  className={
                                    mission.status === 'completed' ||
                                    (mission.status === 'waiting_approval' &&
                                      index < completedBeforeApproval)
                                      ? 'done'
                                      : ''
                                  }
                                  key={step}
                                >
                                  <i />
                                  {step}
                                </span>
                              ))}
                            </div>
                            {intelligence && (
                              <div className="accounting-intelligence">
                                <div>
                                  <Icon name="sparkles" size={17} />
                                  <strong>Ledger Intelligence</strong>
                                  <span>AI analyzed</span>
                                </div>
                                <p>
                                  <strong>
                                    Account · {Math.round(intelligence.account.confidence * 100)}%
                                  </strong>
                                  {intelligence.account.rationale}
                                </p>
                                <p>
                                  <strong>
                                    Tax · {Math.round(intelligence.tax.confidence * 100)}%
                                  </strong>
                                  {intelligence.tax.rationale}
                                </p>
                              </div>
                            )}
                            {writeRecovery && (
                              <div className="write-recovery-alert" role="status">
                                <Icon name="alert" size={18} />
                                <div>
                                  <strong>
                                    Odoo failure analysis ·{' '}
                                    {Math.round(writeRecovery.confidence * 100)}%
                                  </strong>
                                  <p>{writeRecovery.rationale}</p>
                                  <span>
                                    {writeRecovery.attemptedRetry
                                      ? writeRecovery.retrySucceeded
                                        ? 'One safe retry succeeded.'
                                        : 'The single safe retry did not succeed.'
                                      : 'No automatic retry was attempted.'}
                                  </span>
                                </div>
                              </div>
                            )}
                            {(checks.length > 0 || Boolean(output?.draft)) && (
                              <details className="mission-details">
                                <summary>Checks and Odoo payload</summary>
                                {checks.length > 0 && (
                                  <ul>
                                    {checks.map((check) => (
                                      <li key={check}>
                                        <Icon name="check" size={15} />
                                        {check}
                                      </li>
                                    ))}
                                  </ul>
                                )}
                                {Boolean(output?.draft) && (
                                  <pre>{JSON.stringify(output?.draft, null, 2)}</pre>
                                )}
                              </details>
                            )}
                          </MissionDisclosure>
                          <MissionErrorDetails mission={mission} />
                          <time dateTime={mission.updatedAt}>
                            {new Date(mission.updatedAt).toLocaleString()}
                          </time>
                        </div>
                      </article>
                    )
                  })}
                </div>
                <Pagination
                  label="Ledger activity"
                  onPageChange={(page) => setActivityPage('ledger', page)}
                  page={pageFor('ledger', ledgerMissions.length)}
                  pageSize={activityPageSize}
                  totalItems={ledgerMissions.length}
                />
              </>
            )}
          </section>
        </>
      )}
    </section>
  )
}
