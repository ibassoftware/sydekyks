import { useEffect, useState } from "react";
import { api, type LedgerReadiness, type ScoutReadiness, type ScoutSettings } from "../../lib/api";
import { Input, Label } from "../../components/ui";
import { GadgetRequirementList } from "../../components/GadgetRequirementList";
import { ReadinessList } from "../ReadinessList";
import { useTenantCurrency } from "../../lib/useTenantCurrency";
import type { SydekykSetupProps } from "../registry";
import { SettingsBand, SettingsColumns, SettingsToggle } from "../SettingsLayout";

export function ScoutSettingsSection({ sydekyk, canManage, onReadiness }: SydekykSetupProps) {
  const currency = useTenantCurrency();
  const [readiness, setReadiness] = useState<ScoutReadiness | null>(null);
  const [settings, setSettings] = useState<ScoutSettings | null>(null);
  const [saving, setSaving] = useState(false);

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

  return (
    <>
      <SettingsBand title="Readiness" description="What Scout can use now and anything that needs your attention.">
        {readiness ? <ReadinessList items={readiness.items} /> : <p className="text-sm text-body">Loading...</p>}
      </SettingsBand>

      <SettingsBand id="gadgets" title="Connections" description="Choose the Odoo recruitment workspace whose applicants Scout should score.">
        <GadgetRequirementList sydekykId={sydekyk.id} canManage={canManage} />
      </SettingsBand>

      {settings && (
        <SettingsBand title="Scoring policy" description="Control how Scout identifies processed applicants and schedules new scoring work.">
          <p className="text-sm text-body">
            Scout scores each candidate against their job position in Odoo - its description, requirements, expected degree,
            and expected skills. Tune the criteria by editing the job position in Odoo.
          </p>
          <div className="mt-5 max-w-md">
            <div>
              <Label>Processed tag</Label>
              <Input
                disabled={!canManage || saving}
                value={settings.processed_tag_name}
                onChange={(e) => setSettings({ ...settings, processed_tag_name: e.target.value })}
                onBlur={(e) => save({ ...settings, processed_tag_name: e.target.value })}
              />
            </div>
          </div>
          <div className="mt-5 border-t-2 border-ink-600 pt-2">
            <SettingsToggle
              label="Score new applicants automatically"
              description="Checks Odoo every 15 minutes for applicants that have not received the processed tag."
              disabled={!canManage || saving}
              checked={settings.cron_enabled}
              onChange={(checked) => save({ ...settings, cron_enabled: checked })}
            />
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
        </SettingsBand>
      )}

      {settings && (
        <SettingsBand title="Value assumptions" description="The business inputs behind Scout's time-saved and money-saved estimates.">
          <SettingsColumns>
            <div>
              <Label>Hourly wage ({currency})</Label>
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
          </SettingsColumns>
        </SettingsBand>
      )}
    </>
  );
}
