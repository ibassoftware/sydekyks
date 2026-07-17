import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { api, type QuillInsights, type QuillProposalSummary } from "../../lib/api";
import { formatFastTime, formatMoneyCompact } from "../../lib/format";
import { Button, Card } from "../../components/ui";
import { AgentCardHeader } from "../../components/AgentCardHeader";
import { useTenantCurrency } from "../../lib/useTenantCurrency";

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}

/** Quill dashboard card — proposals are the most token-intensive work, so it leads with tokens + AI
 * cost, then the time saved. Includes a ready "New proposal" quick action. */
export function QuillInsightsSection({ initialData }: { initialData?: QuillInsights | null } = {}) {
  const currency = useTenantCurrency();
  const navigate = useNavigate();
  const [data, setData] = useState<QuillInsights | null>(initialData ?? null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    api.get<QuillInsights>("/tenant/quill/insights").then((r) => setData(r.data)).catch(() => setData(null));
  }, []);
  useEffect(() => {
    if (initialData !== undefined) setData(initialData);
    else load();
  }, [initialData, load]);

  // The card appears once Quill is installed — even with zero proposals — so the New Proposal action is ready.
  if (!data || !data.activated) return null;

  async function newProposal() {
    setCreating(true);
    try {
      const r = await api.post<QuillProposalSummary>("/tenant/quill/proposals", { title: "Untitled proposal" });
      navigate(`/hq/quill/editor/${r.data.id}`);
    } catch {
      setCreating(false);
    }
  }

  return (
    <Card className="relative mt-6 overflow-hidden p-6">
      <div className="flex items-start justify-between gap-3">
        <AgentCardHeader slug="quill" name="Quill" kicker="Proposals · Live" />
        <Button className="shrink-0 px-3 py-1.5 text-xs" disabled={creating} onClick={newProposal}>
          {creating ? "…" : "+ New proposal"}
        </Button>
      </div>

      <div className="mt-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-[#8a7f6d]">AI tokens spent on proposals</p>
        <p className="mt-1 text-4xl font-bold text-[#f5eee0]">{fmtTokens(data.total_tokens)}</p>
        <p className="mt-2 text-sm font-medium text-gold-300">
          {data.proposals_created.toLocaleString()} proposal{data.proposals_created === 1 ? "" : "s"} drafted
          {data.revisions > 0 && <span className="font-normal text-[#8a7f6d]"> · {data.revisions.toLocaleString()} AI revisions</span>}
          {data.processing_seconds > 0 && <span className="font-normal text-[#8a7f6d]"> · {formatFastTime(data.processing_seconds)} of AI time</span>}
        </p>
        <p className="mt-1 text-xs text-[#8a7f6d]">
          <span className="font-semibold text-gold-300">{formatMoneyCompact(data.ai_cost, currency)}</span> AI cost
          {data.estimated_net_savings > 0 && (
            <span className="text-[#665c4c]"> · ~{formatMoneyCompact(data.estimated_net_savings, currency)} in writing time saved</span>
          )}
        </p>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat value={data.proposals_created.toLocaleString()} label="Proposals" accent />
        <Stat value={data.proposals_final.toLocaleString()} label="Finalised" />
        <Stat value={data.revisions.toLocaleString()} label="AI revisions" />
      </div>

      {data.top_customers.length > 0 && (
        <div className="mt-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#8a7f6d]">Top customers</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {data.top_customers.map((c) => (
              <span key={c.label} className="rounded-full border border-ink-600 bg-ink-800/60 px-2.5 py-0.5 text-xs text-[#d8cdb9]">
                {c.label} · {c.count}
              </span>
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
