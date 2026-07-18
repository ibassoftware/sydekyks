import { useEffect, useState } from "react";
import { api, type LedgerReadiness, type MirrorReadiness, type MirrorSettings, type RecurringPattern } from "../../lib/api";
import { Input, Label } from "../../components/ui";
import { GadgetRequirementList } from "../../components/GadgetRequirementList";
import { ReadinessList } from "../ReadinessList";
import { useTenantCurrency } from "../../lib/useTenantCurrency";
import type { SydekykSetupProps } from "../registry";
import { SettingsBand, SettingsColumns, SettingsToggle } from "../SettingsLayout";

export function MirrorSettingsSection({ sydekyk, canManage, onReadiness }: SydekykSetupProps) {
  const currency = useTenantCurrency();
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
    <>
      <SettingsBand title="Readiness" description="What Mirror can use now and anything that needs your attention.">
        {readiness ? <ReadinessList items={readiness.items} /> : <p className="text-sm text-body">Loading...</p>}
      </SettingsBand>

      <SettingsBand id="gadgets" title="Connections" description="Choose the Odoo accounting workspace whose vendor bills Mirror should inspect.">
        <GadgetRequirementList sydekykId={sydekyk.id} canManage={canManage} />
      </SettingsBand>

      {settings && (
        <SettingsBand title="Detection policy" description="Control which bills Mirror compares and how strongly a possible duplicate must match.">
          <SettingsToggle
            label="Include draft bills"
            description="Checks unposted bills as well as posted vendor bills."
            disabled={!canManage || saving}
            checked={settings.include_drafts}
            onChange={(checked) => save({ ...settings, include_drafts: checked })}
          />
          <SettingsColumns>
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
          </SettingsColumns>
          <div className="mt-5 border-t-2 border-ink-600 pt-2">
            <SettingsToggle
              label="Check new bills automatically"
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
        <SettingsBand title="Value assumptions" description="Inputs for time and money saved. Prevented duplicate payments are tracked separately.">
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
              <Label>Minutes to check one bill</Label>
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

      <SettingsBand title="Recurring vendors" description="Legitimate repeated bills that Mirror should check but never flag.">
        <p className="text-sm text-body">
          Bills matching these patterns are checked but never flagged - for legitimately identical recurring bills (rent,
          subscriptions). Add one by marking a flagged bill “Recurring” on the Dashboard.
        </p>
        {recurring.length === 0 ? (
          <p className="mt-4 text-sm text-body">No recurring vendor patterns yet.</p>
        ) : (
          <div className="mt-4 divide-y-2 divide-ink-600 overflow-hidden rounded-[4px] border-2 border-ink-600 bg-ink-900">
            {recurring.map((r) => (
              <div key={r.id} className="flex items-center gap-3 px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-sm text-heading">{r.vendor_name ?? `Vendor #${r.partner_id}`}</span>
                <span className="shrink-0 text-xs text-body">{r.amount != null ? r.amount.toFixed(2) : "any amount"}</span>
                {canManage && (
                  <button onClick={() => removeRecurring(r.id)} className="min-h-11 shrink-0 text-xs font-semibold text-danger-strong hover:text-heading">
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </SettingsBand>
    </>
  );
}
