import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api, type MirrorFlag, type MirrorFlagPage, type MirrorInsights } from "../../lib/api";
import { formatWorkTime, formatFastTime, formatMoney, formatMoneyCompact } from "../../lib/format";
import { Card } from "../../components/ui";
import { AgentCardHeader } from "../../components/AgentCardHeader";
import { useTenantCurrency } from "../../lib/useTenantCurrency";

const PAGE = 3;

/** Mirror dashboard card — double-payments prevented ($) up top, then the PAGED review queue of
 * duplicates awaiting a decision (confirm / dismiss / mark-recurring — the learning loop). */
export function MirrorInsightsSection({ initialData, initialQueue }: { initialData?: MirrorInsights | null; initialQueue?: MirrorFlagPage | null } = {}) {
  const currency = useTenantCurrency();
  const [data, setData] = useState<MirrorInsights | null>(initialData ?? null);
  const [queue, setQueue] = useState<MirrorFlagPage | null>(initialQueue ?? null);
  const [offset, setOffset] = useState(0);

  const loadStats = useCallback(() => {
    api.get<MirrorInsights>("/tenant/mirror/insights").then((r) => setData(r.data)).catch(() => setData(null));
  }, []);
  const loadQueue = useCallback((off: number) => {
    api.get<MirrorFlagPage>("/tenant/mirror/flags", { params: { limit: PAGE, offset: off } })
      .then((r) => setQueue(r.data)).catch(() => setQueue(null));
  }, []);

  useEffect(() => {
    if (initialData !== undefined) setData(initialData);
    else loadStats();
  }, [initialData, loadStats]);
  useEffect(() => {
    if (offset === 0 && initialQueue !== undefined) setQueue(initialQueue);
    else loadQueue(offset);
  }, [initialQueue, loadQueue, offset]);

  if (!data || !data.activated || data.total_checked === 0) return null;

  async function decide(f: MirrorFlag, decision: "confirmed_duplicate" | "not_duplicate" | "recurring") {
    try {
      await api.post(`/tenant/mirror/findings/${f.finding_id}/decision`, { decision });
    } finally {
      // The item leaves the pending queue; step back a page if we just emptied a later one.
      const remaining = (queue?.items.length ?? 1) - 1;
      if (remaining <= 0 && offset >= PAGE) setOffset(offset - PAGE);
      else loadQueue(offset);
      loadStats();
    }
  }

  const items = queue?.items ?? [];
  const total = queue?.total ?? 0;

  return (
    <Card className="relative mt-6 overflow-hidden p-6">
      <AgentCardHeader slug="mirror" name="Mirror" kicker="Duplicate bills · Live" />

      <div className="mt-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-[#8a7f6d]">Double-payments prevented</p>
        <p className="mt-1 text-4xl font-bold text-[#f5eee0]">{formatMoney(data.prevented_amount, currency)}</p>
        <p className="mt-2 text-sm font-medium text-gold-300">
          {data.total_checked.toLocaleString()} bills checked in {formatFastTime(data.processing_seconds)}
          <span className="font-normal text-[#8a7f6d]">
            {" "}· ~{formatWorkTime(data.total_checked * data.estimated_minutes_each)} by hand
          </span>
        </p>
        <p className="mt-1 text-xs text-[#8a7f6d]">
          Plus <span className="font-semibold text-gold-300">{formatMoneyCompact(data.estimated_net_savings, currency)}</span> in review time saved
          <span className="text-[#665c4c]"> ({formatMoneyCompact(data.estimated_manual_cost, currency)} manual − {formatMoneyCompact(data.ai_cost, currency)} AI)</span>
        </p>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat value={data.duplicates_found.toLocaleString()} label="Duplicates caught" accent />
        <Stat value={data.total_checked.toLocaleString()} label="Bills checked" />
        <Stat value={data.suppressed_count.toLocaleString()} label="Recurring (suppressed)" />
      </div>

      {total > 0 && (
        <div className="mt-6">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#8a7f6d]">Review queue</p>
            <span className="text-[11px] text-[#8a7f6d]">
              {offset + 1}–{Math.min(offset + PAGE, total)} of {total}
            </span>
          </div>
          <div className="mt-2 grid gap-2">
            {items.map((f) => (
              <div key={f.finding_id} className="rounded-lg border border-ink-700 px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-red-700/50 bg-red-500/10 px-2 py-0.5 text-[11px] font-semibold text-red-300">
                    {f.confidence}%
                  </span>
                  <span className="text-sm font-medium text-[#ede6da]">{f.vendor_name ?? "Vendor"}</span>
                  {f.ref && <span className="text-xs text-[#8a7f6d]">#{f.ref}</span>}
                  {f.amount != null && <span className="text-sm text-[#ede6da]">{f.currency} {f.amount.toFixed(2)}</span>}
                  {f.tier && <span className="text-[11px] text-[#8a7f6d]">· {f.tier}</span>}
                  {f.odoo_url && (
                    <a href={f.odoo_url} target="_blank" rel="noopener noreferrer" className="ml-auto shrink-0 text-xs font-semibold text-gold-400 hover:text-gold-300">
                      Open →
                    </a>
                  )}
                </div>
                {f.reasons.length > 0 && <p className="mt-1 text-xs text-[#8a7f6d]">{f.reasons.join("; ")}</p>}
                <div className="mt-2 flex flex-wrap gap-2">
                  <DecisionBtn label="Confirm duplicate" tone="danger" onClick={() => decide(f, "confirmed_duplicate")} />
                  <DecisionBtn label="Not a duplicate" tone="ghost" onClick={() => decide(f, "not_duplicate")} />
                  <DecisionBtn label="Recurring — stop flagging" tone="ghost" onClick={() => decide(f, "recurring")} />
                </div>
              </div>
            ))}
          </div>
          {total > PAGE && (
            <div className="mt-3 flex items-center justify-end gap-2">
              <PagerBtn disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>← Prev</PagerBtn>
              <PagerBtn disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>Next →</PagerBtn>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function Stat({ value, label, accent }: { value: string; label: string; accent?: boolean }) {
  return (
    <div className="rounded-[4px] border-2 border-ink-700 bg-ink-900/50 p-4">
      <p className={`text-2xl font-bold ${accent ? "text-gold-300" : "text-heading"}`}>{value}</p>
      <p className="mt-1 text-xs text-body">{label}</p>
    </div>
  );
}

function DecisionBtn({ label, tone, onClick }: { label: string; tone: "danger" | "ghost"; onClick: () => void }) {
  const cls =
    tone === "danger"
      ? "border-red-700/50 bg-red-500/10 text-red-300 hover:bg-red-500/20"
      : "border-ink-600 bg-ink-800/60 text-[#b9ad98] hover:bg-ink-700";
  return (
    <button onClick={onClick} className={`rounded-md border px-2.5 py-1 text-xs font-semibold ${cls}`}>
      {label}
    </button>
  );
}

function PagerBtn({ disabled, onClick, children }: { disabled: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className="rounded-md border border-ink-600 bg-ink-800/60 px-2.5 py-1 text-xs font-semibold text-[#b9ad98] hover:bg-ink-700 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}
