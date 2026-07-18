import { useCallback, useEffect, useState } from "react";
import {
  api,
  type LedgerReadiness,
  type NudgeOpportunity,
  type NudgeReadiness,
  type NudgeSettings,
  type NudgeSnoozeEntry,
  type NudgeStage,
} from "../../lib/api";
import { Button, Input, Label } from "../../components/ui";
import { GadgetRequirementList } from "../../components/GadgetRequirementList";
import { ReadinessList } from "../ReadinessList";
import { useTenantCurrency } from "../../lib/useTenantCurrency";
import type { SydekykSetupProps } from "../registry";
import { SettingsBand } from "../SettingsLayout";

export function NudgeSettingsSection({ sydekyk, canManage, onReadiness }: SydekykSetupProps) {
  const currency = useTenantCurrency();
  const [readiness, setReadiness] = useState<NudgeReadiness | null>(null);
  const [settings, setSettings] = useState<NudgeSettings | null>(null);
  const [stages, setStages] = useState<NudgeStage[] | null>(null);
  const [stagesLoading, setStagesLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadStages = useCallback(() => {
    // Live CRM stages - best-effort; only available once Odoo is connected (hence the refresh button).
    setStagesLoading(true);
    api.get<NudgeStage[]>("/tenant/nudge/stages")
      .then((r) => setStages(r.data))
      .catch(() => setStages([]))
      .finally(() => setStagesLoading(false));
  }, []);

  useEffect(() => {
    api.get<NudgeReadiness>("/tenant/nudge/readiness").then((r) => {
      setReadiness(r.data);
      onReadiness?.({ ...r.data, last_inbound_email: null } as LedgerReadiness);
    });
    api.get<NudgeSettings>("/tenant/nudge/settings").then((r) => setSettings(r.data));
    loadStages();
  }, [sydekyk.id, onReadiness, loadStages]);

  async function save(next: NudgeSettings) {
    setSaving(true);
    try {
      const r = await api.put<NudgeSettings>("/tenant/nudge/settings", next);
      setSettings(r.data);
    } finally {
      setSaving(false);
    }
  }

  function thresholdFor(stageId: number): number | "" {
    const t = settings?.stage_thresholds.find((x) => x.stage_id === stageId);
    return t ? t.days : "";
  }

  function setThreshold(stageId: number, raw: string) {
    if (!settings) return;
    const others = settings.stage_thresholds.filter((x) => x.stage_id !== stageId);
    const days = Number(raw);
    const next =
      raw === "" || !Number.isFinite(days) || days <= 0
        ? others
        : [...others, { stage_id: stageId, stage_name: stages?.find((s) => s.id === stageId)?.name, days }];
    save({ ...settings, stage_thresholds: next });
  }

  return (
    <>
      <SettingsBand title="Readiness" description="What Nudge can use now and anything that needs your attention.">
        <div className="grid gap-6 xl:grid-cols-2">
          <div>
            <h3>Operational checks</h3>
            <div className="mt-4">
              {readiness ? <ReadinessList items={readiness.items} /> : <p className="text-sm text-body">Loading...</p>}
            </div>
          </div>
          <div id="gadgets" className="border-t-2 border-ink-600 pt-6 xl:border-l-2 xl:border-t-0 xl:pl-6 xl:pt-0">
            <h3>Odoo connection</h3>
            <p className="mt-2 text-sm text-body">Choose the CRM instance whose open opportunities Nudge should watch.</p>
            <div className="mt-4">
              <GadgetRequirementList sydekykId={sydekyk.id} canManage={canManage} />
            </div>
          </div>
        </div>
      </SettingsBand>

      {settings && (
        <SettingsBand title="Follow-up policy" description="Define how much silence is acceptable before Nudge prepares a follow-up.">
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <Label>Default silence threshold</Label>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                <Input
                  type="number" min={1} max={180}
                  disabled={!canManage || saving}
                  value={settings.default_stale_days}
                  onChange={(e) => setSettings({ ...settings, default_stale_days: Number(e.target.value) })}
                  onBlur={(e) => save({ ...settings, default_stale_days: Number(e.target.value) })}
                />
                <span className="text-sm text-body">days</span>
              </div>
              <p className="mt-2 text-xs text-body">Used whenever a pipeline stage has no custom threshold.</p>
            </div>
            <div>
              <Label>Minimum time between follow-ups</Label>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                <Input
                  type="number" min={1} max={90}
                  disabled={!canManage || saving}
                  value={settings.cadence_days}
                  onChange={(e) => setSettings({ ...settings, cadence_days: Number(e.target.value) })}
                  onBlur={(e) => save({ ...settings, cadence_days: Number(e.target.value) })}
                />
                <span className="text-sm text-body">days</span>
              </div>
              <p className="mt-2 text-xs text-body">Prevents the same opportunity from being nudged too frequently.</p>
            </div>
          </div>

          <div className="mt-6 border-t-2 border-ink-600 pt-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3>Pipeline stage overrides</h3>
                <p className="mt-1 text-xs text-body">Blank stages use the {settings.default_stale_days}-day default.</p>
              </div>
              <Button variant="ghost" className="px-3 py-2 text-sm" onClick={loadStages} disabled={stagesLoading}>
                {stagesLoading ? "Refreshing..." : "Refresh stages"}
              </Button>
            </div>

            {stages === null || stagesLoading ? (
              <p className="mt-4 text-sm text-body">Loading pipeline stages...</p>
            ) : stages.filter((stage) => !stage.is_won).length > 0 ? (
              <div className="mt-4 overflow-hidden rounded-[4px] border-2 border-ink-600 bg-ink-900 shadow-[var(--shadow-xs)]">
                {stages.filter((stage) => !stage.is_won).map((stage) => {
                  const threshold = thresholdFor(stage.id);
                  return (
                    <div key={stage.id} className="grid gap-3 border-b-2 border-ink-600 p-4 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_11rem] sm:items-center">
                      <div className="min-w-0">
                        <p className="font-semibold text-heading">{stage.name ?? `Stage ${stage.id}`}</p>
                        <p className="mt-1 text-xs text-body">
                          {threshold === "" ? `Using the ${settings.default_stale_days}-day default` : `Custom threshold: ${threshold} days silent`}
                        </p>
                      </div>
                      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                        <Input
                          type="number" min={1} max={180}
                          aria-label={`${stage.name ?? `Stage ${stage.id}`} silence threshold in days`}
                          placeholder={String(settings.default_stale_days)}
                          disabled={!canManage || saving}
                          value={threshold}
                          onChange={(e) => {
                            const others = settings.stage_thresholds.filter((item) => item.stage_id !== stage.id);
                            const days = Number(e.target.value);
                            setSettings({ ...settings, stage_thresholds: e.target.value && days > 0
                              ? [...others, { stage_id: stage.id, stage_name: stage.name, days }]
                              : others });
                          }}
                          onBlur={(e) => setThreshold(stage.id, e.target.value)}
                        />
                        <span className="text-sm text-body">days</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="mt-4 rounded-[4px] border-2 border-warning bg-warning-soft p-4 text-sm text-warning-fg">
                No CRM stages were found. Connect and test Odoo, then refresh the stages.
              </p>
            )}
          </div>
        </SettingsBand>
      )}

      {settings && (
        <SettingsBand title="Automatic sweeps" description="Choose whether Nudge patrols the pipeline on a schedule and how much work it takes per sweep.">
          <label className="flex min-h-20 items-center justify-between gap-5 border-b-2 border-ink-600 pb-5 text-heading">
            <span>
              <span className="block text-sm font-semibold">Check the pipeline automatically</span>
              <span className="mt-1 block text-xs leading-5 text-body">Runs {settings.cron_schedule_label.toLowerCase()} and creates drafts and salesperson To-Dos.</span>
            </span>
            <input
              type="checkbox" className="h-5 w-5 shrink-0 accent-gold-500"
              disabled={!canManage || saving}
              checked={settings.cron_enabled}
              onChange={(e) => save({ ...settings, cron_enabled: e.target.checked })}
            />
          </label>

          <div className="grid gap-5 py-5 sm:grid-cols-2">
            <div>
              <Label>Opportunities checked per sweep</Label>
              <Input
                type="number" min={1} max={30}
                disabled={!canManage || saving}
                value={settings.cron_poll_limit}
                onChange={(e) => setSettings({ ...settings, cron_poll_limit: Number(e.target.value) })}
                onBlur={(e) => save({ ...settings, cron_poll_limit: Number(e.target.value) })}
              />
              <p className="mt-2 text-xs text-body">Maximum 30 opportunities per scheduled run.</p>
            </div>
            <div>
              <Label>Salesperson To-Do due after</Label>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                <Input
                  type="number" min={0} max={30}
                  disabled={!canManage || saving}
                  value={settings.activity_days}
                  onChange={(e) => setSettings({ ...settings, activity_days: Number(e.target.value) })}
                  onBlur={(e) => save({ ...settings, activity_days: Number(e.target.value) })}
                />
                <span className="text-sm text-body">days</span>
              </div>
            </div>
          </div>

          <div aria-live="polite" className={`rounded-[4px] border-2 p-4 ${settings.cron_enabled ? "border-gold-700 bg-brand-softer" : "border-ink-600 bg-ink-900"}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-semibold text-heading">
                {settings.cron_enabled && settings.cron_next_run_at
                  ? `Next sweep: ${new Date(settings.cron_next_run_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`
                  : "Automatic sweeps are off"}
              </p>
              <span className="rounded-[2px] border-2 border-ink-600 bg-ink-800 px-2 py-1 text-xs font-medium text-heading">
                {settings.cron_enabled ? "Scheduled" : "Manual only"}
              </span>
            </div>
            <p className="mt-2 text-xs text-body">Nudge drafts the message and assigns a To-Do. Your salesperson reviews and sends it.</p>
          </div>
        </SettingsBand>
      )}

      {settings && (
        <SettingsBand title="Pipeline exclusions" description="Keep deliberately quiet opportunities outside every manual and automatic sweep.">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,0.7fr)] lg:items-start">
            <div>
              <h3>Use an Odoo CRM tag</h3>
              <p className="mt-2 text-sm text-body">Add this tag to any opportunity Nudge should ignore. The exclusion applies until the tag is removed in Odoo.</p>
              <ol className="mt-4 grid gap-2 text-sm text-body">
                <li><strong className="text-heading">1.</strong> Open the opportunity in Odoo.</li>
                <li><strong className="text-heading">2.</strong> Add the configured tag in the Tags field.</li>
                <li><strong className="text-heading">3.</strong> Save the opportunity.</li>
              </ol>
            </div>
            <div className="rounded-[4px] border-2 border-ink-600 bg-ink-900 p-4 shadow-[var(--shadow-xs)]">
              <Label>Skip tag name</Label>
              <Input
                value={settings.skip_tag_name}
                disabled={!canManage || saving}
                onChange={(e) => setSettings({ ...settings, skip_tag_name: e.target.value })}
                onBlur={(e) => save({ ...settings, skip_tag_name: e.target.value.trim() || "Nudge-skip" })}
              />
              <p className="mt-3 text-xs text-body">Current exclusion tag: <strong className="text-heading">{settings.skip_tag_name || "Nudge-skip"}</strong></p>
            </div>
          </div>
        </SettingsBand>
      )}

      {settings && (
        <SettingsBand title="Value assumptions" description="The business inputs behind Nudge's time-saved and money-saved estimates.">
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <Label>Hourly wage ({currency})</Label>
              <Input
                type="number" min={0} step={0.5}
                disabled={!canManage || saving}
                value={settings.estimated_hourly_wage}
                onChange={(e) => setSettings({ ...settings, estimated_hourly_wage: Number(e.target.value) })}
                onBlur={(e) => save({ ...settings, estimated_hourly_wage: Number(e.target.value) })}
              />
            </div>
            <div>
              <Label>Minutes to write one follow-up</Label>
              <Input
                type="number" min={0} step={0.5}
                disabled={!canManage || saving}
                value={settings.estimated_minutes_per_followup}
                onChange={(e) => setSettings({ ...settings, estimated_minutes_per_followup: Number(e.target.value) })}
                onBlur={(e) => save({ ...settings, estimated_minutes_per_followup: Number(e.target.value) })}
              />
            </div>
          </div>
          <p className="mt-3 text-xs text-body">These values estimate the manual follow-up cost avoided on the Command Center dashboard.</p>
        </SettingsBand>
      )}
    </>
  );
}

/** Paused-deal memory: the "don't nag a deal that's legitimately quiet" trap-guard. Deals are picked
 * from real Odoo opportunities (searchable), never by typing an id. */
export function SnoozeManager({ canManage }: { canManage: boolean }) {
  const [rows, setRows] = useState<NudgeSnoozeEntry[] | null>(null);
  const [picked, setPicked] = useState<NudgeOpportunity | null>(null);
  const [until, setUntil] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get<NudgeSnoozeEntry[]>("/tenant/nudge/snoozes").then((r) => setRows(r.data)).catch(() => setRows([]));
  }, []);
  useEffect(() => load(), [load]);

  async function add() {
    if (!picked) return;
    setBusy(true);
    try {
      await api.post("/tenant/nudge/snoozes", {
        odoo_lead_id: picked.id,
        snooze_until: until || null,
        note: note || null,
      });
      setPicked(null);
      setUntil("");
      setNote("");
      load();
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    await api.delete(`/tenant/nudge/snoozes/${id}`);
    load();
  }

  return (
    <div className="grid gap-3 border-t border-ink-700 pt-6">
      <p className="text-xs font-semibold uppercase tracking-wider text-gold-500">Paused deals</p>
      <p className="-mt-1 text-xs text-body">
        Legitimately-quiet deals Nudge should leave alone. Search your Odoo pipeline to pick one, set a date to
        pause until then, or leave it blank to never nudge (whitelist).
      </p>

      {canManage && (
        <div className="grid gap-2">
          <OpportunityPicker value={picked} onPick={setPicked} />
          {picked && (
            <div className="grid grid-cols-[1fr_2fr_auto] items-end gap-2">
              <div>
                <Label>Pause until</Label>
                <Input type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
              </div>
              <div>
                <Label>Note</Label>
                <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Circle back in Q3" />
              </div>
              <Button className="px-3 py-2 text-xs" disabled={busy} onClick={add}>
                {busy ? "…" : "Pause deal"}
              </Button>
            </div>
          )}
        </div>
      )}

      {rows && rows.length > 0 ? (
        <div className="mt-1 grid gap-2">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center gap-3 rounded-lg border border-ink-700 px-3 py-2">
              <span className="text-sm text-heading">{r.opp_name ?? `Opportunity #${r.odoo_lead_id}`}</span>
              <span className="rounded-full border-2 border-ink-600 bg-ink-800 px-2 py-0.5 text-xs text-body">
                {r.snooze_until ? `until ${r.snooze_until}` : "never nudge"}
              </span>
              {r.note && <span className="truncate text-xs text-body">{r.note}</span>}
              {canManage && (
                <button onClick={() => remove(r.id)} className="ml-auto min-h-11 shrink-0 text-xs font-semibold text-danger-strong hover:text-heading">
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-body">No paused deals - Nudge is watching the whole open pipeline.</p>
      )}
    </div>
  );
}

/** Debounced search over open Odoo OPPORTUNITIES (never leads); pick one to act on (never type an
 * id). A refresh button re-runs the search - useful right after connecting Odoo or adding a deal. */
function OpportunityPicker({ value, onPick }: { value: NudgeOpportunity | null; onPick: (o: NudgeOpportunity | null) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<NudgeOpportunity[] | null>(null);
  const [searching, setSearching] = useState(false);

  const search = useCallback((query: string) => {
    setSearching(true);
    api.get<NudgeOpportunity[]>("/tenant/nudge/opportunities", { params: { q: query } })
      .then((r) => setResults(r.data))
      .catch(() => setResults([]))
      .finally(() => setSearching(false));
  }, []);

  useEffect(() => {
    if (value) return; // a deal is chosen - don't keep searching
    const t = setTimeout(() => search(q), 300);
    return () => clearTimeout(t);
  }, [q, value, search]);

  if (value) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-gold-700/40 bg-gold-500/[0.05] px-3 py-2">
        <span className="text-sm text-heading">{value.name ?? `Opportunity #${value.id}`}</span>
        {value.partner_name && <span className="text-xs text-body">· {value.partner_name}</span>}
        {value.stage_name && <span className="rounded-full border-2 border-ink-600 bg-ink-800 px-2 py-0.5 text-xs text-body">{value.stage_name}</span>}
        <button onClick={() => onPick(null)} className="ml-auto text-xs font-semibold text-gold-400 hover:text-gold-300">Change</button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <Label>Find an opportunity</Label>
        <button
          type="button"
          onClick={() => search(q)}
          disabled={searching}
          className="text-[11px] font-semibold text-gold-400 hover:text-gold-300 disabled:opacity-50"
        >
          {searching ? "Refreshing…" : "↻ Refresh"}
        </button>
      </div>
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by deal or customer name…" />
      {searching ? (
        <p className="mt-1 text-xs text-body">Searching...</p>
      ) : results && results.length > 0 ? (
        <div className="mt-2 grid max-h-56 gap-1 overflow-y-auto">
          {results.map((o) => (
            <button
              key={o.id}
              onClick={() => onPick(o)}
              className="flex min-h-11 items-center gap-2 rounded-[4px] border-2 border-ink-600 px-3 py-2 text-left hover:border-gold-500 hover:bg-ink-800"
            >
              <span className="text-sm text-heading">{o.name ?? `Opportunity #${o.id}`}</span>
              {o.partner_name && <span className="text-xs text-body">· {o.partner_name}</span>}
              {o.stage_name && <span className="ml-auto rounded-full border-2 border-ink-600 bg-ink-800 px-2 py-0.5 text-xs text-body">{o.stage_name}</span>}
            </button>
          ))}
        </div>
      ) : results ? (
        <p className="mt-1 text-xs text-warning-fg">No matching opportunities. Connect Odoo if this seems wrong.</p>
      ) : null}
    </div>
  );
}
