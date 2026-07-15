import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api, type SignetInsights } from "../../lib/api";
import { formatMoneyCompact } from "../../lib/format";
import { Card } from "../../components/ui";
import { AgentCardHeader } from "../../components/AgentCardHeader";
import { useTenantCurrency } from "../../lib/useTenantCurrency";

/** Signet dashboard card — a coverage view. Leads with the completion rate and median time-to-sign
 * (the wow metric), then what's in flight and at risk. */
export function SignetInsightsSection() {
  const currency = useTenantCurrency();
  const [data, setData] = useState<SignetInsights | null>(null);

  const load = useCallback(() => {
    api.get<SignetInsights>("/tenant/signet/insights").then((r) => setData(r.data)).catch(() => setData(null));
  }, []);
  useEffect(() => load(), [load]);

  if (!data || !data.activated) return null;

  const pct = Math.round(data.completion_rate * 100);

  return (
    <Card className="relative mt-6 overflow-hidden p-6">
      <AgentCardHeader slug="signet" name="Signet" kicker="E-signature · Live" />

      <div className="mt-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-[#8a7f6d]">Completion rate</p>
        <p className="mt-1 text-4xl font-bold text-[#f5eee0]">{pct}%</p>
        <p className="mt-2 text-sm font-medium text-gold-300">
          {data.completed.toLocaleString()} of {data.envelopes_sent.toLocaleString()} signed
          {data.median_hours_to_sign != null && <span className="font-normal text-[#8a7f6d]"> · ~{data.median_hours_to_sign}h median to sign</span>}
        </p>
        <p className="mt-1 text-xs text-[#8a7f6d]">
          {data.reminders_sent.toLocaleString()} reminder{data.reminders_sent === 1 ? "" : "s"} sent
          {data.estimated_net_savings > 0 && <span className="text-[#665c4c]"> · ~{formatMoneyCompact(data.estimated_net_savings, currency)} in chasing time saved</span>}
        </p>
      </div>

      <div className="mt-5 grid max-w-md grid-cols-3 gap-3">
        <Stat value={data.pending.toLocaleString()} label="In flight" accent />
        <Stat value={data.at_risk.toLocaleString()} label="At risk (overdue)" />
        <Stat value={data.completed.toLocaleString()} label="Completed" />
      </div>
    </Card>
  );
}

function Stat({ value, label, accent }: { value: ReactNode; label: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-ink-700 bg-ink-900/50 px-3 py-2">
      <p className={`text-xl font-bold ${accent ? "text-gold-300" : "text-[#f5eee0]"}`}>{value}</p>
      <p className="mt-0.5 text-[11px] text-[#8a7f6d]">{label}</p>
    </div>
  );
}
