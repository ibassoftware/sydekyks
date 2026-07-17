import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api, type NudgeInsights, type NudgeItem, type NudgeQueuePage } from "../../lib/api";
import { formatWorkTime, formatFastTime, formatMoney, formatMoneyCompact } from "../../lib/format";
import { Card } from "../../components/ui";
import { AgentCardHeader } from "../../components/AgentCardHeader";
import { useTenantCurrency } from "../../lib/useTenantCurrency";

/** Nudge dashboard card — the ranked "value-at-risk" follow-up queue is the product. Each row carries
 * the AI's draft for the rep to lift; sent / dismiss feeds the learning loop. */
const PAGE = 3;

export function NudgeInsightsSection({ initialData, initialQueue }: { initialData?: NudgeInsights | null; initialQueue?: NudgeQueuePage | null } = {}) {
  const currency = useTenantCurrency();
  const [data, setData] = useState<NudgeInsights | null>(initialData ?? null);
  const [queue, setQueue] = useState<NudgeQueuePage | null>(initialQueue ?? null);
  const [offset, setOffset] = useState(0);

  const loadStats = useCallback(() => {
    api.get<NudgeInsights>("/tenant/nudge/insights").then((r) => setData(r.data)).catch(() => setData(null));
  }, []);
  const loadQueue = useCallback((off: number) => {
    api.get<NudgeQueuePage>("/tenant/nudge/queue", { params: { limit: PAGE, offset: off } })
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

  if (!data || !data.activated || data.followups_drafted === 0) return null;

  async function decide(it: NudgeItem, decision: "sent" | "dismissed") {
    try {
      await api.post(`/tenant/nudge/findings/${it.finding_id}/decision`, { decision });
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
      <AgentCardHeader slug="nudge" name="Nudge" kicker="Sales follow-up · Live" />

      <div className="mt-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-[#8a7f6d]">Revenue at risk from silence</p>
        <p className="mt-1 text-4xl font-bold text-[#f5eee0]">{formatMoney(data.value_at_risk_total, currency)}</p>
        <p className="mt-2 text-sm font-medium text-gold-300">
          {data.followups_drafted.toLocaleString()} follow-ups drafted in {formatFastTime(data.processing_seconds)}
          <span className="font-normal text-[#8a7f6d]">
            {" "}· ~{formatWorkTime(data.followups_drafted * data.estimated_minutes_each)} by hand
          </span>
        </p>
        <p className="mt-1 text-xs text-[#8a7f6d]">
          Plus <span className="font-semibold text-gold-300">{formatMoneyCompact(data.estimated_net_savings, currency)}</span> in follow-up time saved
          <span className="text-[#665c4c]"> ({formatMoneyCompact(data.estimated_manual_cost, currency)} manual − {formatMoneyCompact(data.ai_cost, currency)} AI)</span>
        </p>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat value={`${data.coverage_pct}%`} label="Follow-ups never missed" accent />
        <Stat value={data.stale_caught.toLocaleString()} label="Stale deals caught" />
        <Stat value={data.open_total.toLocaleString()} label="Open opportunities" />
      </div>

      {total > 0 && (
        <div className="mt-6">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#8a7f6d]">Follow-up queue · highest value at risk</p>
            <span className="text-[11px] text-[#8a7f6d]">
              {offset + 1}–{Math.min(offset + PAGE, total)} of {total}
            </span>
          </div>
          <div className="mt-2 grid gap-2">
            {items.map((it) => (
              <div key={it.finding_id} className={`rounded-lg border px-3 py-2.5 ${it.overdue ? "border-amber-700/50 bg-amber-500/[0.06]" : "border-ink-700"}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-ink-600 bg-ink-800/60 px-2 py-0.5 text-[11px] font-semibold text-[#b9ad98]">
                    silent {it.days_stale}d
                  </span>
                  {it.stage_name && <span className="rounded-full border border-ink-600 bg-ink-800/60 px-2 py-0.5 text-[11px] text-[#b9ad98]">{it.stage_name}</span>}
                  <span className="text-sm font-medium text-[#ede6da]">{it.opp_name ?? "Opportunity"}</span>
                  {it.partner_name && <span className="text-xs text-[#8a7f6d]">· {it.partner_name}</span>}
                  {it.expected_revenue != null && it.expected_revenue > 0 && (
                    <span className="text-sm text-gold-300">{formatMoney(it.expected_revenue, currency)} at risk</span>
                  )}
                  {it.odoo_url && (
                    <a href={it.odoo_url} target="_blank" rel="noopener noreferrer" className="ml-auto shrink-0 text-xs font-semibold text-gold-400 hover:text-gold-300">
                      Open →
                    </a>
                  )}
                </div>
                {it.overdue && <p className="mt-1 text-[11px] font-semibold text-amber-300">An activity here is already overdue — action the existing one.</p>}
                {it.salesperson && <p className="mt-1 text-[11px] text-[#8a7f6d]">Assigned to {it.salesperson}</p>}
                {it.draft_body && (
                  <p className="mt-1 line-clamp-3 whitespace-pre-line text-xs text-[#d8cdb9]">{it.draft_body}</p>
                )}
                <div className="mt-2 flex flex-wrap gap-2">
                  <DecisionBtn label="Mark sent" tone="gold" onClick={() => decide(it, "sent")} />
                  <DecisionBtn label="Dismiss" tone="ghost" onClick={() => decide(it, "dismissed")} />
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

      {data.top_stages.length > 0 && (
        <div className="mt-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#8a7f6d]">Where deals go quiet</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {data.top_stages.map((s) => (
              <span key={s.label} className="rounded-full border border-ink-600 bg-ink-800/60 px-2.5 py-1 text-xs text-[#d8cdb9]">
                {s.label} <span className="text-[#8a7f6d]">· {s.count}</span>
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

function DecisionBtn({ label, tone, onClick }: { label: string; tone: "gold" | "ghost"; onClick: () => void }) {
  const cls =
    tone === "gold"
      ? "border-gold-700/50 bg-gold-500/10 text-gold-300 hover:bg-gold-500/20"
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
