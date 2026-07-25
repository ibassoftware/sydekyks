import { useState } from 'react'
import type { OdooPublicStatus } from '../../../shared/ipc'
import type { RosterMember } from '../lib/types'
import { Icon } from '../components/Icon'
import { updateInboundReviewPolicy } from '../lib/api'
import { portraitFor } from '../lib/sydekyk-portraits'

export function RosterView({
  gadget,
  onChanged,
  onOpenAutomations,
  roster
}: {
  gadget: OdooPublicStatus
  onChanged: () => Promise<void>
  onOpenAutomations: () => void
  roster: RosterMember[]
}): React.JSX.Element {
  const [savingId, setSavingId] = useState<string>()
  const [error, setError] = useState<string>()

  const updateReviewMode = async (
    member: RosterMember,
    reviewMode: NonNullable<RosterMember['inboundPolicy']>['reviewMode']
  ): Promise<void> => {
    if (!member.inboundPolicy) return
    setSavingId(member.id)
    setError(undefined)
    try {
      await updateInboundReviewPolicy(member.id, {
        ...member.inboundPolicy,
        reviewMode
      })
      await onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The inbound policy could not be saved')
    } finally {
      setSavingId(undefined)
    }
  }

  return (
    <section className="page-view scroll-view" aria-labelledby="roster-title">
      <header className="view-header">
        <p className="eyebrow">Installed specialists</p>
        <h1 id="roster-title">Roster</h1>
        <p>Every Sydekyk has a visible scope and only the capabilities it needs.</p>
      </header>
      <div className="roster-grid">
        {roster.map((member) => (
          <article className={`roster-card ${member.id}`} key={member.id}>
            <div className="roster-card-top">
              <div className={`sydekyk-avatar ${member.id}-avatar`}>
                {portraitFor(member.id) ? (
                  <img alt={`${member.name} portrait`} src={portraitFor(member.id)} />
                ) : (
                  member.name[0]
                )}
              </div>
              <span className="availability">
                <span />
                Ready
              </span>
            </div>
            <p className="eyebrow">{member.role}</p>
            <h2>{member.name}</h2>
            <p>{member.description}</p>
            <div className="roster-kind">
              <Icon name={member.kind === 'hybrid' ? 'bolt' : 'chat'} size={17} />
              <span>{member.kind === 'hybrid' ? 'Chat agent + workflow' : 'Chat agent'}</span>
            </div>
            <div className="roster-intelligence">
              <Icon name="sparkles" size={15} />
              <span>
                {member.intelligence.length} intelligence moment
                {member.intelligence.length === 1 ? '' : 's'}
              </span>
            </div>
            {member.triggers.includes('schedule') && (
              <div className="roster-automation-callout">
                <div>
                  <Icon name="clock" size={17} />
                  <span>
                    <strong>Chat + Automations</strong>
                    <small>Ask once or let {member.name} run on your schedule.</small>
                  </span>
                </div>
                <button className="ghost-button" onClick={onOpenAutomations} type="button">
                  {member.automationCount > 0
                    ? `Manage ${member.automationCount}`
                    : 'Set a schedule'}
                </button>
              </div>
            )}
            <div className="capability-list">
              {member.capabilities.map((capability) => (
                <span key={capability}>{capability}</span>
              ))}
            </div>
            {member.inboundPolicy && (
              <label className="roster-policy">
                <span>Inbound bill verification</span>
                <select
                  aria-label={`${member.name} inbound bill verification`}
                  disabled={savingId === member.id}
                  value={member.inboundPolicy.reviewMode}
                  onChange={(event) =>
                    void updateReviewMode(
                      member,
                      event.target.value as NonNullable<RosterMember['inboundPolicy']>['reviewMode']
                    )
                  }
                >
                  <option value="always">Always verify</option>
                  <option value="when-uncertain">Only when uncertain</option>
                  <option value="automatic">Automatic</option>
                </select>
                <small>
                  {member.inboundPolicy.reviewMode === 'always'
                    ? 'Every extracted bill waits in Mission Control.'
                    : member.inboundPolicy.reviewMode === 'when-uncertain'
                      ? `Complete bills at ${Math.round(member.inboundPolicy.confidenceThreshold * 100)}% confidence can continue automatically.`
                      : 'Complete vendor bills continue automatically; missing or unsupported documents still stop.'}
                </small>
              </label>
            )}
            <div className="roster-footer">
              {member.gadgets.includes('Odoo') ? (
                <span>
                  <Icon name="plug" size={16} />
                  Odoo · {gadget.connected ? 'connected' : 'locked'}
                </span>
              ) : member.gadgets.includes('AI') ? (
                <span>
                  <Icon name="sparkles" size={16} />
                  AI intelligence
                </span>
              ) : (
                <span>
                  <Icon name="shield" size={16} />
                  No Gadget access
                </span>
              )}
            </div>
          </article>
        ))}
        <article className="roster-card roster-placeholder">
          <div className="placeholder-mark">
            <Icon name="users" size={24} />
          </div>
          <h2>Your next Sydekyk</h2>
          <p>
            Manufacturing and other specialists can join the same roster without changing Syd or
            shared Gadgets.
          </p>
          <span className="coming-label">Not installed</span>
        </article>
      </div>
      {error && (
        <div className="inline-alert error roster-policy-error" role="alert">
          <Icon name="alert" size={18} />
          {error}
        </div>
      )}
      <section className="principle-strip">
        <Icon name="shield" />
        <div>
          <strong>Least privilege by default</strong>
          <span>
            Ledger can prepare draft bills. Nudge, Mirror, and Shield are read-only, and none
            inherits another Sydekyk’s tools.
          </span>
        </div>
      </section>
    </section>
  )
}
