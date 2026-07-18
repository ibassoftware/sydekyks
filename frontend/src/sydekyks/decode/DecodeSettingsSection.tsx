import { useEffect, useState } from "react";
import { api, type DecodeReadiness, type DecodeSettings, type EmailInboxOut, type LedgerReadiness } from "../../lib/api";
import { Button, Input, Label } from "../../components/ui";
import { GadgetRequirementList } from "../../components/GadgetRequirementList";
import { ReadinessList } from "../ReadinessList";
import { useTenantCurrency } from "../../lib/useTenantCurrency";
import type { SydekykSetupProps } from "../registry";
import { SettingsBand, SettingsColumns, SettingsToggle } from "../SettingsLayout";

export function DecodeSettingsSection({ sydekyk, canManage, onReadiness }: SydekykSetupProps) {
  const currency = useTenantCurrency();
  const [readiness, setReadiness] = useState<DecodeReadiness | null>(null);
  const [settings, setSettings] = useState<DecodeSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [inbox, setInbox] = useState<string | null>(null);
  const [creatingInbox, setCreatingInbox] = useState(false);

  useEffect(() => {
    api.get<DecodeReadiness>("/tenant/decode/readiness").then((r) => {
      setReadiness(r.data);
      onReadiness?.({ ...r.data } as LedgerReadiness);
      // Reuse readiness to discover an already-assigned inbox address.
      const item = r.data.items.find((i) => i.key === "email_inbox");
      if (item?.state === "ok" && item.detail) setInbox(item.detail);
    });
    api.get<DecodeSettings>("/tenant/decode/settings").then((r) => setSettings(r.data));
  }, [sydekyk.id, onReadiness]);

  async function save(next: DecodeSettings) {
    setSaving(true);
    try {
      const r = await api.put<DecodeSettings>("/tenant/decode/settings", next);
      setSettings(r.data);
    } finally {
      setSaving(false);
    }
  }

  async function createInbox() {
    setCreatingInbox(true);
    try {
      const r = await api.post<EmailInboxOut>("/tenant/decode/email-inbox", { name: `${sydekyk.name} Inbox` });
      setInbox(r.data.inbound_address);
      api.get<DecodeReadiness>("/tenant/decode/readiness").then((rr) => setReadiness(rr.data));
    } finally {
      setCreatingInbox(false);
    }
  }

  return (
    <>
      <SettingsBand title="Readiness" description="What Decode can use now and anything that needs your attention.">
        {readiness ? <ReadinessList items={readiness.items} /> : <p className="text-sm text-body">Loading...</p>}
      </SettingsBand>

      <SettingsBand id="gadgets" title="Connections" description="Choose the Odoo recruitment workspace where Decode creates and updates applicants.">
        <GadgetRequirementList sydekykId={sydekyk.id} canManage={canManage} />
      </SettingsBand>

      {settings && (
        <SettingsBand title="Applicant processing" description="Control how Decode turns résumé data into structured Odoo applicant records.">
          <SettingsToggle
            label="Create missing skills in Odoo"
            description="Adds skills found in a résumé when they do not already exist in the recruitment catalog."
            disabled={!canManage || saving}
            checked={settings.auto_create_skills}
            onChange={(checked) => save({ ...settings, auto_create_skills: checked })}
          />
          <SettingsColumns>
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
              <Label>Pooling stage (optional)</Label>
              <Input
                disabled={!canManage || saving}
                value={settings.pooling_stage_name ?? ""}
                onChange={(e) => setSettings({ ...settings, pooling_stage_name: e.target.value })}
                onBlur={(e) => save({ ...settings, pooling_stage_name: e.target.value || null })}
              />
            </div>
            <div>
              <Label>Max résumé pages to scan</Label>
              <Input
                type="number"
                min={1}
                max={15}
                disabled={!canManage || saving}
                value={settings.max_resume_pages}
                onChange={(e) => setSettings({ ...settings, max_resume_pages: Number(e.target.value) })}
                onBlur={(e) => save({ ...settings, max_resume_pages: Number(e.target.value) })}
              />
            </div>
          </SettingsColumns>
          <div className="mt-5 border-t-2 border-ink-600 pt-2">
            <SettingsToggle
              label="Check Odoo for new applicants automatically"
              description="Runs every 15 minutes and processes applicants that have not yet received the processed tag."
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
        <SettingsBand title="Value assumptions" description="The business inputs behind Decode's time-saved and money-saved estimates.">
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
              <Label>Minutes to key one applicant in</Label>
              <Input
                type="number"
                min={0}
                step={0.5}
                disabled={!canManage || saving}
                value={settings.estimated_minutes_per_resume}
                onChange={(e) => setSettings({ ...settings, estimated_minutes_per_resume: Number(e.target.value) })}
                onBlur={(e) => save({ ...settings, estimated_minutes_per_resume: Number(e.target.value) })}
              />
            </div>
          </SettingsColumns>
        </SettingsBand>
      )}

      <SettingsBand id="email" title="Email intake" description="Optional inbound address for turning emailed résumés into applicant missions.">
        {inbox ? (
          <p className="text-sm text-heading">Send résumés to <code className="font-semibold text-gold-300">{inbox}</code></p>
        ) : (
          <p className="text-sm text-body">Create an inbound address so emailed résumés become applicants automatically.</p>
        )}
        {canManage && !inbox && (
          <Button variant="ghost" className="w-fit px-3 py-1.5 text-xs" disabled={creatingInbox} onClick={createInbox}>
            {creatingInbox ? "Creating…" : "Create Email Inbox"}
          </Button>
        )}
      </SettingsBand>
    </>
  );
}
