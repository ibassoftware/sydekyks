import { useEffect, useState } from "react";
import { api, type LedgerReadiness, type QuillReadiness, type QuillSettings } from "../../lib/api";
import { Input, Label } from "../../components/ui";
import { GadgetRequirementList } from "../../components/GadgetRequirementList";
import { ReadinessList } from "../ReadinessList";
import { useTenantCurrency } from "../../lib/useTenantCurrency";
import type { SydekykSetupProps } from "../registry";

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
    <div className="grid gap-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-gold-500">Readiness</p>
        <div className="mt-3">{readiness ? <ReadinessList items={readiness.items} /> : <p className="text-sm text-[#8a7f6d]">Loading…</p>}</div>
      </div>

      <div id="gadgets" className="border-t border-ink-700 pt-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-gold-500">Integrations (optional)</p>
        <p className="-mt-0.5 mb-3 mt-1 text-xs text-[#8a7f6d]">Odoo is only needed to raise a sales quotation and merge its PDF. Quill drafts and exports without it.</p>
        <GadgetRequirementList sydekykId={sydekyk.id} canManage={canManage} />
      </div>

      {settings && (
        <div className="grid gap-3 border-t border-ink-700 pt-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-gold-500">PDF & Branding</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Page size</Label>
              <select
                value={settings.page_size}
                disabled={!canManage || saving}
                onChange={(e) => save({ ...settings, page_size: e.target.value })}
                className="w-full rounded-md border border-ink-600 bg-ink-900 px-3 py-2.5 text-sm text-[#ede6da] outline-none focus:border-gold-500"
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
          </div>
          <div>
            <Label>PDF footer line (optional)</Label>
            <Input
              type="text" maxLength={300} placeholder="Acme Corp · 123 Main St · sales@acme.com"
              disabled={!canManage || saving}
              defaultValue={settings.footer_text ?? ""}
              onBlur={(e) => save({ ...settings, footer_text: e.target.value || null })}
            />
            <p className="mt-1 text-[11px] text-[#8a7f6d]">Appears at the bottom-left of every exported page; page numbers sit at the bottom-right.</p>
          </div>
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
              <Label>Minutes to write one proposal by hand</Label>
              <Input
                type="number" min={0} step={1}
                disabled={!canManage || saving}
                value={settings.estimated_minutes_per_proposal}
                onChange={(e) => setSettings({ ...settings, estimated_minutes_per_proposal: Number(e.target.value) })}
                onBlur={(e) => save({ ...settings, estimated_minutes_per_proposal: Number(e.target.value) })}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
