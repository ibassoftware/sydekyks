import { useEffect, useState } from "react";
import { api, type DecodeReadiness, type DecodeSettings, type EmailInboxOut, type LedgerReadiness } from "../../lib/api";
import { Button, Input, Label } from "../../components/ui";
import { GadgetRequirementList } from "../../components/GadgetRequirementList";
import { ReadinessList } from "../ReadinessList";
import type { SydekykSetupProps } from "../registry";

export function DecodeSettingsSection({ sydekyk, canManage, onReadiness }: SydekykSetupProps) {
  const [readiness, setReadiness] = useState<DecodeReadiness | null>(null);
  const [settings, setSettings] = useState<DecodeSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [inbox, setInbox] = useState<string | null>(null);
  const [creatingInbox, setCreatingInbox] = useState(false);

  useEffect(() => {
    api.get<DecodeReadiness>("/tenant/decode/readiness").then((r) => {
      setReadiness(r.data);
      onReadiness?.({ ...r.data } as LedgerReadiness);
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
          <p className="text-xs font-semibold uppercase tracking-wider text-gold-500">Parsing Settings</p>
          <label className="flex items-center gap-2 text-sm text-[#ede6da]">
            <input
              type="checkbox"
              className="h-4 w-4 accent-gold-500"
              disabled={!canManage || saving}
              checked={settings.auto_create_skills}
              onChange={(e) => save({ ...settings, auto_create_skills: e.target.checked })}
            />
            Auto-create missing skills in Odoo
          </label>
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
              Poll Odoo for new applicants (cron)
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
          </div>
        </div>
      )}

      <div id="email" className="grid gap-2 border-t border-ink-700 pt-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-gold-500">Email Intake (optional)</p>
        {inbox ? (
          <p className="text-sm text-[#ede6da]">Send résumés to <span className="font-semibold text-gold-300">{inbox}</span></p>
        ) : (
          <p className="text-sm text-[#8a7f6d]">Create an inbound address so emailed résumés become applicants automatically.</p>
        )}
        {canManage && (
          <Button variant="ghost" className="w-fit px-3 py-1.5 text-xs" disabled={creatingInbox} onClick={createInbox}>
            {creatingInbox ? "Creating…" : "Create Email Inbox"}
          </Button>
        )}
      </div>
    </div>
  );
}
