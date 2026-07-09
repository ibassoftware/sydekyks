import { useEffect, useState } from "react";
import { api, type ScoutInsights } from "../../lib/api";
import { Card } from "../../components/ui";

/** Recruitment (scoring) dashboard card — renders only when Scout is installed and has data. */
export function ScoutInsightsSection() {
  const [data, setData] = useState<ScoutInsights | null>(null);

  useEffect(() => {
    api.get<ScoutInsights>("/tenant/scout/insights").then((r) => setData(r.data)).catch(() => setData(null));
  }, []);

  if (!data || !data.activated || data.total_scored === 0) return null;

  const maxBand = Math.max(1, ...data.distribution.map((b) => b.count));
  const money = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });

  return (
    <Card className="relative mt-6 overflow-hidden p-6">
      <div className="relative flex items-center gap-2">
        <span className="text-lg">⭐</span>
        <p className="text-xs font-semibold uppercase tracking-widest text-gold-500">Scout — Candidates scored</p>
      </div>

      <div className="mt-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-[#8a7f6d]">Estimated $ saved</p>
        <p className="mt-1 text-4xl font-bold text-[#f5eee0]">${money(data.estimated_net_savings)}</p>
        <p className="mt-1 text-xs text-[#8a7f6d]">
          ${money(data.estimated_manual_cost)} manual screening avoided − ${money(data.ai_cost)} AI cost
        </p>
        <p className="mt-1 text-[11px] text-[#665c4c]">
          Assumes ${data.estimated_hourly_wage}/hr, {data.estimated_minutes_each} min per candidate — adjust in Scout settings.
        </p>
      </div>

      <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-2xl font-bold text-[#f5eee0]">{data.total_scored.toLocaleString()}</p>
              <p className="text-[11px] text-[#8a7f6d]">Scored</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-[#f5eee0]">{data.average_score}</p>
              <p className="text-[11px] text-[#8a7f6d]">Avg score</p>
            </div>
          </div>
          <div className="mt-4 grid gap-1.5">
            {data.distribution.map((b) => (
              <div key={b.band} className="flex items-center gap-2">
                <span className="w-14 text-[11px] text-[#8a7f6d]">{b.band}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink-700">
                  <div className="h-full rounded-full bg-gradient-to-r from-gold-600 to-gold-400" style={{ width: `${(b.count / maxBand) * 100}%` }} />
                </div>
                <span className="w-6 text-right text-[11px] text-[#b9ad98]">{b.count}</span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-[#8a7f6d]">Top candidates</p>
          <div className="mt-2 divide-y divide-ink-700/60 overflow-hidden rounded-lg border border-ink-700">
            {data.top_candidates.map((c, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-sm text-[#ede6da]">{c.applicant_name ?? "Candidate"}</span>
                {c.job_name && <span className="hidden shrink-0 text-xs text-[#8a7f6d] sm:inline">{c.job_name}</span>}
                <span className="shrink-0 text-sm font-semibold text-gold-300">{c.score}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}
