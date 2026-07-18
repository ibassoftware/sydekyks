import { useEffect, useState } from "react";
import { api, type LedgerReadiness, type SealReadiness, type SealSettings } from "../../lib/api";
import { Input, Label } from "../../components/ui";
import { GadgetRequirementList } from "../../components/GadgetRequirementList";
import { ReadinessList } from "../ReadinessList";
import { useTenantCurrency } from "../../lib/useTenantCurrency";
import type { SydekykSetupProps } from "../registry";
import { SettingsBand, SettingsColumns } from "../SettingsLayout";

export function SealSettingsSection({ sydekyk, canManage, onReadiness }: SydekykSetupProps) {
  const currency = useTenantCurrency();
  const [readiness, setReadiness] = useState<SealReadiness | null>(null);
  const [settings, setSettings] = useState<SealSettings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get<SealReadiness>("/tenant/seal/readiness").then((r) => {
      setReadiness(r.data);
      onReadiness?.({ ...r.data, last_inbound_email: null } as unknown as LedgerReadiness);
    });
    api.get<SealSettings>("/tenant/seal/settings").then((r) => setSettings(r.data));
  }, [sydekyk.id, onReadiness]);

  async function save(next: SealSettings) {
    setSaving(true);
    try {
      const r = await api.put<SealSettings>("/tenant/seal/settings", next);
      setSettings(r.data);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <SettingsBand title="Readiness" description="What Seal can use now and anything that needs your attention.">
        {readiness ? <ReadinessList items={readiness.items} /> : <p className="text-sm text-body">Loading...</p>}
      </SettingsBand>

      <SettingsBand id="gadgets" title="Connections" description="Optional Odoo context and Odoo Sign handoff for contract work.">
        <p className="mb-4 text-sm text-body">Seal can draft, review, and export contracts without Odoo.</p>
        <GadgetRequirementList sydekykId={sydekyk.id} canManage={canManage} />
      </SettingsBand>

      {settings && (
        <SettingsBand title="Review playbook" description="Your standard positions and risk tolerance for every clause review.">
          <textarea
            rows={6}
            maxLength={20000}
            disabled={!canManage || saving}
            defaultValue={settings.review_guidelines}
            onBlur={(e) => save({ ...settings, review_guidelines: e.target.value })}
            placeholder="e.g. Prefer a mutual, capped liability; no auto-renewal without notice; net-30 payment terms; our jurisdiction as governing law…"
            className="w-full rounded-[4px] border-2 border-ink-600 bg-ink-800 px-4 py-3 text-base text-heading focus:border-gold-500"
          />
        </SettingsBand>
      )}

      {settings && (
        <SettingsBand title="PDF and branding" description="Set the page format and identity applied to exported contracts.">
          <SettingsColumns>
            <div>
              <Label>Page size</Label>
              <select value={settings.page_size} disabled={!canManage || saving} onChange={(e) => save({ ...settings, page_size: e.target.value })} className="w-full rounded-[4px] border-2 border-ink-600 bg-ink-800 px-4 py-3 text-base text-heading focus:border-gold-500">
                <option value="A4">A4</option>
                <option value="Letter">Letter</option>
              </select>
            </div>
            <div>
              <Label>Accent colour (hex)</Label>
              <Input type="text" placeholder="#1e3a5f" maxLength={12} disabled={!canManage || saving} defaultValue={settings.accent_color ?? ""} onBlur={(e) => save({ ...settings, accent_color: e.target.value || null })} />
            </div>
          </SettingsColumns>
          <div className="mt-5">
            <Label>PDF header line (optional)</Label>
            <Input type="text" maxLength={300} placeholder="Acme Corp" disabled={!canManage || saving} defaultValue={settings.header_text ?? ""} onBlur={(e) => save({ ...settings, header_text: e.target.value || null })} />
          </div>
          <div>
            <Label>PDF footer line (optional)</Label>
            <Input type="text" maxLength={300} placeholder="Acme Corp · 123 Main St · legal@acme.com" disabled={!canManage || saving} defaultValue={settings.footer_text ?? ""} onBlur={(e) => save({ ...settings, footer_text: e.target.value || null })} />
          </div>
        </SettingsBand>
      )}

      {settings && (
        <SettingsBand title="Value assumptions" description="The business inputs behind Seal's time-saved and money-saved estimates.">
          <SettingsColumns>
            <div>
              <Label>Hourly wage ({currency})</Label>
              <Input type="number" min={0} step={0.5} disabled={!canManage || saving} value={settings.estimated_hourly_wage} onChange={(e) => setSettings({ ...settings, estimated_hourly_wage: Number(e.target.value) })} onBlur={(e) => save({ ...settings, estimated_hourly_wage: Number(e.target.value) })} />
            </div>
            <div>
              <Label>Minutes to draft & review one contract by hand</Label>
              <Input type="number" min={0} step={1} disabled={!canManage || saving} value={settings.estimated_minutes_per_contract} onChange={(e) => setSettings({ ...settings, estimated_minutes_per_contract: Number(e.target.value) })} onBlur={(e) => save({ ...settings, estimated_minutes_per_contract: Number(e.target.value) })} />
            </div>
          </SettingsColumns>
        </SettingsBand>
      )}
    </>
  );
}
