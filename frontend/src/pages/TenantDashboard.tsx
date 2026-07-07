import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Dashboard, type LedgerInsights } from "../lib/api";
import { RecentMissionsStrip } from "../lib/activity";
import { Button, Card } from "../components/ui";
import { HQShell } from "../components/HQShell";
import { LedgerTrendChart } from "../sydekyks/ledger/LedgerTrendChart";

function compactNumber(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export default function TenantDashboard() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [insights, setInsights] = useState<LedgerInsights | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<Dashboard>("/tenant/dashboard").then((res) => {
      setDashboard(res.data);
      setLoading(false);
    });
    api
      .get<LedgerInsights>("/tenant/ledger/insights")
      .then((res) => setInsights(res.data))
      .catch(() => setInsights(null));
  }, []);

  const hasQuota = !!dashboard?.power_meter_quota;
  const powerPct =
    dashboard && hasQuota ? Math.min(100, Math.round((dashboard.power_meter_used / dashboard.power_meter_quota!) * 100)) : 0;

  return (
    <HQShell>
      <main className="mx-auto max-w-6xl px-6 py-10">
        {loading || !dashboard ? (
          <p className="text-sm text-[#b9ad98]">Loading your HQ…</p>
        ) : (
          <>
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-gold-500">Headquarters</p>
              <h1 className="mt-1 text-3xl font-bold text-[#f5eee0]">{dashboard.tenant_name}</h1>
              <p className="mt-1 text-sm text-[#8a7f6d]">/{dashboard.tenant_slug} · {dashboard.plan} plan</p>
            </div>

            <div className="mt-8 grid gap-6 md:grid-cols-3">
              <Link to="/hq/roster">
                <Card className="p-6 transition-colors hover:border-gold-500/60">
                  <p className="text-xs font-semibold uppercase tracking-wider text-gold-500">Roster Sydekyks</p>
                  <p className="mt-2 text-3xl font-bold text-[#f5eee0]">{dashboard.roster_sydekyk_count}</p>
                  <p className="mt-1 text-sm text-[#8a7f6d]">Shared agents available to your team</p>
                </Card>
              </Link>
              <Link to="/hq/roster">
                <Card className="p-6 transition-colors hover:border-gold-500/60">
                  <p className="text-xs font-semibold uppercase tracking-wider text-gold-500">Exclusive Sydekyks</p>
                  <p className="mt-2 text-3xl font-bold text-[#f5eee0]">{dashboard.exclusive_sydekyk_count}</p>
                  <p className="mt-1 text-sm text-[#8a7f6d]">Built just for your HQ</p>
                </Card>
              </Link>
              <Card className="p-6">
                <p className="text-xs font-semibold uppercase tracking-wider text-gold-500">Estimated Power Usage</p>
                <p className="mt-2 text-3xl font-bold text-[#f5eee0]">
                  ${dashboard.power_meter_used.toFixed(2)}
                  {hasQuota && (
                    <span className="text-base font-normal text-[#8a7f6d]"> / ${dashboard.power_meter_quota!.toFixed(2)}</span>
                  )}
                </p>
                {hasQuota ? (
                  <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-ink-700">
                    <div className="h-full rounded-full bg-gradient-to-r from-gold-600 to-gold-400" style={{ width: `${powerPct}%` }} />
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-[#8a7f6d]">No quota set</p>
                )}
                {dashboard.power_meter_stale && (
                  <p className="mt-2 text-xs text-[#8a7f6d]">Showing last known value — reconnecting…</p>
                )}
              </Card>
            </div>

            {insights && (insights.activated ? <LedgerInsightsSection insights={insights} /> : <LedgerNotActivatedCard />)}

            <Card className="mt-6 p-6">
              <RecentMissionsStrip />
            </Card>

            {dashboard.roster_sydekyk_count === 0 && dashboard.exclusive_sydekyk_count === 0 && (
              <Card className="mt-6 flex flex-col items-center gap-4 p-10 text-center">
                <p className="text-[#b9ad98]">Activate Sydekyks from the Roster to put them to work for your team.</p>
                <div className="flex gap-3">
                  <Link to="/hq/roster">
                    <Button>Open the Roster</Button>
                  </Link>
                  <Link to="/hq/missions">
                    <Button variant="ghost">View Missions</Button>
                  </Link>
                </div>
              </Card>
            )}
          </>
        )}
      </main>
    </HQShell>
  );
}

function LedgerInsightsSection({ insights }: { insights: LedgerInsights }) {
  return (
    <Card className="relative mt-6 overflow-hidden p-6">
      <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-gold-500/10 blur-3xl" />
      <div className="relative flex items-center gap-2">
        <span className="text-lg" style={{ filter: "drop-shadow(0 0 6px rgba(212,168,40,0.6))" }}>
          📒
        </span>
        <p className="text-xs font-semibold uppercase tracking-widest text-gold-500">Ledger — Live</p>
      </div>

      <div className="relative mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-[#8a7f6d]">Estimated $ saved</p>
          <p className="mt-1 text-4xl font-bold text-[#f5eee0]">
            ${compactNumber(insights.estimated_net_savings)}
          </p>
          <p className="mt-1 text-xs text-[#8a7f6d]">
            ${compactNumber(insights.estimated_manual_cost)} manual entry avoided − ${compactNumber(insights.ai_cost)} AI cost
          </p>
          <p className="mt-2 text-xs text-[#665c4c]">
            Assumes ${insights.estimated_hourly_wage}/hr, {insights.estimated_minutes_per_bill} min per bill — adjust in
            Ledger settings.
          </p>

          <div className="mt-5 grid grid-cols-3 gap-3">
            <div>
              <p className="text-2xl font-bold text-[#f5eee0]">{compactNumber(insights.succeeded_missions)}</p>
              <p className="text-[11px] text-[#8a7f6d]">Bills processed</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-[#f5eee0]">{compactNumber(insights.posted_count)}</p>
              <p className="text-[11px] text-[#8a7f6d]">Auto-posted</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-[#f5eee0]">{compactNumber(insights.needs_review_missions)}</p>
              <p className="text-[11px] text-[#8a7f6d]">Needs review</p>
            </div>
          </div>
        </div>

        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-[#8a7f6d]">Last 30 days</p>
          <LedgerTrendChart trend={insights.daily_trend} />
        </div>
      </div>
    </Card>
  );
}

function LedgerNotActivatedCard() {
  return (
    <Card className="mt-6 flex flex-col items-center gap-3 p-8 text-center">
      <span className="text-2xl">📒</span>
      <p className="text-[#b9ad98]">
        Activate Ledger to turn vendor bills into Odoo entries automatically — and see your estimated savings here.
      </p>
      <Link to="/hq/roster">
        <Button>Activate Ledger</Button>
      </Link>
    </Card>
  );
}
