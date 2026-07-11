import { useEffect, useState } from "react";
import { api, type LedgerReadiness, type MirrorReadiness, type MirrorSettings, type RecurringPattern } from "../../lib/api";
import { Button, Input, Label } from "../../components/ui";
import { GadgetRequirementList } from "../../components/GadgetRequirementList";
import { ReadinessList } from "../ReadinessList";
import type { SydekykSetupProps } from "../registry";

export function MirrorSettingsSection({ sydekyk, canManage, onReadiness }: SydekykSetupProps) {
  const [readiness, setReadiness] = useState<MirrorReadiness | null>(null);
  const [settings, setSettings] = useState<MirrorSettings | null>(null);
  const [recurring, setRecurring] = useState<RecurringPattern[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get<MirrorReadiness>("/tenant/mirror/readiness").then((r) => {
      setReadiness(r.data);
      onReadiness?.({ ...r.data, last_inbound_email: null } as LedgerReadiness);
    });
    api.get<MirrorSettings>("/tenant/mirror/settings").then((r) => setSettings(r.data));
    api.get<RecurringPattern[]>("/tenant/mirror/recurring").then((r) => setRecurring(r.data));
  }, [sydekyk.id, onReadiness]);

  async function save(next: MirrorSettings) {
    setSaving(true);
    try {
      const r = await api.put<MirrorSettings>("/tenant/mirror/settings", next);
      setSettings(r.data);
    } finally {
      setSaving(false);
    }
  }

  async function removeRecurring(id: string) {
    await api.delete(`/tenant/mirror/recurring/${id}`);
    setRecurring((rows) => rows.filter((r) => r.id !== id));
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
          <p className="text-xs font-semibold uppercase tracking-wider text-gold-500">Detection Settings</p>
          <label className="flex items-center gap-2 text-sm text-[#ede6da]">
            <input
              type="checkbox"
              className="h-4 w-4 accent-gold-500"
              disabled={!canManage || saving}
              checked={settings.include_drafts}
              onChange={(e) => save({ ...settings, include_drafts: e.target.checked })}
            />
            Include draft (unposted) bills
          </label>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Same-amount date window (days)</Label>
              <Input
                type="number" min={0} max={120}
                disabled={!canManage || saving}
                value={settings.date_window_days}
                onChange={(e) => setSettings({ ...settings, date_window_days: Number(e.target.value) })}
                onBlur={(e) => save({ ...settings, date_window_days: Number(e.target.value) })}
              />
            </div>
            <div>
              <Label>Flag at confidence ≥</Label>
              <Input
                type="number" min={0} max={100}
                disabled={!canManage || saving}
                value={settings.flag_threshold}
                onChange={(e) => setSettings({ ...settings, flag_threshold: Number(e.target.value) })}
                onBlur={(e) => save({ ...settings, flag_threshold: Number(e.target.value) })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <label className="flex items-center gap-2 text-sm text-[#ede6da]">
              <input
                type="checkbox" className="h-4 w-4 accent-gold-500"
                disabled={!canManage || saving}
                checked={settings.cron_enabled}
                onChange={(e) => save({ ...settings, cron_enabled: e.target.checked })}
              />
              Check new bills automatically (cron)
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
          </div>
          <p className="text-xs text-[#8a7f6d]">The cron scans forward from the last check (max 5 days back) and needs the background worker running.</p>
        </div>
      )}

      {settings && (
        <div className="grid gap-3 border-t border-ink-700 pt-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-gold-500">Estimated Savings</p>
          <p className="-mt-1 text-xs text-[#8a7f6d]">Powers the “time saved” metric on your Dashboard (double-payments prevented is tracked separately).</p>
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
              <Label>Minutes to check one bill</Label>
              <Input
                type="number" min={0} step={0.5}
                disabled={!canManage || saving}
                value={settings.estimated_minutes_per_review}
                onChange={(e) => setSettings({ ...settings, estimated_minutes_per_review: Number(e.target.value) })}
                onBlur={(e) => save({ ...settings, estimated_minutes_per_review: Number(e.target.value) })}
              />
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-2 border-t border-ink-700 pt-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-gold-500">Recurring (whitelisted) vendors</p>
        <p className="-mt-1 text-xs text-[#8a7f6d]">
          Bills matching these patterns are checked but never flagged — for legitimately identical recurring bills (rent,
          subscriptions). Add one by marking a flagged bill “Recurring” on the Dashboard.
        </p>
        {recurring.length === 0 ? (
          <p className="text-sm text-[#8a7f6d]">None yet.</p>
        ) : (
          <div className="mt-1 divide-y divide-ink-700/60 overflow-hidden rounded-lg border border-ink-700">
            {recurring.map((r) => (
              <div key={r.id} className="flex items-center gap-3 px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-sm text-[#ede6da]">{r.vendor_name ?? `Vendor #${r.partner_id}`}</span>
                <span className="shrink-0 text-xs text-[#8a7f6d]">{r.amount != null ? r.amount.toFixed(2) : "any amount"}</span>
                {canManage && (
                  <button onClick={() => removeRecurring(r.id)} className="shrink-0 text-xs font-semibold text-red-400 hover:text-red-300">
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
