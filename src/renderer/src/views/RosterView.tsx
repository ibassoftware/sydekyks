import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ImapPublicStatus, OdooPublicStatus } from '../../../shared/ipc'
import { Icon } from '../components/Icon'
import type { Sidekick } from '../lib/types'
import { portraitFor } from '../lib/sydekyk-portraits'

type SkillFileTab = 'preview' | 'markdown'

const skillFilePath = (sidekick: Sidekick): string =>
  sidekick.source === 'preset'
    ? `skills/${sidekick.id}/SKILL.md`
    : `local-sidekicks/${sidekick.id}/SKILL.md`

const skillMarkdown = (sidekick: Sidekick): string =>
  [
    '---',
    `name: ${JSON.stringify(sidekick.id)}`,
    `description: ${JSON.stringify(sidekick.description)}`,
    '---',
    '',
    sidekick.instructions.trim(),
    ''
  ].join('\n')

function SkillFileDialog({
  onClose,
  sidekick
}: {
  onClose: () => void
  sidekick: Sidekick
}): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [tab, setTab] = useState<SkillFileTab>('preview')
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const markdown = useMemo(() => skillMarkdown(sidekick), [sidekick])
  const path = skillFilePath(sidekick)

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  const close = (): void => dialogRef.current?.close()

  const selectTab = (nextTab: SkillFileTab, focus = false): void => {
    setTab(nextTab)
    if (focus) {
      window.requestAnimationFrame(() => document.getElementById(`skill-tab-${nextTab}`)?.focus())
    }
  }

  const handleTabKey = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    currentTab: SkillFileTab
  ): void => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const nextTab =
      event.key === 'Home'
        ? 'preview'
        : event.key === 'End'
          ? 'markdown'
          : currentTab === 'preview'
            ? 'markdown'
            : 'preview'
    selectTab(nextTab, true)
  }

  const copyMarkdown = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(markdown)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
  }

  return (
    <dialog
      aria-labelledby="skill-file-title"
      aria-modal="true"
      className="skill-file-dialog"
      onClick={(event) => {
        if (event.target === event.currentTarget) close()
      }}
      onClose={onClose}
      ref={dialogRef}
    >
      <div className="skill-file-shell">
        <header className="skill-file-header">
          <div>
            <p className="eyebrow">Current skill file · version {sidekick.version}</p>
            <h2 id="skill-file-title">{sidekick.name}</h2>
            <code>{path}</code>
          </div>
          <button aria-label="Close skill file" className="skill-file-close" onClick={close}>
            <Icon name="close" size={18} />
          </button>
        </header>

        <div aria-label="Skill file view" className="skill-file-tabs" role="tablist">
          {(['preview', 'markdown'] as const).map((item) => (
            <button
              aria-controls={`skill-panel-${item}`}
              aria-selected={tab === item}
              className={tab === item ? 'active' : ''}
              id={`skill-tab-${item}`}
              key={item}
              onClick={() => selectTab(item)}
              onKeyDown={(event) => handleTabKey(event, item)}
              role="tab"
              tabIndex={tab === item ? 0 : -1}
              type="button"
            >
              {item === 'preview' ? 'Readable preview' : 'Markdown source'}
            </button>
          ))}
        </div>

        <div
          aria-labelledby="skill-tab-preview"
          className="skill-file-panel skill-markdown-preview"
          hidden={tab !== 'preview'}
          id="skill-panel-preview"
          role="tabpanel"
          tabIndex={0}
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{sidekick.instructions}</ReactMarkdown>
        </div>
        <div
          aria-labelledby="skill-tab-markdown"
          className="skill-file-panel skill-markdown-source"
          hidden={tab !== 'markdown'}
          id="skill-panel-markdown"
          role="tabpanel"
          tabIndex={0}
        >
          <pre>
            <code>{markdown}</code>
          </pre>
        </div>

        <footer className="skill-file-footer">
          <span>
            {sidekick.source === 'preset'
              ? 'Built-in source file'
              : 'Chat-created skill stored in the local Sidekick database'}
          </span>
          <button className="secondary-button" onClick={() => void copyMarkdown()} type="button">
            <Icon name={copyState === 'copied' ? 'check' : 'document'} size={16} />
            {copyState === 'copied'
              ? 'Copied'
              : copyState === 'failed'
                ? 'Copy failed'
                : 'Copy Markdown'}
          </button>
        </footer>
      </div>
    </dialog>
  )
}

export function RosterView({
  gadget,
  imap,
  onOpenAutomations,
  onOpenGadgets,
  sidekicks
}: {
  gadget: OdooPublicStatus
  imap: ImapPublicStatus
  onOpenAutomations: () => void
  onOpenGadgets: () => void
  sidekicks: Sidekick[]
}): React.JSX.Element {
  const [selectedSidekick, setSelectedSidekick] = useState<Sidekick>()

  return (
    <section className="page-view scroll-view" aria-labelledby="roster-title">
      <header className="view-header">
        <p className="eyebrow">Versioned business skills</p>
        <h1 id="roster-title">Sidekicks</h1>
        <p>
          Sidekicks include versioned Markdown skills and sealed specialists for work that needs
          fixed controls. Create or refine Markdown skills through chat.
        </p>
      </header>
      <div className="roster-grid">
        <article className="roster-card ledger sealed">
          <div className="roster-card-top">
            <div className="sydekyk-avatar ledger-avatar">
              <img alt="Ledger portrait" src={portraitFor('ledger')} />
            </div>
            <span className="availability sealed">
              <span />
              Ready
            </span>
          </div>
          <p className="eyebrow">Built-in specialist</p>
          <h2>Ledger</h2>
          <p>
            Reviews vendor bills, checks accounting context and duplicates, and prepares Odoo drafts
            through an approval-aware control path.
          </p>
          <div className="roster-kind sealed">
            <Icon name="shield" size={17} />
            <span>Sealed workflow · draft bills only</span>
          </div>
          <div className="roster-sealed-note">
            <Icon name="shield" size={16} />
            <span>Fixed safeguards · no editable SKILL.md</span>
          </div>
          <div className="capability-list">
            <span>Never posts or pays</span>
            <span>Explicit approvals</span>
          </div>
          <div className="roster-automation-callout ledger-inbox-callout">
            <div>
              <Icon name="mail" size={17} />
              <span>
                <strong>Email-to-bill intake</strong>
                <small>
                  {imap.connected
                    ? `Watching ${imap.mailbox ?? 'the connected inbox'} with Ledger’s review policy.`
                    : 'Connect the Email inbox Gadget before Ledger can check mail.'}
                </small>
              </span>
            </div>
            <button className="ghost-button" onClick={onOpenGadgets} type="button">
              {imap.connected ? 'Manage' : 'Connect'}
            </button>
          </div>
          <div className="roster-footer">
            <span>
              <Icon name="plug" size={16} />
              Odoo · {gadget.connected ? 'connected' : 'locked'}
            </span>
          </div>
        </article>
        {sidekicks
          .filter((sidekick) => sidekick.id !== 'ledger')
          .map((sidekick) => (
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
              <button
                className="secondary-button roster-skill-file-button"
                onClick={() => setSelectedSidekick(sidekick)}
                type="button"
              >
                <Icon name="document" size={16} />
                View SKILL.md
              </button>
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
                    <small>
                      Manual, schedule, or email triggers use this pinned skill version.
                    </small>
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
      {selectedSidekick && (
        <SkillFileDialog
          key={selectedSidekick.id}
          onClose={() => setSelectedSidekick(undefined)}
          sidekick={selectedSidekick}
        />
      )}
    </section>
  )
}
