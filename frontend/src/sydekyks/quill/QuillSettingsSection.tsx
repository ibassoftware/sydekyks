import { useEffect, useState } from "react";
import { api, type LedgerReadiness, type QuillReadiness, type QuillSettings } from "../../lib/api";
import { Input, Label } from "../../components/ui";
import { GadgetRequirementList } from "../../components/GadgetRequirementList";
import { ReadinessList } from "../ReadinessList";
import { useTenantCurrency } from "../../lib/useTenantCurrency";
import type { SydekykSetupProps } from "../registry";
import { SettingsBand, SettingsColumns } from "../SettingsLayout";

export function QuillSettingsSection({ sydekyk, canManage, onReadiness }: SydekykSetupProps) {
  const currency = useTenantCurrency();
  const [readiness, setReadiness] = useState<QuillReadiness | null>(null);
  const [settings, setSettings] = useState<QuillSettings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get<QuillReadiness>("/tenant/quill/readiness").then((r) => {
      setReadiness(r.data);
      onReadiness?.({ ...r.data, last_inbound_email: null } as unknown as LedgerReadiness);
    });
    api.get<QuillSettings>("/tenant/quill/settings").then((r) => setSettings(r.data));
  }, [sydekyk.id, onReadiness]);

  async function save(next: QuillSettings) {
    setSaving(true);
    try {
      const r = await api.put<QuillSettings>("/tenant/quill/settings", next);
      setSettings(r.data);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <SettingsBand title="Readiness" description="What Quill can use now and anything that needs your attention.">
        {readiness ? <ReadinessList items={readiness.items} /> : <p className="text-sm text-body">Loading...</p>}
      </SettingsBand>

      <SettingsBand id="gadgets" title="Connections" description="Optional Odoo handoff for creating sales quotations and merging their PDFs.">
        <p className="mb-4 text-sm text-body">Quill can draft and export proposals without Odoo.</p>
        <GadgetRequirementList sydekykId={sydekyk.id} canManage={canManage} />
      </SettingsBand>

      {settings && (
        <SettingsBand title="PDF and branding" description="Set the default page format and identity applied to exported proposals.">
          <SettingsColumns>
            <div>
              <Label>Page size</Label>
              <select
                value={settings.page_size}
                disabled={!canManage || saving}
                onChange={(e) => save({ ...settings, page_size: e.target.value })}
                className="w-full rounded-[4px] border-2 border-ink-600 bg-ink-800 px-4 py-3 text-base text-heading focus:border-gold-500"
              >
                <option value="A4">A4</option>
                <option value="Letter">Letter</option>
              </select>
            </div>
            <div>
              <Label>Accent colour (hex)</Label>
              <Input
                type="text" placeholder="#8a6d1a" maxLength={12}
                disabled={!canManage || saving}
                defaultValue={settings.accent_color ?? ""}
                onBlur={(e) => save({ ...settings, accent_color: e.target.value || null })}
              />
            </div>
          </SettingsColumns>
          <div className="mt-5">
            <Label>PDF header line (optional)</Label>
            <Input
              type="text" maxLength={300} placeholder="Acme Corp"
              disabled={!canManage || saving}
              defaultValue={settings.header_text ?? ""}
              onBlur={(e) => save({ ...settings, header_text: e.target.value || null })}
            />
            <p className="mt-2 text-xs text-body">Runs along the top of every exported page with the proposal title on the right.</p>
          </div>
          <div>
            <Label>PDF footer line (optional)</Label>
            <Input
              type="text" maxLength={300} placeholder="Acme Corp · 123 Main St · sales@acme.com"
              disabled={!canManage || saving}
              defaultValue={settings.footer_text ?? ""}
              onBlur={(e) => save({ ...settings, footer_text: e.target.value || null })}
            />
            <p className="mt-2 text-xs text-body">Appears at the bottom-left of every exported page. Page numbers sit at the bottom-right.</p>
          </div>
        </SettingsBand>
      )}

      {settings && (
        <SettingsBand title="Value assumptions" description="The business inputs behind Quill's time-saved and money-saved estimates.">
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
              <Label>Minutes to write one proposal by hand</Label>
              <Input
                type="number" min={0} step={1}
                disabled={!canManage || saving}
                value={settings.estimated_minutes_per_proposal}
                onChange={(e) => setSettings({ ...settings, estimated_minutes_per_proposal: Number(e.target.value) })}
                onBlur={(e) => save({ ...settings, estimated_minutes_per_proposal: Number(e.target.value) })}
              />
            </div>
          </SettingsColumns>
        </SettingsBand>
      )}
    </>
  );
}
