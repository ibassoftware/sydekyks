import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api, type ShieldAlert, type ShieldInsights, type ShieldQueuePage } from "../../lib/api";
import { formatWorkTime, formatFastTime, formatMoney, formatMoneyCompact } from "../../lib/format";
import { useTenantCurrency } from "../../lib/useTenantCurrency";
import { Card } from "../../components/ui";
import { AgentCardHeader } from "../../components/AgentCardHeader";

function riskPill(score: number): string {
  return score >= 70
    ? "border-red-700/50 bg-red-500/10 text-red-300"
    : score >= 40
      ? "border-amber-700/50 bg-amber-500/10 text-amber-300"
      : "border-ink-600 bg-ink-800/60 text-[#b9ad98]";
}

/** Shield dashboard card — the ranked auditor review queue is the product. Advisory framing only:
 * "warrants review", confirm / clear, never an accusation. */
const PAGE = 3;

export function ShieldInsightsSection({ initialData, initialQueue }: { initialData?: ShieldInsights | null; initialQueue?: ShieldQueuePage | null } = {}) {
  const currency = useTenantCurrency();
  const [data, setData] = useState<ShieldInsights | null>(initialData ?? null);
  const [queue, setQueue] = useState<ShieldQueuePage | null>(initialQueue ?? null);
  const [offset, setOffset] = useState(0);

  const loadStats = useCallback(() => {
    api.get<ShieldInsights>("/tenant/shield/insights").then((r) => setData(r.data)).catch(() => setData(null));
  }, []);
  const loadQueue = useCallback((off: number) => {
    api.get<ShieldQueuePage>("/tenant/shield/queue", { params: { limit: PAGE, offset: off } })
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

  if (!data || !data.activated || data.total_assessed === 0) return null;

  async function decide(a: ShieldAlert, decision: "confirmed" | "cleared") {
    // On a false positive, suppress the strongest rule for this vendor so it stops firing.
    const rule_code = decision === "cleared" ? [...a.flags].sort((x, y) => y.weight - x.weight)[0]?.code : undefined;
    try {
      await api.post(`/tenant/shield/findings/${a.finding_id}/decision`, { decision, rule_code });
    } finally {
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
      <AgentCardHeader slug="shield" name="Shield" kicker="Fraud risk · Live" />

      <div className="mt-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-[#8a7f6d]">Exposure under review</p>
        <p className="mt-1 text-4xl font-bold text-[#f5eee0]">{formatMoney(data.exposure_amount, currency)}</p>
        <p className="mt-2 text-sm font-medium text-gold-300">
          {data.total_assessed.toLocaleString()} bills assessed in {formatFastTime(data.processing_seconds)}
          <span className="font-normal text-[#8a7f6d]">
            {" "}· ~{formatWorkTime(data.total_assessed * data.estimated_minutes_each)} by hand
          </span>
        </p>
        <p className="mt-1 text-xs text-[#8a7f6d]">
          Plus <span className="font-semibold text-gold-300">{formatMoneyCompact(data.estimated_net_savings, currency)}</span> in review time saved
          <span className="text-[#665c4c]"> ({formatMoneyCompact(data.estimated_manual_cost, currency)} manual − {formatMoneyCompact(data.ai_cost, currency)} AI)</span>
        </p>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat value={data.flagged_count.toLocaleString()} label="Warrant review" accent />
        <Stat value={data.holds_count.toLocaleString()} label="Hard-holds" />
        <Stat value={data.total_assessed.toLocaleString()} label="Bills assessed" />
      </div>

      {total > 0 && (
        <div className="mt-6">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#8a7f6d]">Auditor review queue</p>
            <span className="text-[11px] text-[#8a7f6d]">
              {offset + 1}–{Math.min(offset + PAGE, total)} of {total}
            </span>
          </div>
          <div className="mt-2 grid gap-2">
            {items.map((a) => (
              <div key={a.finding_id} className={`rounded-lg border px-3 py-2.5 ${a.hold ? "border-red-700/50 bg-red-500/[0.06]" : "border-ink-700"}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${riskPill(a.risk_score)}`}>
                    risk {a.risk_score}
                  </span>
                  {a.hold && <span className="rounded-full border border-red-700/50 bg-red-500/10 px-2 py-0.5 text-[11px] font-semibold text-red-300">HARD-HOLD</span>}
                  <span className="text-sm font-medium text-[#ede6da]">{a.vendor_name ?? "Vendor"}</span>
                  {a.ref && <span className="text-xs text-[#8a7f6d]">#{a.ref}</span>}
                  {a.amount != null && <span className="text-sm text-[#ede6da]">{a.currency} {a.amount.toFixed(2)}</span>}
                  {a.odoo_url && (
                    <a href={a.odoo_url} target="_blank" rel="noopener noreferrer" className="ml-auto shrink-0 text-xs font-semibold text-gold-400 hover:text-gold-300">
                      Open →
                    </a>
                  )}
                </div>
                {a.summary && <p className="mt-1 text-xs text-[#d8cdb9]">{a.summary}</p>}
                {a.flags.length > 0 && (
                  <ul className="mt-1 grid gap-0.5">
                    {a.flags.map((f) => (
                      <li key={f.code} className="text-[11px] text-[#8a7f6d]">• {f.label}{f.evidence ? ` — ${f.evidence}` : ""}</li>
                    ))}
                  </ul>
                )}
                <div className="mt-2 flex flex-wrap gap-2">
                  <DecisionBtn label="Confirm — escalate" tone="danger" onClick={() => decide(a, "confirmed")} />
                  <DecisionBtn label="Clear — false positive" tone="ghost" onClick={() => decide(a, "cleared")} />
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

      {data.top_rules.length > 0 && (
        <div className="mt-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#8a7f6d]">Signals firing most</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {data.top_rules.map((r) => (
              <span key={r.label} className="rounded-full border border-ink-600 bg-ink-800/60 px-2.5 py-1 text-xs text-[#d8cdb9]">
                {r.label} <span className="text-[#8a7f6d]">· {r.count}</span>
              </span>
            ))}
          </div>
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
