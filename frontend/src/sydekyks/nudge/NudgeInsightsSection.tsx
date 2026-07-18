import { useCallback, useEffect, useState } from "react";
import { api, type NudgeInsights, type NudgeItem, type NudgeQueuePage } from "../../lib/api";
import { formatWorkTime, formatFastTime, formatMoney, formatMoneyCompact } from "../../lib/format";
import { Badge, Button, Card } from "../../components/ui";
import { AgentCardHeader } from "../../components/AgentCardHeader";
import { useTenantCurrency } from "../../lib/useTenantCurrency";

/** Nudge dashboard card - the ranked "value-at-risk" follow-up queue is the product. Each row carries
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
  const hasPipelineValue = data.value_at_risk_total > 0;
  const attentionCount = total || data.stale_caught;

  return (
    <Card className="relative mt-6 overflow-hidden p-6">
      <AgentCardHeader slug="nudge" name="Nudge" kicker="Sales follow-up · Live" />

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="rounded-[4px] border-2 border-ink-600 bg-ink-950/40 p-5">
          <p className="text-xs font-medium uppercase tracking-[0.4px] text-body">
            {hasPipelineValue ? "Pipeline awaiting follow-up" : "Opportunities needing a touch"}
          </p>
          <p className="mt-2 text-4xl font-bold text-heading">
            {hasPipelineValue ? formatMoney(data.value_at_risk_total, currency) : attentionCount.toLocaleString()}
          </p>
          <p className="mt-3 text-sm leading-6 text-heading">
            Nudge prepared {data.followups_drafted.toLocaleString()} follow-up{data.followups_drafted === 1 ? "" : "s"} in {formatFastTime(data.processing_seconds)}.
          </p>
          <p className="mt-2 text-sm font-medium text-gold-300">
            Estimated team time returned: {formatWorkTime(data.followups_drafted * data.estimated_minutes_each)} · {formatMoneyCompact(data.estimated_net_savings, currency)} net labour value
          </p>
          <p className="mt-2 text-xs leading-5 text-body">
            Based on {data.estimated_minutes_each} minutes per manual follow-up at {formatMoney(data.estimated_hourly_wage, currency)}/hr; AI cost was {formatMoneyCompact(data.ai_cost, currency)}.
          </p>
        </div>

        <NudgeTrendChart trend={data.daily_trend} />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat value={`${data.coverage_pct}%`} label="Follow-ups never missed" accent />
        <Stat value={data.stale_caught.toLocaleString()} label="Stale deals caught" />
        <Stat value={data.open_total.toLocaleString()} label="Open opportunities" />
      </div>

      {total > 0 && (
        <section aria-labelledby="nudge-command-queue" className="mt-5 rounded-[4px] border-2 border-line bg-surface p-4 shadow-[var(--shadow-xs)]">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-line pb-2">
            <div>
              <h3 id="nudge-command-queue" className="text-base font-semibold text-heading">Follow-up command queue</h3>
              <p className="text-sm text-body">Urgent silent opportunities, ranked for action</p>
            </div>
            <Badge tone="gold">
              {offset + 1}-{Math.min(offset + PAGE, total)} of {total}
            </Badge>
          </div>
          <div className="mt-3 grid gap-2">
            {items.map((it) => (
              <article key={it.finding_id} className={`rounded-[4px] border-2 bg-surface-soft p-2 shadow-[var(--shadow-xs)] ${it.overdue ? "border-warning" : "border-line"}`}>
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <Badge tone={it.overdue ? "warning" : "gold"}>Silent {it.days_stale}d</Badge>
                  {it.stage_name && <Badge tone="neutral">{it.stage_name}</Badge>}
                  <h3 className="min-w-0 break-words text-base font-semibold text-heading">{it.opp_name ?? "Opportunity"}</h3>
                  {it.partner_name && <span className="text-sm text-body">· {it.partner_name}</span>}
                  {it.expected_revenue != null && it.expected_revenue > 0 && (
                    <span className="text-sm font-medium text-brand">{formatMoney(it.expected_revenue, currency)} pipeline value</span>
                  )}
                  {it.odoo_url && (
                    <a href={it.odoo_url} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex min-h-11 shrink-0 items-center text-sm font-medium text-brand hover:text-heading">
                      Open in Odoo →
                    </a>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-body">
                  {it.salesperson && <span>Owner · {it.salesperson}</span>}
                  {it.overdue && <span className="font-medium text-warning-fg">Existing activity overdue · resolve it first</span>}
                </div>
                <div className="mt-2 grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
                  <div className="min-w-0 rounded-[2px] bg-surface p-2">
                    <p className="text-xs font-medium uppercase tracking-[0.4px] text-brand">Draft ready</p>
                    <p className="mt-1 line-clamp-3 whitespace-pre-line text-sm leading-6 text-heading">
                      {it.draft_body ?? (it.overdue ? "Use the existing overdue Odoo activity; Nudge did not create a duplicate." : "No draft is available for this opportunity.")}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => decide(it, "sent")}>Mark sent</Button>
                    <Button variant="ghost" onClick={() => decide(it, "dismissed")}>Dismiss</Button>
                  </div>
                </div>
              </article>
            ))}
          </div>
          {total > PAGE && (
            <div className="mt-4 flex items-center justify-end gap-3">
              <Button variant="ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous</Button>
              <Button variant="ghost" disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>Next</Button>
            </div>
          )}
        </section>
      )}

      {data.top_stages.length > 0 && (
        <div className="mt-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-body">Where deals go quiet</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {data.top_stages.map((s) => (
              <Badge key={s.label} tone="neutral">{s.label} · {s.count}</Badge>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function NudgeTrendChart({ trend }: { trend: NudgeInsights["daily_trend"] }) {
  const points = trend.slice(-14);
  const max = Math.max(1, ...points.map((point) => point.count));
  const total = points.reduce((sum, point) => sum + point.count, 0);
  return (
    <figure className="rounded-[4px] border-2 border-ink-600 bg-ink-900 p-5" aria-label="Follow-ups drafted during the last fourteen days">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.4px] text-gold-300">Follow-up momentum</p>
          <p className="mt-2 text-lg font-bold text-heading">Last 14 days</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-heading">{total}</p>
          <p className="text-xs text-body">follow-ups drafted</p>
        </div>
      </div>
      <div className="mt-5 flex h-36 items-end gap-1 border-b-2 border-ink-600 px-1">
        {points.map((point, index) => (
          <div key={point.date} className="group flex h-full min-w-0 flex-1 items-end" title={`${point.date}: ${point.count} follow-ups`}>
            <span className="w-full rounded-t-[2px] bg-gold-500 transition-colors group-hover:bg-gold-300" style={{ height: point.count ? `${Math.max(5, (point.count / max) * 100)}%` : "2px" }} />
            {index % 7 === 0 && <span className="sr-only">{point.date}</span>}
          </div>
        ))}
      </div>
      <figcaption className="mt-3 flex justify-between text-xs text-body">
        <span>{points[0]?.date ?? " - "}</span>
        <span>{points[points.length - 1]?.date ?? " - "}</span>
      </figcaption>
    </figure>
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
