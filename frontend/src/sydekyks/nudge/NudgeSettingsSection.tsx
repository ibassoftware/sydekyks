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
import type { SydekykSetupProps } from "../registry";

export function NudgeSettingsSection({ sydekyk, canManage, onReadiness }: SydekykSetupProps) {
  const [readiness, setReadiness] = useState<NudgeReadiness | null>(null);
  const [settings, setSettings] = useState<NudgeSettings | null>(null);
  const [stages, setStages] = useState<NudgeStage[] | null>(null);
  const [stagesLoading, setStagesLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadStages = useCallback(() => {
    // Live CRM stages — best-effort; only available once Odoo is connected (hence the refresh button).
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
        : [...others, { stage_id: stageId, days }];
    save({ ...settings, stage_thresholds: next });
  }

  return (
    <div className="grid gap-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-gold-500">Readiness</p>
        <div className="mt-3">{readiness ? <ReadinessList items={readiness.items} /> : <p className="text-sm text-[#8a7f6d]">Loading…</p>}</div>
      </div>

      <div id="gadgets" className="border-t border-ink-700 pt-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-gold-500">Integrations</p>
        <div className="mt-3">
          <GadgetRequirementList sydekykId={sydekyk.id} canManage={canManage} />
        </div>
      </div>

      {settings && (
        <div className="grid gap-3 border-t border-ink-700 pt-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-gold-500">When is an opportunity “stale”?</p>
          <p className="-mt-1 text-xs text-[#8a7f6d]">
            Days of silence before Nudge drafts a follow-up. A fresh lead should tolerate less silence than a
            late-stage negotiation — set a per-stage override below, or leave a stage blank to use the default.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Default silence threshold (days)</Label>
              <Input
                type="number" min={1} max={180}
                disabled={!canManage || saving}
                value={settings.default_stale_days}
                onChange={(e) => setSettings({ ...settings, default_stale_days: Number(e.target.value) })}
                onBlur={(e) => save({ ...settings, default_stale_days: Number(e.target.value) })}
              />
            </div>
            <div>
              <Label>Don’t nudge same deal more than once per (days)</Label>
              <Input
                type="number" min={1} max={90}
                disabled={!canManage || saving}
                value={settings.cadence_days}
                onChange={(e) => setSettings({ ...settings, cadence_days: Number(e.target.value) })}
                onBlur={(e) => save({ ...settings, cadence_days: Number(e.target.value) })}
              />
            </div>
          </div>

          <div className="mt-2">
            <div className="flex items-center justify-between">
              <Label>Per-stage overrides</Label>
              <button
                type="button"
                onClick={loadStages}
                disabled={stagesLoading}
                className="text-[11px] font-semibold text-gold-400 hover:text-gold-300 disabled:opacity-50"
              >
                {stagesLoading ? "Refreshing…" : "↻ Refresh stages"}
              </button>
            </div>
            {stages === null || stagesLoading ? (
              <p className="mt-2 text-xs text-[#8a7f6d]">Loading stages…</p>
            ) : stages.filter((s) => !s.is_won).length > 0 ? (
              <div className="mt-2 grid gap-2">
                {stages.filter((s) => !s.is_won).map((s) => (
                  <div key={s.id} className="flex items-center gap-3">
                    <span className="min-w-0 flex-1 truncate text-sm text-[#d8cdb9]">{s.name ?? `Stage ${s.id}`}</span>
                    <Input
                      type="number" min={1} max={180}
                      className="w-24"
                      placeholder={String(settings.default_stale_days)}
                      disabled={!canManage || saving}
                      defaultValue={thresholdFor(s.id)}
                      onBlur={(e) => setThreshold(s.id, e.target.value)}
                    />
                    <span className="text-xs text-[#8a7f6d]">days</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-xs text-amber-400/90">
                No CRM stages found. Connect &amp; test the Odoo instance above, then hit Refresh.
              </p>
            )}
          </div>
        </div>
      )}

      {settings && (
        <div className="grid gap-3 border-t border-ink-700 pt-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-gold-500">Automation</p>
          <div className="grid grid-cols-2 gap-4">
            <label className="flex items-center gap-2 text-sm text-[#ede6da]">
              <input
                type="checkbox" className="h-4 w-4 accent-gold-500"
                disabled={!canManage || saving}
                checked={settings.cron_enabled}
                onChange={(e) => save({ ...settings, cron_enabled: e.target.checked })}
              />
              Check the pipeline automatically (cron)
            </label>
            <div>
              <Label>Per-run cap (max 30)</Label>
              <Input
                type="number" min={1} max={30}
                disabled={!canManage || saving}
                value={settings.cron_poll_limit}
                onChange={(e) => setSettings({ ...settings, cron_poll_limit: Number(e.target.value) })}
                onBlur={(e) => save({ ...settings, cron_poll_limit: Number(e.target.value) })}
              />
            </div>
            <div>
              <Label>Follow-up To-Do due in (days)</Label>
              <Input
                type="number" min={0} max={30}
                disabled={!canManage || saving}
                value={settings.activity_days}
                onChange={(e) => setSettings({ ...settings, activity_days: Number(e.target.value) })}
                onBlur={(e) => save({ ...settings, activity_days: Number(e.target.value) })}
              />
            </div>
          </div>
          <p className="text-xs text-[#8a7f6d]">The cron needs the background worker running. Nudge always drafts — it never sends on the rep’s behalf.</p>
        </div>
      )}

      {settings && (
        <div className="grid gap-3 border-t border-ink-700 pt-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-gold-500">Estimated Savings</p>
          <p className="-mt-1 text-xs text-[#8a7f6d]">Powers the “time saved” metric on your Dashboard.</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Hourly wage ($)</Label>
              <Input
                type="number" min={0} step={0.5}
                disabled={!canManage || saving}
                value={settings.estimated_hourly_wage}
                onChange={(e) => setSettings({ ...settings, estimated_hourly_wage: Number(e.target.value) })}
                onBlur={(e) => save({ ...settings, estimated_hourly_wage: Number(e.target.value) })}
              />
            </div>
            <div>
              <Label>Minutes to write one follow-up by hand</Label>
              <Input
                type="number" min={0} step={0.5}
                disabled={!canManage || saving}
                value={settings.estimated_minutes_per_followup}
                onChange={(e) => setSettings({ ...settings, estimated_minutes_per_followup: Number(e.target.value) })}
                onBlur={(e) => save({ ...settings, estimated_minutes_per_followup: Number(e.target.value) })}
              />
            </div>
          </div>
        </div>
      )}

      <SnoozeManager canManage={canManage} />
    </div>
  );
}

/** Paused-deal memory: the "don't nag a deal that's legitimately quiet" trap-guard. Deals are picked
 * from real Odoo opportunities (searchable), never by typing an id. */
function SnoozeManager({ canManage }: { canManage: boolean }) {
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
      <p className="-mt-1 text-xs text-[#8a7f6d]">
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
              <span className="text-sm text-[#ede6da]">{r.opp_name ?? `Opportunity #${r.odoo_lead_id}`}</span>
              <span className="rounded-full border border-ink-600 bg-ink-800/60 px-2 py-0.5 text-[11px] text-[#b9ad98]">
                {r.snooze_until ? `until ${r.snooze_until}` : "never nudge"}
              </span>
              {r.note && <span className="truncate text-xs text-[#8a7f6d]">{r.note}</span>}
              {canManage && (
                <button onClick={() => remove(r.id)} className="ml-auto shrink-0 text-xs font-semibold text-red-300/80 hover:text-red-300">
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-[#8a7f6d]">No paused deals — Nudge is watching the whole open pipeline.</p>
      )}
    </div>
  );
}

/** Debounced search over open Odoo opportunities; pick one to act on (never type an id). */
function OpportunityPicker({ value, onPick }: { value: NudgeOpportunity | null; onPick: (o: NudgeOpportunity | null) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<NudgeOpportunity[] | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (value) return; // a deal is chosen — don't keep searching
    const t = setTimeout(() => {
      setSearching(true);
      api.get<NudgeOpportunity[]>("/tenant/nudge/opportunities", { params: { q } })
        .then((r) => setResults(r.data))
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(t);
  }, [q, value]);

  if (value) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-gold-700/40 bg-gold-500/[0.05] px-3 py-2">
        <span className="text-sm text-[#ede6da]">{value.name ?? `Opportunity #${value.id}`}</span>
        {value.partner_name && <span className="text-xs text-[#8a7f6d]">· {value.partner_name}</span>}
        {value.stage_name && <span className="rounded-full border border-ink-600 bg-ink-800/60 px-2 py-0.5 text-[11px] text-[#b9ad98]">{value.stage_name}</span>}
        <button onClick={() => onPick(null)} className="ml-auto text-xs font-semibold text-gold-400 hover:text-gold-300">Change</button>
      </div>
    );
  }

  return (
    <div>
      <Label>Find an opportunity</Label>
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by deal or customer name…" />
      {searching ? (
        <p className="mt-1 text-xs text-[#8a7f6d]">Searching…</p>
      ) : results && results.length > 0 ? (
        <div className="mt-2 grid max-h-56 gap-1 overflow-y-auto">
          {results.map((o) => (
            <button
              key={o.id}
              onClick={() => onPick(o)}
              className="flex items-center gap-2 rounded-md border border-ink-700 px-3 py-1.5 text-left hover:border-gold-500/50 hover:bg-ink-800/60"
            >
              <span className="text-sm text-[#ede6da]">{o.name ?? `Opportunity #${o.id}`}</span>
              {o.partner_name && <span className="text-xs text-[#8a7f6d]">· {o.partner_name}</span>}
              {o.stage_name && <span className="ml-auto rounded-full border border-ink-600 bg-ink-800/60 px-2 py-0.5 text-[11px] text-[#b9ad98]">{o.stage_name}</span>}
            </button>
          ))}
        </div>
      ) : results ? (
        <p className="mt-1 text-xs text-amber-400/90">No matching opportunities (connect Odoo if this seems wrong).</p>
      ) : null}
    </div>
  );
}
