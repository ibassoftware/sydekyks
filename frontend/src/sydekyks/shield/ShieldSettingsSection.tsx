import { useEffect, useState } from "react";
import { api, type LedgerReadiness, type ShieldReadiness, type ShieldSettings } from "../../lib/api";
import { Input, Label } from "../../components/ui";
import { GadgetRequirementList } from "../../components/GadgetRequirementList";
import { ReadinessList } from "../ReadinessList";
import { useTenantCurrency } from "../../lib/useTenantCurrency";
import type { SydekykSetupProps } from "../registry";
import { SettingsBand, SettingsColumns, SettingsToggle } from "../SettingsLayout";

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
    <>
      <SettingsBand title="Readiness" description="What Shield can use now and anything that needs your attention.">
        {readiness ? <ReadinessList items={readiness.items} /> : <p className="text-sm text-body">Loading...</p>}
      </SettingsBand>

      <SettingsBand id="gadgets" title="Connections" description="Choose the Odoo accounting workspace whose vendor bills Shield should assess.">
        <GadgetRequirementList sydekykId={sydekyk.id} canManage={canManage} />
      </SettingsBand>

      {settings && (
        <SettingsBand title="Risk policy" description="Set the thresholds Shield uses to surface risk for human review. Shield never accuses.">
          <SettingsColumns>
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
          </SettingsColumns>
          <div className="mt-5 border-t-2 border-ink-600 pt-2">
            <SettingsToggle
              label="Assess new bills automatically"
              description="Runs every 15 minutes and looks back up to five days after an interruption."
              disabled={!canManage || saving}
              checked={settings.cron_enabled}
              onChange={(checked) => save({ ...settings, cron_enabled: checked })}
            />
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
        </SettingsBand>
      )}

      {settings && (
        <SettingsBand title="Value assumptions" description="The business inputs behind Shield's time-saved and money-saved estimates.">
          <SettingsColumns>
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
          </SettingsColumns>
        </SettingsBand>
      )}
    </>
  );
}
