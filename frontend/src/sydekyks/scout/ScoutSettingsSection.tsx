import { useEffect, useState } from "react";
import { api, type LedgerReadiness, type RunNowResult, type ScoutReadiness, type ScoutSettings } from "../../lib/api";
import { Button, Input, Label } from "../../components/ui";
import { GadgetRequirementList } from "../../components/GadgetRequirementList";
import { ReadinessList } from "../ReadinessList";
import type { SydekykSetupProps } from "../registry";

export function ScoutSettingsSection({ sydekyk, canManage, onReadiness }: SydekykSetupProps) {
  const [readiness, setReadiness] = useState<ScoutReadiness | null>(null);
  const [settings, setSettings] = useState<ScoutSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [runMsg, setRunMsg] = useState<string | null>(null);

  useEffect(() => {
    api.get<ScoutReadiness>("/tenant/scout/readiness").then((r) => {
      setReadiness(r.data);
      onReadiness?.({ ...r.data, last_inbound_email: null } as LedgerReadiness);
    });
    api.get<ScoutSettings>("/tenant/scout/settings").then((r) => setSettings(r.data));
  }, [sydekyk.id, onReadiness]);

  async function save(next: ScoutSettings) {
    setSaving(true);
    try {
      const r = await api.put<ScoutSettings>("/tenant/scout/settings", next);
      setSettings(r.data);
    } finally {
      setSaving(false);
    }
  }

  async function runNow() {
    setRunning(true);
    setRunMsg(null);
    try {
      const r = await api.post<RunNowResult>("/tenant/scout/run-now");
      setRunMsg(r.data.queued === 0 ? "No un-scored applicants found." : `Queued ${r.data.queued} applicant(s) for scoring.`);
    } catch {
      setRunMsg("Couldn't start a run. Check the Odoo connection.");
    } finally {
      setRunning(false);
    }
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

      <div className="grid gap-2 border-t border-ink-700 pt-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-gold-500">Score Now</p>
        <p className="text-sm text-[#8a7f6d]">Score every applicant that hasn't been scored yet (up to your per-run cap).</p>
        {canManage && (
          <Button className="w-fit px-4 py-2 text-xs" disabled={running || !readiness?.can_upload} onClick={runNow}>
            {running ? "Starting…" : "Run Scout now"}
          </Button>
        )}
        {runMsg && <p className="text-xs text-gold-400">{runMsg}</p>}
      </div>

      {settings && (
        <div className="grid gap-3 border-t border-ink-700 pt-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-gold-500">Scoring Settings</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Processed tag</Label>
              <Input
                disabled={!canManage || saving}
                value={settings.processed_tag_name}
                onChange={(e) => setSettings({ ...settings, processed_tag_name: e.target.value })}
                onBlur={(e) => save({ ...settings, processed_tag_name: e.target.value })}
              />
            </div>
            <div>
              <Label>Needs-review below score</Label>
              <Input
                type="number"
                min={0}
                max={100}
                disabled={!canManage || saving}
                value={settings.min_score_threshold}
                onChange={(e) => setSettings({ ...settings, min_score_threshold: Number(e.target.value) })}
                onBlur={(e) => save({ ...settings, min_score_threshold: Number(e.target.value) })}
              />
            </div>
          </div>
          <div>
            <Label>Scoring rubric (optional)</Label>
            <textarea
              className="w-full rounded-md border border-ink-600 bg-ink-900 px-3 py-2 text-sm text-[#ede6da] outline-none focus:border-gold-500"
              rows={3}
              disabled={!canManage || saving}
              placeholder="Extra criteria for the scorer, e.g. 'prioritize React + TypeScript; must be onsite'"
              value={settings.scoring_rubric ?? ""}
              onChange={(e) => setSettings({ ...settings, scoring_rubric: e.target.value })}
              onBlur={(e) => save({ ...settings, scoring_rubric: e.target.value || null })}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <label className="flex items-center gap-2 text-sm text-[#ede6da]">
              <input
                type="checkbox"
                className="h-4 w-4 accent-gold-500"
                disabled={!canManage || saving}
                checked={settings.cron_enabled}
                onChange={(e) => save({ ...settings, cron_enabled: e.target.checked })}
              />
              Score new applicants automatically (cron)
            </label>
            <div>
              <Label>Per-run cap (max 30)</Label>
              <Input
                type="number"
                min={1}
                max={30}
                disabled={!canManage || saving}
                value={settings.cron_poll_limit}
                onChange={(e) => setSettings({ ...settings, cron_poll_limit: Number(e.target.value) })}
                onBlur={(e) => save({ ...settings, cron_poll_limit: Number(e.target.value) })}
              />
            </div>
          </div>
          <p className="text-xs text-[#8a7f6d]">The cron requires the background worker to be running.</p>
        </div>
      )}

      {settings && (
        <div className="grid gap-3 border-t border-ink-700 pt-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-gold-500">Estimated Savings</p>
          <p className="-mt-1 text-xs text-[#8a7f6d]">Powers the “$ saved” metric on your Dashboard.</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Hourly wage ($)</Label>
              <Input
                type="number"
                min={0}
                step={0.5}
                disabled={!canManage || saving}
                value={settings.estimated_hourly_wage}
                onChange={(e) => setSettings({ ...settings, estimated_hourly_wage: Number(e.target.value) })}
                onBlur={(e) => save({ ...settings, estimated_hourly_wage: Number(e.target.value) })}
              />
            </div>
            <div>
              <Label>Minutes to screen one candidate</Label>
              <Input
                type="number"
                min={0}
                step={0.5}
                disabled={!canManage || saving}
                value={settings.estimated_minutes_per_candidate}
                onChange={(e) => setSettings({ ...settings, estimated_minutes_per_candidate: Number(e.target.value) })}
                onBlur={(e) => save({ ...settings, estimated_minutes_per_candidate: Number(e.target.value) })}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
