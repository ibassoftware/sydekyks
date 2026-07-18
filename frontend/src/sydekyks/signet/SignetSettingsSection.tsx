import { useEffect, useState } from "react";
import { api, type LedgerReadiness, type SignetReadiness, type SignetSettings } from "../../lib/api";
import { Input, Label } from "../../components/ui";
import { GadgetRequirementList } from "../../components/GadgetRequirementList";
import { ReadinessList } from "../ReadinessList";
import { useTenantCurrency } from "../../lib/useTenantCurrency";
import type { SydekykSetupProps } from "../registry";
import { SettingsBand, SettingsColumns } from "../SettingsLayout";

export function SignetSettingsSection({ sydekyk, canManage, onReadiness }: SydekykSetupProps) {
  const currency = useTenantCurrency();
  const [readiness, setReadiness] = useState<SignetReadiness | null>(null);
  const [settings, setSettings] = useState<SignetSettings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get<SignetReadiness>("/tenant/signet/readiness").then((r) => {
      setReadiness(r.data);
      onReadiness?.({ ...r.data, last_inbound_email: null } as unknown as LedgerReadiness);
    });
    api.get<SignetSettings>("/tenant/signet/settings").then((r) => setSettings(r.data));
  }, [sydekyk.id, onReadiness]);

  async function save(next: SignetSettings) {
    setSaving(true);
    try {
      const r = await api.put<SignetSettings>("/tenant/signet/settings", next);
      setSettings(r.data);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <SettingsBand title="Readiness" description="What Signet can use now and anything that needs your attention.">
        {readiness ? <ReadinessList items={readiness.items} /> : <p className="text-sm text-body">Loading...</p>}
      </SettingsBand>

      <SettingsBand id="gadgets" title="Connections" description="Optional Odoo handoff for attaching completed documents back to business records.">
        <p className="mb-4 text-sm text-body">Signet can send and track signatures without Odoo.</p>
        <GadgetRequirementList sydekykId={sydekyk.id} canManage={canManage} />
      </SettingsBand>

      {settings && (
        <SettingsBand title="Signing defaults" description="Set the sender identity, reminder cadence, and expiration policy for new envelopes.">
          <SettingsColumns>
            <div>
              <Label>Sender name (on invitations)</Label>
              <Input type="text" maxLength={120} disabled={!canManage || saving} defaultValue={settings.sender_name ?? ""} onBlur={(e) => save({ ...settings, sender_name: e.target.value || null })} placeholder="Acme Corp Legal" />
            </div>
            <div>
              <Label>Reminder every (days)</Label>
              <Input type="number" min={1} max={60} disabled={!canManage || saving} value={settings.reminder_interval_days} onChange={(e) => setSettings({ ...settings, reminder_interval_days: Number(e.target.value) })} onBlur={(e) => save({ ...settings, reminder_interval_days: Number(e.target.value) })} />
            </div>
            <div>
              <Label>Max reminders</Label>
              <Input type="number" min={0} max={20} disabled={!canManage || saving} value={settings.max_reminders} onChange={(e) => setSettings({ ...settings, max_reminders: Number(e.target.value) })} onBlur={(e) => save({ ...settings, max_reminders: Number(e.target.value) })} />
            </div>
            <div>
              <Label>Expire after (days)</Label>
              <Input type="number" min={1} max={365} disabled={!canManage || saving} value={settings.expiry_days} onChange={(e) => setSettings({ ...settings, expiry_days: Number(e.target.value) })} onBlur={(e) => save({ ...settings, expiry_days: Number(e.target.value) })} />
            </div>
          </SettingsColumns>
          <div className="mt-5">
            <Label>Email copy</Label>
            <select value={settings.email_copy_mode} disabled={!canManage || saving} onChange={(e) => save({ ...settings, email_copy_mode: e.target.value as "template" | "ai" })} className="w-full rounded-[4px] border-2 border-ink-600 bg-ink-800 px-4 py-3 text-base text-heading focus:border-gold-500">
              <option value="template">Fixed template (no AI)</option>
              <option value="ai">AI-written (personalised)</option>
            </select>
          </div>
          {settings.email_copy_mode === "ai" && (
            <div className="mt-5">
              <Label>Default “what to say” prompt (optional)</Label>
              <textarea rows={2} maxLength={2000} disabled={!canManage || saving} defaultValue={settings.email_prompt} onBlur={(e) => save({ ...settings, email_prompt: e.target.value })} placeholder="e.g. Warm and brief; mention the Q3 renewal deadline." className="w-full rounded-[4px] border-2 border-ink-600 bg-ink-800 px-4 py-3 text-base text-heading focus:border-gold-500" />
            </div>
          )}
        </SettingsBand>
      )}

      {settings && (
        <SettingsBand title="Value assumptions" description="The business inputs behind Signet's time-saved and money-saved estimates.">
          <SettingsColumns>
            <div>
              <Label>Hourly wage ({currency})</Label>
              <Input type="number" min={0} step={0.5} disabled={!canManage || saving} value={settings.estimated_hourly_wage} onChange={(e) => setSettings({ ...settings, estimated_hourly_wage: Number(e.target.value) })} onBlur={(e) => save({ ...settings, estimated_hourly_wage: Number(e.target.value) })} />
            </div>
            <div>
              <Label>Minutes to chase one signature by hand</Label>
              <Input type="number" min={0} step={1} disabled={!canManage || saving} value={settings.estimated_minutes_per_signature} onChange={(e) => setSettings({ ...settings, estimated_minutes_per_signature: Number(e.target.value) })} onBlur={(e) => save({ ...settings, estimated_minutes_per_signature: Number(e.target.value) })} />
            </div>
          </SettingsColumns>
        </SettingsBand>
      )}
    </>
  );
}
