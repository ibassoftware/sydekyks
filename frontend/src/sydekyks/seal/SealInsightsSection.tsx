import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { api, type SealContractSummary, type SealInsights } from "../../lib/api";
import { formatFastTime, formatMoneyCompact } from "../../lib/format";
import { Button, Card } from "../../components/ui";
import { AgentCardHeader } from "../../components/AgentCardHeader";
import { useTenantCurrency } from "../../lib/useTenantCurrency";

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}

/** Seal dashboard card — leads with tokens + AI cost, then the AI-only value: contracts reviewed and
 * high-severity clauses caught (the risk a template tool would have shipped unnoticed). */
export function SealInsightsSection({ initialData }: { initialData?: SealInsights | null } = {}) {
  const currency = useTenantCurrency();
  const navigate = useNavigate();
  const [data, setData] = useState<SealInsights | null>(initialData ?? null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    api.get<SealInsights>("/tenant/seal/insights").then((r) => setData(r.data)).catch(() => setData(null));
  }, []);
  useEffect(() => {
    if (initialData !== undefined) setData(initialData);
    else load();
  }, [initialData, load]);

  if (!data || !data.activated) return null;

  async function newContract() {
    setCreating(true);
    try {
      const r = await api.post<SealContractSummary>("/tenant/seal/contracts", { title: "Untitled contract" });
      navigate(`/hq/seal/editor/${r.data.id}`);
    } catch { setCreating(false); }
  }

  return (
    <Card className="relative mt-6 overflow-hidden p-6">
      <div className="flex items-start justify-between gap-3">
        <AgentCardHeader slug="seal" name="Seal" kicker="Contracts · Live" />
        <Button className="shrink-0 px-3 py-1.5 text-xs" disabled={creating} onClick={newContract}>{creating ? "…" : "+ New contract"}</Button>
      </div>

      <div className="mt-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-[#8a7f6d]">AI tokens spent on contracts</p>
        <p className="mt-1 text-4xl font-bold text-[#f5eee0]">{fmtTokens(data.total_tokens)}</p>
        <p className="mt-2 text-sm font-medium text-gold-300">
          {data.contracts_created.toLocaleString()} contract{data.contracts_created === 1 ? "" : "s"} drafted
          {data.revisions > 0 && <span className="font-normal text-[#8a7f6d]"> · {data.revisions.toLocaleString()} AI revisions</span>}
          {data.processing_seconds > 0 && <span className="font-normal text-[#8a7f6d]"> · {formatFastTime(data.processing_seconds)} of AI time</span>}
        </p>
        <p className="mt-1 text-xs text-[#8a7f6d]">
          <span className="font-semibold text-gold-300">{formatMoneyCompact(data.ai_cost, currency)}</span> AI cost
          {data.estimated_net_savings > 0 && <span className="text-[#665c4c]"> · ~{formatMoneyCompact(data.estimated_net_savings, currency)} in drafting time saved</span>}
        </p>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat value={data.contracts_reviewed.toLocaleString()} label="Reviewed" accent />
        <Stat value={data.high_severity_caught.toLocaleString()} label="High-severity caught" />
        <Stat value={data.redlines_accepted.toLocaleString()} label="Redlines accepted" />
      </div>

      {data.top_counterparties.length > 0 && (
        <div className="mt-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#8a7f6d]">Top counterparties</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {data.top_counterparties.map((c) => (
              <span key={c.label} className="rounded-full border border-ink-600 bg-ink-800/60 px-2.5 py-0.5 text-xs text-[#d8cdb9]">{c.label} · {c.count}</span>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function Stat({ value, label, accent }: { value: ReactNode; label: string; accent?: boolean }) {
  return (
    <div className="rounded-[4px] border-2 border-ink-700 bg-ink-900/50 p-4">
      <p className={`text-2xl font-bold ${accent ? "text-gold-300" : "text-heading"}`}>{value}</p>
      <p className="mt-1 text-xs text-body">{label}</p>
    </div>
  );
}
