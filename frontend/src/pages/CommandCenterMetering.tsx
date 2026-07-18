import { useEffect, useState, type FormEvent } from "react";
import axios from "axios";
import {
  api,
  type MeteringConfig,
  type ModelRate,
  type PlanTier,
  type TenantUsageLimit,
} from "../lib/api";
import { Badge, Button, Card, Input, Label, Modal } from "../components/ui";

function fmt(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function UsageBar({ used, cap, throttled }: { used: number; cap: number; throttled: boolean }) {
  const pct = cap > 0 ? Math.min(100, (used / cap) * 100) : 0;
  const tone = throttled ? "bg-red-500" : pct > 80 ? "bg-amber-400" : "bg-gold-500";
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-700">
      <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export default function CommandCenterMetering() {
  const [tenants, setTenants] = useState<TenantUsageLimit[] | null>(null);
  const [tiers, setTiers] = useState<PlanTier[] | null>(null);
  const [config, setConfig] = useState<MeteringConfig | null>(null);
  const [rates, setRates] = useState<ModelRate[] | null>(null);
  const [editingTenant, setEditingTenant] = useState<TenantUsageLimit | null>(null);

  async function loadTenants() {
    const res = await api.get<TenantUsageLimit[]>("/admin/tenant-usage");
    setTenants(res.data);
  }

  useEffect(() => {
    loadTenants();
    api.get<PlanTier[]>("/admin/plan-tiers").then((r) => setTiers(r.data));
    api.get<MeteringConfig>("/admin/metering-config").then((r) => setConfig(r.data));
    api.get<ModelRate[]>("/admin/model-rates").then((r) => setRates(r.data));
  }, []);

  return (
    <>
      {/* --- AI Usage & Plans ------------------------------------------------ */}
      <div className="mt-12">
        <h2 className="text-2xl font-bold text-[#f5eee0]">AI Usage &amp; Plans</h2>
        <p className="mt-1 text-sm text-[#b9ad98]">
          Per-HQ token usage this month and GPU-seconds in the last hour, against each plan&apos;s caps. When a cap is
          reached, that HQ&apos;s AI requests are paused until the window frees.
        </p>
      </div>

      <Card className="mt-6 overflow-hidden">
        {!tenants ? (
          <p className="p-6 text-sm text-[#b9ad98]">Loading usage…</p>
        ) : tenants.length === 0 ? (
          <p className="p-6 text-sm text-[#b9ad98]">No HQs yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-ink-700 text-xs uppercase tracking-wider text-gold-500">
                <th className="px-6 py-3 font-semibold">HQ</th>
                <th className="px-6 py-3 font-semibold">Plan</th>
                <th className="px-6 py-3 font-semibold">Tokens / month</th>
                <th className="px-6 py-3 font-semibold">GPU-sec / hour</th>
                <th className="px-6 py-3 font-semibold"></th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => (
                <tr key={t.tenant_id} className="border-b border-ink-700/60 last:border-0">
                  <td className="px-6 py-3 font-medium text-[#f5eee0]">{t.tenant_name}</td>
                  <td className="px-6 py-3">
                    <div className="flex items-center gap-2">
                      <span className="text-[#ede6da]">{t.plan_display_name}</span>
                      {(t.monthly_token_cap_override !== null || t.gpu_seconds_per_hour_cap_override !== null) && (
                        <Badge tone="neutral">custom</Badge>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-3" style={{ minWidth: 180 }}>
                    <div className="flex items-center gap-2">
                      <span className="w-32 text-xs text-[#b9ad98]">
                        {fmt(t.tokens_used_this_month)} / {fmt(t.monthly_token_cap)}
                      </span>
                      {t.token_throttled && <Badge tone="danger">paused</Badge>}
                    </div>
                    <div className="mt-1 w-40">
                      <UsageBar used={t.tokens_used_this_month} cap={t.monthly_token_cap} throttled={t.token_throttled} />
                    </div>
                  </td>
                  <td className="px-6 py-3" style={{ minWidth: 180 }}>
                    <div className="flex items-center gap-2">
                      <span className="w-32 text-xs text-[#b9ad98]">
                        {fmt(t.gpu_seconds_used_last_hour)} / {fmt(t.gpu_seconds_per_hour_cap)}
                      </span>
                      {t.gpu_throttled && <Badge tone="danger">paused</Badge>}
                    </div>
                    <div className="mt-1 w-40">
                      <UsageBar
                        used={t.gpu_seconds_used_last_hour}
                        cap={t.gpu_seconds_per_hour_cap}
                        throttled={t.gpu_throttled}
                      />
                    </div>
                  </td>
                  <td className="px-6 py-3 text-right">
                    <Button variant="ghost" className="px-3 py-1.5 text-xs" onClick={() => setEditingTenant(t)}>
                      Edit Plan
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* --- Plan Tiers ------------------------------------------------------ */}
      <div className="mt-12">
        <h2 className="text-2xl font-bold text-[#f5eee0]">Plan Tiers</h2>
        <p className="mt-1 text-sm text-[#b9ad98]">
          Default caps per plan. Tune Legend to roughly &ldquo;$20 of GPT-5.5&rdquo; once real pricing is known.
        </p>
      </div>

      <Card className="mt-6 overflow-hidden">
        {!tiers ? (
          <p className="p-6 text-sm text-[#b9ad98]">Loading…</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-ink-700 text-xs uppercase tracking-wider text-gold-500">
                <th className="px-6 py-3 font-semibold">Plan</th>
                <th className="px-6 py-3 font-semibold">Monthly token cap</th>
                <th className="px-6 py-3 font-semibold">GPU-seconds / hour</th>
                <th className="px-6 py-3 font-semibold"></th>
              </tr>
            </thead>
            <tbody>
              {tiers.map((tier) => (
                <PlanTierRow key={tier.key} tier={tier} onSaved={(u) => setTiers((prev) => prev?.map((x) => (x.key === u.key ? u : x)) ?? null)} />
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* --- GPU Metering --------------------------------------------------- */}
      <div className="mt-12">
        <h2 className="text-2xl font-bold text-[#f5eee0]">GPU Metering</h2>
        <p className="mt-1 text-sm text-[#b9ad98]">
          GPU-seconds ={" "}
          <span className="text-[#ede6da]">multiplier × (prompt_tokens / prompt_rate + completion_tokens / generation_rate)</span>.
          Rates are global; each model carries its own multiplier (e.g. a heavier model is ×2).
        </p>
      </div>

      <Card className="mt-6 p-6">
        {config && <MeteringConfigForm config={config} onSaved={setConfig} />}
        <div className="mt-6 border-t border-ink-700 pt-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-gold-500">Per-model multipliers</p>
          {!rates ? (
            <p className="mt-3 text-sm text-[#b9ad98]">Loading…</p>
          ) : (
            <ModelRatesEditor rates={rates} onChange={setRates} />
          )}
        </div>
      </Card>

      <Modal open={!!editingTenant} onClose={() => setEditingTenant(null)}>
        {editingTenant && tiers && (
          <TenantPlanModal
            tenant={editingTenant}
            tiers={tiers}
            onClose={() => setEditingTenant(null)}
            onSaved={(updated) => {
              setTenants((prev) => prev?.map((x) => (x.tenant_id === updated.tenant_id ? updated : x)) ?? null);
              setEditingTenant(null);
            }}
          />
        )}
      </Modal>
    </>
  );
}

function PlanTierRow({ tier, onSaved }: { tier: PlanTier; onSaved: (t: PlanTier) => void }) {
  const [displayName, setDisplayName] = useState(tier.display_name);
  const [tokenCap, setTokenCap] = useState(String(tier.monthly_token_cap));
  const [gpuCap, setGpuCap] = useState(String(tier.gpu_seconds_per_hour_cap));
  const [saving, setSaving] = useState(false);
  const dirty =
    displayName !== tier.display_name ||
    Number(tokenCap) !== tier.monthly_token_cap ||
    Number(gpuCap) !== tier.gpu_seconds_per_hour_cap;

  async function save() {
    setSaving(true);
    try {
      const res = await api.put<PlanTier>(`/admin/plan-tiers/${tier.key}`, {
        display_name: displayName,
        monthly_token_cap: Number(tokenCap),
        gpu_seconds_per_hour_cap: Number(gpuCap),
      });
      onSaved(res.data);
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr className="border-b border-ink-700/60 last:border-0">
      <td className="px-6 py-3">
        <Input className="w-32 px-2 py-1.5 text-xs" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        <span className="ml-2 text-xs text-[#8a7f6d]">{tier.key}</span>
      </td>
      <td className="px-6 py-3">
        <Input className="w-32 px-2 py-1.5 text-xs" type="number" min={0} value={tokenCap} onChange={(e) => setTokenCap(e.target.value)} />
      </td>
      <td className="px-6 py-3">
        <Input className="w-28 px-2 py-1.5 text-xs" type="number" min={0} value={gpuCap} onChange={(e) => setGpuCap(e.target.value)} />
      </td>
      <td className="px-6 py-3 text-right">
        <Button className="px-3 py-1.5 text-xs" disabled={!dirty || saving} onClick={save}>
          {saving ? "…" : "Save"}
        </Button>
      </td>
    </tr>
  );
}

function MeteringConfigForm({ config, onSaved }: { config: MeteringConfig; onSaved: (c: MeteringConfig) => void }) {
  const [promptRate, setPromptRate] = useState(String(config.prompt_rate));
  const [genRate, setGenRate] = useState(String(config.generation_rate));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const dirty = Number(promptRate) !== config.prompt_rate || Number(genRate) !== config.generation_rate;

  async function save() {
    setSaving(true);
    setSaved(false);
    try {
      const res = await api.put<MeteringConfig>("/admin/metering-config", {
        prompt_rate: Number(promptRate),
        generation_rate: Number(genRate),
      });
      onSaved(res.data);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <div>
        <Label>Prompt rate (tokens / GPU-sec)</Label>
        <Input type="number" min={1} value={promptRate} onChange={(e) => { setPromptRate(e.target.value); setSaved(false); }} />
      </div>
      <div>
        <Label>Generation rate (tokens / GPU-sec)</Label>
        <Input type="number" min={1} value={genRate} onChange={(e) => { setGenRate(e.target.value); setSaved(false); }} />
      </div>
      <div className="flex items-center gap-2">
        <Button disabled={!dirty || saving} onClick={save}>
          {saving ? "Saving…" : "Save Rates"}
        </Button>
        {saved && <span className="text-xs font-semibold text-gold-400">Saved</span>}
      </div>
    </div>
  );
}

function ModelRatesEditor({ rates, onChange }: { rates: ModelRate[]; onChange: (r: ModelRate[]) => void }) {
  const [newModel, setNewModel] = useState("");
  const [newMult, setNewMult] = useState("1");
  const [busy, setBusy] = useState(false);

  async function upsert(model: string, multiplier: number) {
    const res = await api.put<ModelRate>("/admin/model-rates", { model, multiplier });
    const exists = rates.some((r) => r.model === res.data.model);
    onChange(exists ? rates.map((r) => (r.model === res.data.model ? res.data : r)) : [...rates, res.data]);
  }

  async function addNew(e: FormEvent) {
    e.preventDefault();
    if (!newModel.trim()) return;
    setBusy(true);
    try {
      await upsert(newModel.trim(), Number(newMult));
      setNewModel("");
      setNewMult("1");
    } finally {
      setBusy(false);
    }
  }

  async function remove(model: string) {
    await api.delete(`/admin/model-rates/${encodeURIComponent(model)}`);
    onChange(rates.filter((r) => r.model !== model));
  }

  return (
    <div className="mt-3 grid gap-2">
      {rates.length === 0 && (
        <p className="text-sm text-[#8a7f6d]">No per-model multipliers yet - models default to ×1.0.</p>
      )}
      {rates.map((r) => (
        <ModelRateRow key={r.model} rate={r} onSave={(m) => upsert(r.model, m)} onRemove={() => remove(r.model)} />
      ))}
      <form onSubmit={addNew} className="mt-2 flex items-end gap-2 border-t border-ink-700 pt-3">
        <div className="flex-1">
          <Label>Model</Label>
          <Input value={newModel} onChange={(e) => setNewModel(e.target.value)} placeholder="e.g. gpt-5.5 or a LiteLLM alias" />
        </div>
        <div className="w-24">
          <Label>Multiplier</Label>
          <Input type="number" min={0} step={0.5} value={newMult} onChange={(e) => setNewMult(e.target.value)} />
        </div>
        <Button type="submit" disabled={busy || !newModel.trim()}>
          {busy ? "…" : "Add"}
        </Button>
      </form>
    </div>
  );
}

function ModelRateRow({ rate, onSave, onRemove }: { rate: ModelRate; onSave: (m: number) => Promise<void>; onRemove: () => Promise<void> }) {
  const [mult, setMult] = useState(String(rate.multiplier));
  const [saving, setSaving] = useState(false);
  const dirty = Number(mult) !== rate.multiplier;

  return (
    <div className="flex items-center gap-2">
      <span className="min-w-0 flex-1 truncate text-sm text-[#ede6da]" title={rate.model}>
        {rate.model || <span className="italic text-[#8a7f6d]">(unnamed)</span>}
      </span>
      <span className="shrink-0 text-xs text-[#8a7f6d]">×</span>
      <div className="w-20 shrink-0">
        <Input className="px-2 py-1.5 text-xs" type="number" min={0} step={0.5} value={mult} onChange={(e) => setMult(e.target.value)} />
      </div>
      <Button
        className="shrink-0 px-3 py-1.5 text-xs"
        disabled={!dirty || saving}
        onClick={async () => {
          setSaving(true);
          try {
            await onSave(Number(mult));
          } finally {
            setSaving(false);
          }
        }}
      >
        {saving ? "…" : "Save"}
      </Button>
      <Button variant="ghost" className="shrink-0 px-2 py-1.5 text-xs" onClick={onRemove}>
        Remove
      </Button>
    </div>
  );
}

function TenantPlanModal({
  tenant,
  tiers,
  onClose,
  onSaved,
}: {
  tenant: TenantUsageLimit;
  tiers: PlanTier[];
  onClose: () => void;
  onSaved: (t: TenantUsageLimit) => void;
}) {
  const [plan, setPlan] = useState(tenant.plan);
  const [tokenOverride, setTokenOverride] = useState(tenant.monthly_token_cap_override?.toString() ?? "");
  const [gpuOverride, setGpuOverride] = useState(tenant.gpu_seconds_per_hour_cap_override?.toString() ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const selectedTier = tiers.find((t) => t.key === plan);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await api.put<TenantUsageLimit>(`/admin/tenants/${tenant.tenant_id}/plan`, {
        plan,
        monthly_token_cap_override: tokenOverride.trim() === "" ? null : Number(tokenOverride),
        gpu_seconds_per_hour_cap_override: gpuOverride.trim() === "" ? null : Number(gpuOverride),
      });
      onSaved(res.data);
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.data?.detail) setError(err.response.data.detail);
      else setError("Failed to save. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="border-gold-600/40 p-7 shadow-[0_0_60px_-12px_rgba(212,168,40,0.5)]">
      <h2 className="text-xl font-bold text-[#f5eee0]">Plan - {tenant.tenant_name}</h2>
      <p className="mt-1 text-sm text-[#8a7f6d]">
        Pick a plan tier, or override its caps for this HQ. Leave an override blank to inherit the plan default.
      </p>

      <form onSubmit={handleSubmit} className="mt-5 grid gap-4">
        <div>
          <Label>Plan</Label>
          <select
            className="w-full rounded-md border border-ink-600 bg-ink-900 px-3.5 py-2.5 text-sm text-[#ede6da] outline-none focus:border-gold-500 focus:ring-1 focus:ring-gold-500/50"
            value={plan}
            onChange={(e) => setPlan(e.target.value)}
          >
            {tiers.map((t) => (
              <option key={t.key} value={t.key}>
                {t.display_name}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label>Monthly token cap override</Label>
            <Input
              type="number"
              min={0}
              value={tokenOverride}
              onChange={(e) => setTokenOverride(e.target.value)}
              placeholder={selectedTier ? `Default ${fmt(selectedTier.monthly_token_cap)}` : "Plan default"}
            />
          </div>
          <div>
            <Label>GPU-seconds/hour override</Label>
            <Input
              type="number"
              min={0}
              value={gpuOverride}
              onChange={(e) => setGpuOverride(e.target.value)}
              placeholder={selectedTier ? `Default ${fmt(selectedTier.gpu_seconds_per_hour_cap)}` : "Plan default"}
            />
          </div>
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <div className="mt-2 flex items-center justify-end gap-3">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save Plan"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
