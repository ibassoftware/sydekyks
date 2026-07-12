import { useEffect, useState } from "react";
import { api, type LedgerReadiness, type ShieldReadiness, type ShieldSettings } from "../../lib/api";
import { Input, Label } from "../../components/ui";
import { GadgetRequirementList } from "../../components/GadgetRequirementList";
import { ReadinessList } from "../ReadinessList";
import { useTenantCurrency } from "../../lib/useTenantCurrency";
import type { SydekykSetupProps } from "../registry";

export function ShieldSettingsSection({ sydekyk, canManage, onReadiness }: SydekykSetupProps) {
  const currency = useTenantCurrency();
  const [readiness, setReadiness] = useState<ShieldReadiness | null>(null);
  const [settings, setSettings] = useState<ShieldSettings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get<ShieldReadiness>("/tenant/shield/readiness").then((r) => {
      setReadiness(r.data);
      onReadiness?.({ ...r.data, last_inbound_email: null } as LedgerReadiness);
    });
    api.get<ShieldSettings>("/tenant/shield/settings").then((r) => setSettings(r.data));
  }, [sydekyk.id, onReadiness]);

  async function save(next: ShieldSettings) {
    setSaving(true);
    try {
      const r = await api.put<ShieldSettings>("/tenant/shield/settings", next);
      setSettings(r.data);
    } finally {
      setSaving(false);
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

      {settings && (
        <div className="grid gap-3 border-t border-ink-700 pt-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-gold-500">Risk Settings</p>
          <p className="-mt-1 text-xs text-[#8a7f6d]">Shield surfaces risk for a human auditor to judge — it never accuses.</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Recent-change window (days)</Label>
              <Input
                type="number" min={1} max={90}
                disabled={!canManage || saving}
                value={settings.recent_change_days}
                onChange={(e) => setSettings({ ...settings, recent_change_days: Number(e.target.value) })}
                onBlur={(e) => save({ ...settings, recent_change_days: Number(e.target.value) })}
              />
            </div>
            <div>
              <Label>New-vendor high-amount ({currency})</Label>
              <Input
                type="number" min={0} step={100}
                disabled={!canManage || saving}
                value={settings.high_amount_threshold}
                onChange={(e) => setSettings({ ...settings, high_amount_threshold: Number(e.target.value) })}
                onBlur={(e) => save({ ...settings, high_amount_threshold: Number(e.target.value) })}
              />
            </div>
            <div>
              <Label>Queue for review at risk ≥</Label>
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
              Assess new bills automatically (cron)
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
          <p className="-mt-1 text-xs text-[#8a7f6d]">Powers the “time saved” metric on your Dashboard.</p>
          <div className="grid grid-cols-2 gap-4">
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
              <Label>Minutes to review one bill</Label>
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
    </div>
  );
}
