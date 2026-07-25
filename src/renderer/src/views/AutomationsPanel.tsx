import { useState } from 'react'
import {
  createAutomation,
  deleteAutomation,
  runAutomationNow,
  runMirrorCheck,
  runNudgeCheck,
  runShieldReview,
  setAutomationStatus,
  updateAutomation
} from '../lib/api'
import type { Automation, AutomationSchedule } from '../lib/types'
import { Icon } from '../components/Icon'
import { friendlyError } from '../lib/errors'

type Cadence = 'daily' | 'weekdays' | 'weekly' | 'interval-days'
type AutomationOwner = Automation['ownerSydekykId']

interface AutomationForm {
  owner: AutomationOwner
  name: string
  cadence: Cadence
  everyDays: string
  weeklyDay: string
  time: string
  timezone: string
  windowDays: string
  notifyOnlyWhenAttention: boolean
  missedRunPolicy: 'skip' | 'run-on-start'
}

const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const specialists = {
  nudge: {
    name: 'Nudge',
    role: 'CRM vigilance',
    description: 'AI reviews opportunity activity gaps and recent conversations.',
    defaultAutomationName: 'Nudge stale opportunities',
    defaultWindow: 2,
    windowLabel: 'Consider attention after',
    windowSummary: (days: string): string => `attention after ${days || '—'} days`,
    workflowId: 'nudge-stale-opportunities' as const
  },
  mirror: {
    name: 'Mirror',
    role: 'AP duplicate watch',
    description: 'AI screens bill pairs, then confirms candidates against their line items.',
    defaultAutomationName: 'Mirror duplicate bills',
    defaultWindow: 365,
    windowLabel: 'Scan bill history for',
    windowSummary: (days: string): string => `${days || '—'}-day bill window`,
    workflowId: 'mirror-duplicate-bills' as const
  },
  shield: {
    name: 'Shield',
    role: 'AP risk sentinel',
    description: 'AI watches, assesses, ranks, and briefs vendor-bill risk evidence.',
    defaultAutomationName: 'Shield AP risk review',
    defaultWindow: 90,
    windowLabel: 'Watch activity for',
    windowSummary: (days: string): string => `${days || '—'}-day risk window`,
    workflowId: 'shield-fraud-review' as const
  }
}

const blankForm = (owner: AutomationOwner = 'nudge'): AutomationForm => ({
  owner,
  name: specialists[owner].defaultAutomationName,
  cadence: 'weekdays',
  everyDays: '3',
  weeklyDay: '1',
  time: '09:00',
  timezone,
  windowDays: String(specialists[owner].defaultWindow),
  notifyOnlyWhenAttention: true,
  missedRunPolicy: 'run-on-start'
})

const cadenceFromSchedule = (schedule: AutomationSchedule): Cadence => {
  if (schedule.kind === 'interval') return 'interval-days'
  const days = [...schedule.daysOfWeek].sort((left, right) => left - right).join(',')
  if (days === '0,1,2,3,4,5,6') return 'daily'
  if (days === '1,2,3,4,5') return 'weekdays'
  return 'weekly'
}

const formFromAutomation = (automation: Automation): AutomationForm => ({
  owner: automation.ownerSydekykId,
  name: automation.name,
  cadence: cadenceFromSchedule(automation.schedule),
  everyDays: automation.schedule.kind === 'interval' ? String(automation.schedule.every) : '3',
  weeklyDay:
    automation.schedule.kind === 'calendar' && automation.schedule.daysOfWeek.length === 1
      ? String(automation.schedule.daysOfWeek[0])
      : '1',
  time: automation.schedule.time,
  timezone: automation.schedule.timezone,
  windowDays: String(
    automation.inputData.staleAfterDays ??
      automation.inputData.lookbackDays ??
      specialists[automation.ownerSydekykId].defaultWindow
  ),
  notifyOnlyWhenAttention: automation.inputData.notifyOnlyWhenAttention,
  missedRunPolicy: automation.missedRunPolicy
})

const scheduleFromForm = (form: AutomationForm): AutomationSchedule => {
  if (form.cadence === 'interval-days') {
    return {
      kind: 'interval',
      every: Number(form.everyDays),
      unit: 'days',
      time: form.time,
      timezone: form.timezone,
      anchorAt: new Date(Date.now() + 86_400_000).toISOString()
    }
  }
  return {
    kind: 'calendar',
    daysOfWeek:
      form.cadence === 'daily'
        ? [0, 1, 2, 3, 4, 5, 6]
        : form.cadence === 'weekdays'
          ? [1, 2, 3, 4, 5]
          : [Number(form.weeklyDay)],
    time: form.time,
    timezone: form.timezone
  }
}

const formSummary = (form: AutomationForm): string => {
  const cadence =
    form.cadence === 'daily'
      ? 'Every day'
      : form.cadence === 'weekdays'
        ? 'Weekdays'
        : form.cadence === 'weekly'
          ? `Every ${weekdays[Number(form.weeklyDay)]}`
          : `Every ${form.everyDays || '—'} days`
  return `${cadence} at ${form.time} · ${specialists[form.owner].windowSummary(form.windowDays)}`
}

const formatDate = (value?: string): string =>
  value
    ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : 'Not scheduled'

const automationScope = (automation: Automation): string =>
  automation.ownerSydekykId === 'nudge'
    ? `Attention after ${automation.inputData.staleAfterDays} days`
    : `${automation.inputData.lookbackDays}-day Odoo watch window`

export function AutomationsPanel({
  automations,
  onChanged
}: {
  automations: Automation[]
  onChanged: () => Promise<void>
}): React.JSX.Element {
  const [form, setForm] = useState<AutomationForm>(blankForm)
  const [editingId, setEditingId] = useState<string>()
  const [showForm, setShowForm] = useState(automations.length === 0)
  const [busy, setBusy] = useState<string>()
  const [error, setError] = useState<string>()
  const [checkOwner, setCheckOwner] = useState<AutomationOwner>('nudge')
  const [checkWindow, setCheckWindow] = useState(String(specialists.nudge.defaultWindow))

  const update = <Key extends keyof AutomationForm>(key: Key, value: AutomationForm[Key]): void =>
    setForm((current) => ({ ...current, [key]: value }))

  const selectOwner = (owner: AutomationOwner): void => {
    setCheckOwner(owner)
    setCheckWindow(String(specialists[owner].defaultWindow))
  }

  const selectFormOwner = (owner: AutomationOwner): void => {
    setForm((current) => ({
      ...current,
      owner,
      name: specialists[owner].defaultAutomationName,
      windowDays: String(specialists[owner].defaultWindow)
    }))
  }

  const reset = (): void => {
    setForm(blankForm())
    setEditingId(undefined)
    setShowForm(false)
    setError(undefined)
  }

  const edit = (automation: Automation): void => {
    setForm(formFromAutomation(automation))
    setEditingId(automation.id)
    setShowForm(true)
    setError(undefined)
  }

  const save = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    setBusy(editingId ?? 'create')
    setError(undefined)
    try {
      const specialist = specialists[form.owner]
      const inputData = {
        ...(form.owner === 'nudge'
          ? { staleAfterDays: Number(form.windowDays) }
          : { lookbackDays: Number(form.windowDays) }),
        limit: 50,
        notifyOnlyWhenAttention: form.notifyOnlyWhenAttention
      }
      const input = {
        name: form.name,
        ownerSydekykId: form.owner,
        workflowId: specialist.workflowId,
        schedule: scheduleFromForm(form),
        inputData,
        missedRunPolicy: form.missedRunPolicy,
        status: 'active' as const
      }
      if (editingId) {
        await updateAutomation(editingId, {
          name: input.name,
          schedule: input.schedule,
          inputData: input.inputData,
          missedRunPolicy: input.missedRunPolicy
        })
      } else {
        await createAutomation(input)
      }
      reset()
      await onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The automation could not be saved')
    } finally {
      setBusy(undefined)
    }
  }

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

  const runCheck = async (): Promise<void> => {
    setBusy('check-now')
    setError(undefined)
    try {
      const days = Number(checkWindow)
      if (checkOwner === 'nudge') await runNudgeCheck(days)
      else if (checkOwner === 'mirror') await runMirrorCheck(days)
      else await runShieldReview(days)
      await onChanged()
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : `${specialists[checkOwner].name} could not run`
      )
    } finally {
      setBusy(undefined)
    }
  }

  return (
    <div className="automations-view">
      <section className="automation-hero" aria-labelledby="automations-title">
        <div>
          <p className="eyebrow">Intelligence on your schedule</p>
          <h2 id="automations-title">Quiet watches. Visible missions.</h2>
          <p>
            Choose a Sydekyk, run once, or set a flexible local cadence. Every run lands in Mission
            Control.
          </p>
        </div>
        <button
          className="primary-button"
          onClick={() => {
            setShowForm(true)
            setEditingId(undefined)
            setForm(blankForm(checkOwner))
          }}
          type="button"
        >
          <Icon name="clock" size={18} />
          New automation
        </button>
      </section>

      <section className="check-now-card automation-check-card" aria-labelledby="check-now-title">
        <div className={`sydekyk-avatar ${checkOwner}-avatar`}>
          {specialists[checkOwner].name[0]}
        </div>
        <div>
          <h3 id="check-now-title">Run an intelligence check</h3>
          <p>{specialists[checkOwner].description}</p>
        </div>
        <label>
          <span>Sydekyk</span>
          <select
            aria-label="Sydekyk to run"
            onChange={(event) => selectOwner(event.target.value as AutomationOwner)}
            value={checkOwner}
          >
            {Object.entries(specialists).map(([id, specialist]) => (
              <option key={id} value={id}>
                {specialist.name} · {specialist.role}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{specialists[checkOwner].windowLabel}</span>
          <span className="inline-number-field">
            <input
              aria-label={`${specialists[checkOwner].windowLabel} in days`}
              max="1825"
              min="1"
              onChange={(event) => setCheckWindow(event.target.value)}
              type="number"
              value={checkWindow}
            />
            days
          </span>
        </label>
        <button
          className="secondary-button"
          disabled={busy === 'check-now'}
          onClick={() => void runCheck()}
          type="button"
        >
          <Icon name={busy === 'check-now' ? 'refresh' : 'sparkles'} size={18} />
          {busy === 'check-now'
            ? `${specialists[checkOwner].name} is working…`
            : `Run ${specialists[checkOwner].name}`}
        </button>
      </section>

      {showForm && (
        <section className="surface automation-builder" aria-labelledby="automation-builder-title">
          <div className="section-title">
            <div>
              <p className="eyebrow">Flexible cadence</p>
              <h2 id="automation-builder-title">
                {editingId ? 'Edit automation' : 'Create an automation'}
              </h2>
            </div>
            <button className="ghost-button" onClick={reset} type="button">
              Cancel
            </button>
          </div>
          <form className="automation-form" onSubmit={(event) => void save(event)}>
            <label>
              <span>Sydekyk</span>
              <select
                disabled={Boolean(editingId)}
                onChange={(event) => selectFormOwner(event.target.value as AutomationOwner)}
                value={form.owner}
              >
                {Object.entries(specialists).map(([id, specialist]) => (
                  <option key={id} value={id}>
                    {specialist.name} · {specialist.role}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Name</span>
              <input
                maxLength={120}
                required
                value={form.name}
                onChange={(event) => update('name', event.target.value)}
              />
            </label>
            <fieldset className="span-two cadence-fieldset">
              <legend>How often?</legend>
              <div className="cadence-options">
                {(
                  [
                    ['daily', 'Daily'],
                    ['weekdays', 'Weekdays'],
                    ['weekly', 'Weekly'],
                    ['interval-days', 'Every N days']
                  ] as Array<[Cadence, string]>
                ).map(([value, label]) => (
                  <label key={value}>
                    <input
                      checked={form.cadence === value}
                      name="cadence"
                      onChange={() => update('cadence', value)}
                      type="radio"
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            {form.cadence === 'interval-days' && (
              <label>
                <span>Every</span>
                <span className="inline-number-field">
                  <input
                    max="365"
                    min="2"
                    required
                    type="number"
                    value={form.everyDays}
                    onChange={(event) => update('everyDays', event.target.value)}
                  />{' '}
                  days
                </span>
              </label>
            )}
            {form.cadence === 'weekly' && (
              <label>
                <span>Weekday</span>
                <select
                  value={form.weeklyDay}
                  onChange={(event) => update('weeklyDay', event.target.value)}
                >
                  {weekdays.map((day, index) => (
                    <option key={day} value={index}>
                      {day}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              <span>Time</span>
              <input
                required
                type="time"
                value={form.time}
                onChange={(event) => update('time', event.target.value)}
              />
            </label>
            <label>
              <span>Timezone</span>
              <input
                required
                value={form.timezone}
                onChange={(event) => update('timezone', event.target.value)}
              />
            </label>
            <label>
              <span>{specialists[form.owner].windowLabel}</span>
              <span className="inline-number-field">
                <input
                  max="1825"
                  min="1"
                  required
                  type="number"
                  value={form.windowDays}
                  onChange={(event) => update('windowDays', event.target.value)}
                />{' '}
                days
              </span>
            </label>
            <label>
              <span>When this computer was off</span>
              <select
                value={form.missedRunPolicy}
                onChange={(event) =>
                  update('missedRunPolicy', event.target.value as AutomationForm['missedRunPolicy'])
                }
              >
                <option value="run-on-start">Run when Sydekyks starts</option>
                <option value="skip">Wait for the next scheduled time</option>
              </select>
            </label>
            <label className="toggle-field span-two">
              <input
                checked={form.notifyOnlyWhenAttention}
                onChange={(event) => update('notifyOnlyWhenAttention', event.target.checked)}
                type="checkbox"
              />
              <span className="toggle-track" aria-hidden="true">
                <span />
              </span>
              <span>
                <strong>Quiet unless attention is needed</strong>
                <small>The completed run still appears in Mission Control.</small>
              </span>
            </label>
            <div className="automation-preview span-two" role="status">
              <Icon name="clock" size={18} />
              <div>
                <strong>{formSummary(form)}</strong>
                <span>{form.timezone} · Odoo read-only · AI required</span>
              </div>
            </div>
            <div className="form-footer span-two">
              <p>
                <Icon name="shield" size={16} /> Saving activates this read-only intelligence
                automation.
              </p>
              <button className="primary-button" disabled={Boolean(busy)} type="submit">
                {busy ? <Icon name="refresh" size={18} /> : <Icon name="check" size={18} />}
                {editingId ? 'Save changes' : 'Create automation'}
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

      <section className="mission-section" aria-labelledby="automation-list-title">
        <div className="section-title">
          <div>
            <p className="eyebrow">Recurring work</p>
            <h2 id="automation-list-title">Your automations</h2>
          </div>
          <span>{automations.length} configured</span>
        </div>
        {automations.length === 0 ? (
          <div className="empty-surface">
            <Icon name="clock" size={24} />
            <h3>Nothing scheduled yet</h3>
            <p>Create a cadence here or ask Syd to schedule an installed Sydekyk.</p>
          </div>
        ) : (
          <div className="automation-list">
            {automations.map((automation) => (
              <article className={`automation-card ${automation.status}`} key={automation.id}>
                <div className="automation-card-header">
                  <div>
                    <span className={`automation-owner ${automation.ownerSydekykId}`}>
                      {specialists[automation.ownerSydekykId].name}
                    </span>
                    <h3>{automation.name}</h3>
                  </div>
                  <span className={`automation-status ${automation.status}`}>
                    {automation.status}
                  </span>
                </div>
                <p className="automation-cadence">
                  <Icon name="clock" size={17} />
                  {automation.scheduleLabel}
                  <span>·</span>
                  {automation.schedule.timezone}
                </p>
                <dl className="automation-metadata">
                  <div>
                    <dt>Scope</dt>
                    <dd>{automationScope(automation)}</dd>
                  </div>
                  <div>
                    <dt>Next run</dt>
                    <dd>{formatDate(automation.nextRunAt)}</dd>
                  </div>
                  <div>
                    <dt>Last run</dt>
                    <dd>
                      {automation.lastRunAt ? formatDate(automation.lastRunAt) : 'Not run yet'}
                    </dd>
                  </div>
                </dl>
                {automation.lastError && (
                  <p className="automation-error">
                    <Icon name="alert" size={16} /> {friendlyError(automation.lastError)}
                  </p>
                )}
                <div className="automation-actions">
                  {automation.status === 'draft' ? (
                    <button
                      className="primary-button"
                      disabled={busy === automation.id}
                      onClick={() =>
                        void perform(automation.id, () =>
                          setAutomationStatus(automation.id, 'active')
                        )
                      }
                      type="button"
                    >
                      Activate
                    </button>
                  ) : automation.status === 'active' ? (
                    <button
                      className="secondary-button"
                      disabled={busy === automation.id}
                      onClick={() =>
                        void perform(automation.id, () =>
                          setAutomationStatus(automation.id, 'paused')
                        )
                      }
                      type="button"
                    >
                      Pause
                    </button>
                  ) : (
                    <button
                      className="secondary-button"
                      disabled={busy === automation.id}
                      onClick={() =>
                        void perform(automation.id, () =>
                          setAutomationStatus(automation.id, 'active')
                        )
                      }
                      type="button"
                    >
                      Resume
                    </button>
                  )}
                  <button
                    className="ghost-button"
                    disabled={busy === automation.id || automation.status === 'draft'}
                    onClick={() =>
                      void perform(automation.id, () => runAutomationNow(automation.id))
                    }
                    type="button"
                  >
                    Run now
                  </button>
                  <button className="ghost-button" onClick={() => edit(automation)} type="button">
                    Edit
                  </button>
                  <button
                    className="ghost-button danger"
                    disabled={busy === automation.id}
                    onClick={() => {
                      if (window.confirm(`Delete “${automation.name}”?`))
                        void perform(automation.id, () => deleteAutomation(automation.id))
                    }}
                    type="button"
                  >
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
