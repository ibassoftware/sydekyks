import { useState } from 'react'
import { deleteAutomation, runAutomationNow, setAutomationStatus } from '../lib/api'
import type { Automation } from '../lib/types'
import { Icon } from '../components/Icon'

const formatDate = (value?: string): string =>
  value
    ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : 'Not scheduled'

export function AutomationsPanel({
  automations,
  onChanged
}: {
  automations: Automation[]
  onChanged: () => Promise<void>
}): React.JSX.Element {
  const [busy, setBusy] = useState<string>()
  const [error, setError] = useState<string>()

  const perform = async (id: string, action: () => Promise<unknown>): Promise<void> => {
    setBusy(id)
    setError(undefined)
    try {
      await action()
      await onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The automation action failed')
    } finally {
      setBusy(undefined)
    }
  }

  return (
    <div className="automations-view">
      <section className="automation-hero" aria-labelledby="automations-title">
        <div>
          <p className="eyebrow">Declarative automations</p>
          <h2 id="automations-title">Describe the process. Syd builds the trigger.</h2>
          <p>
            Automations pin a Sidekick version to a business instruction and a manual, schedule, or
            email trigger. They contain validated data—not generated application code.
          </p>
        </div>
        <div className="automation-chat-hint">
          <Icon name="chat" size={18} />
          <span>
            Ask Syd to create, change, or delete an automation. For vendor bills from email, ask Syd
            to configure Ledger’s inbox instead.
          </span>
        </div>
      </section>

      {error && (
        <div className="inline-alert error" role="alert">
          <Icon name="alert" size={18} />
          {error}
        </div>
      )}

      <section className="automation-list" aria-label="Current automations">
        {automations.map((automation) => (
          <article className="automation-card" key={automation.id}>
            <div className="automation-card-heading">
              <div>
                <p className="eyebrow">
                  {automation.sidekickName} · skill v{automation.sidekickVersion}
                </p>
                <h3>{automation.name}</h3>
              </div>
              <span className={`status-badge ${automation.status}`}>{automation.status}</span>
            </div>
            <p>{automation.prompt}</p>
            <dl className="automation-facts">
              <div>
                <dt>Trigger</dt>
                <dd>{automation.triggerLabel}</dd>
              </div>
              <div>
                <dt>Write policy</dt>
                <dd>
                  {automation.approvalMode === 'read-only'
                    ? 'Read-only'
                    : 'Interactive approval required'}
                </dd>
              </div>
              <div>
                <dt>Next run</dt>
                <dd>{formatDate(automation.nextRunAt)}</dd>
              </div>
              <div>
                <dt>Last run</dt>
                <dd>{formatDate(automation.lastRunAt)}</dd>
              </div>
            </dl>
            {automation.lastError && <p className="automation-error">{automation.lastError}</p>}
            <div className="automation-actions">
              <button
                className="secondary-button"
                disabled={busy === automation.id}
                onClick={() => void perform(automation.id, () => runAutomationNow(automation.id))}
                type="button"
              >
                <Icon name="bolt" size={16} />
                Run now
              </button>
              <button
                className="ghost-button"
                disabled={busy === automation.id}
                onClick={() =>
                  void perform(automation.id, () =>
                    setAutomationStatus(
                      automation.id,
                      automation.status === 'active' ? 'paused' : 'active'
                    )
                  )
                }
                type="button"
              >
                {automation.status === 'active' ? 'Pause' : 'Activate'}
              </button>
              <button
                className="ghost-button danger-button"
                disabled={busy === automation.id}
                onClick={() => {
                  if (!window.confirm(`Delete “${automation.name}”?`)) return
                  void perform(automation.id, () => deleteAutomation(automation.id))
                }}
                type="button"
              >
                Delete
              </button>
            </div>
          </article>
        ))}
        {automations.length === 0 && (
          <div className="empty-state">
            <Icon name="clock" size={24} />
            <h3>No automations yet</h3>
            <p>
              Try: “Every weekday at 9, have Nudge review open opportunities and tell me which need
              attention.”
            </p>
          </div>
        )}
      </section>
    </div>
  )
}
