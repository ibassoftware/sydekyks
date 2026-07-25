import type { OdooPublicStatus } from '../../../shared/ipc'
import { Icon } from '../components/Icon'
import type { Sidekick } from '../lib/types'
import { portraitFor } from '../lib/sydekyk-portraits'

export function RosterView({
  gadget,
  onOpenAutomations,
  sidekicks
}: {
  gadget: OdooPublicStatus
  onChanged: () => Promise<void>
  onOpenAutomations: () => void
  sidekicks: Sidekick[]
}): React.JSX.Element {
  return (
    <section className="page-view scroll-view" aria-labelledby="roster-title">
      <header className="view-header">
        <p className="eyebrow">Versioned business skills</p>
        <h1 id="roster-title">Sidekicks</h1>
        <p>
          Sidekicks are Markdown skills Syd activates when they fit the work. Create or refine one
          through chat—no new agent code or fixed Odoo module mapping required.
        </p>
      </header>
      <div className="roster-grid">
        {sidekicks.map((sidekick) => (
          <article className={`roster-card ${sidekick.id}`} key={sidekick.id}>
            <div className="roster-card-top">
              <div className={`sydekyk-avatar ${sidekick.id}-avatar`}>
                {portraitFor(sidekick.id) ? (
                  <img alt={`${sidekick.name} portrait`} src={portraitFor(sidekick.id)} />
                ) : (
                  sidekick.name[0]
                )}
              </div>
              <span className="availability">
                <span />
                {sidekick.status === 'active' ? 'Active' : 'Paused'}
              </span>
            </div>
            <p className="eyebrow">
              {sidekick.source === 'preset' ? 'Built-in skill' : 'Created in chat'}
            </p>
            <h2>{sidekick.name}</h2>
            <p>{sidekick.description}</p>
            <div className="roster-kind">
              <Icon name="sparkles" size={17} />
              <span>Markdown skill · version {sidekick.version}</span>
            </div>
            <div className="capability-list">
              {sidekick.capabilities.length === 0 ? (
                <span>Read-only until access is approved</span>
              ) : (
                sidekick.capabilities.map((capability) => (
                  <span key={capability.model}>
                    {capability.label} · {capability.operations.join(', ')}
                  </span>
                ))
              )}
            </div>
            <div className="roster-automation-callout">
              <div>
                <Icon name="clock" size={17} />
                <span>
                  <strong>Optional automations</strong>
                  <small>Manual, schedule, or email triggers use this pinned skill version.</small>
                </span>
              </div>
              <button className="ghost-button" onClick={onOpenAutomations} type="button">
                View
              </button>
            </div>
            <div className="roster-footer">
              <span>
                <Icon name="plug" size={16} />
                Odoo · {gadget.connected ? 'connected' : 'locked'}
              </span>
            </div>
          </article>
        ))}
        <article className="roster-card roster-placeholder">
          <div className="placeholder-mark">
            <Icon name="plus" size={24} />
          </div>
          <h2>Create your next Sidekick</h2>
          <p>
            Tell Syd: “Create a Sidekick called Renewals that reviews contracts approaching their
            renewal date.”
          </p>
          <span className="coming-label">Created through chat</span>
        </article>
      </div>
      <section className="principle-strip">
        <Icon name="shield" />
        <div>
          <strong>Skills guide; capabilities authorize</strong>
          <span>
            A Sidekick cannot grant itself access. Every Odoo write needs an exact entity
            capability, the connected user’s Odoo rights, live writes, and an approval.
          </span>
        </div>
      </section>
    </section>
  )
}
