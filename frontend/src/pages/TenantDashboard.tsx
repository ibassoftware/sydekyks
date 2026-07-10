import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Dashboard, type LedgerInsights, type Mission } from "../lib/api";
import { useActivity } from "../lib/activity";
import { formatWorkTime, formatFastTime } from "../lib/format";
import { Button, Card } from "../components/ui";
import { HQShell } from "../components/HQShell";
import { MissionList } from "../components/MissionList";
import { AgentThumb } from "../components/AgentThumb";
import { LedgerTrendChart } from "../sydekyks/ledger/LedgerTrendChart";
import { DecodeInsightsSection } from "../sydekyks/decode/DecodeInsightsSection";
import { ScoutInsightsSection } from "../sydekyks/scout/ScoutInsightsSection";
import { MirrorInsightsSection } from "../sydekyks/mirror/MirrorInsightsSection";
import { ShieldInsightsSection } from "../sydekyks/shield/ShieldInsightsSection";

function compactNumber(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function UsageMeter({
  label,
  used,
  cap,
  throttled,
  caption,
}: {
  label: string;
  used: number;
  cap: number;
  throttled: boolean;
  caption: string;
}) {
  const pct = cap > 0 ? Math.min(100, (used / cap) * 100) : 0;
  const barTone = throttled ? "bg-red-500" : pct > 80 ? "bg-amber-400" : "bg-gradient-to-r from-gold-600 to-gold-400";
  return (
    <Card className="p-6">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-gold-500">{label}</p>
        {throttled && <span className="rounded-full border border-red-700/50 bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-red-400">Paused</span>}
      </div>
      <p className="mt-2 text-2xl font-bold text-[#f5eee0]">
        {compactNumber(used)}
        <span className="text-base font-normal text-[#8a7f6d]"> / {compactNumber(cap)}</span>
      </p>
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-ink-700">
        <div className={`h-full rounded-full ${barTone}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 text-xs text-[#8a7f6d]">{caption}</p>
    </Card>
  );
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
              <p className="mt-1 text-sm text-[#8a7f6d]">/{dashboard.tenant_slug} · {dashboard.plan_display_name} plan</p>
            </div>

            <div className="mt-8 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
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
              <UsageMeter
                label="Tokens this month"
                used={dashboard.tokens_used_this_month}
                cap={dashboard.monthly_token_cap}
                throttled={dashboard.token_throttled}
                caption="Resets on the 1st (00:01 UTC)"
              />
              <UsageMeter
                label="AI capacity · past hour"
                used={dashboard.gpu_seconds_used_last_hour}
                cap={dashboard.gpu_seconds_per_hour_cap}
                throttled={dashboard.gpu_throttled}
                caption="GPU-seconds · rolling hour"
              />
            </div>

            <p className="mt-10 text-xs font-semibold uppercase tracking-widest text-gold-500">Your Agents at Work</p>
            {insights && (insights.activated ? <LedgerInsightsSection insights={insights} /> : <LedgerNotActivatedCard />)}

            <DecodeInsightsSection />
            <ScoutInsightsSection />
            <MirrorInsightsSection />
            <ShieldInsightsSection />

            <DashboardRecentMissions />

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

function DashboardRecentMissions() {
  const [missions, setMissions] = useState<Mission[] | null>(null);
  const { active } = useActivity(); // re-fetch as missions start/finish so rows stay fresh

  const load = useCallback(() => {
    api.get<{ items: Mission[] }>("/tenant/missions", { params: { limit: 8 } }).then((r) => setMissions(r.data.items));
  }, []);

  useEffect(() => {
    load();
  }, [load, active.length]);

  return (
    <Card className="mt-6 p-6">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-gold-500">Recent Missions</p>
        <Link to="/hq/missions" className="text-xs font-semibold text-gold-400 hover:text-gold-300">
          View all →
        </Link>
      </div>
      {!missions ? (
        <p className="mt-3 text-sm text-[#8a7f6d]">Loading…</p>
      ) : missions.length === 0 ? (
        <p className="mt-3 text-sm text-[#8a7f6d]">No missions yet.</p>
      ) : (
        <div className="mt-3 overflow-hidden rounded-lg border border-ink-700">
          <MissionList missions={missions} onReload={load} />
        </div>
      )}
    </Card>
  );
}

function LedgerInsightsSection({ insights }: { insights: LedgerInsights }) {
  return (
    <Card className="relative mt-6 overflow-hidden p-6">
      <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-gold-500/10 blur-3xl" />
      <div className="relative flex items-center gap-3">
        <AgentThumb slug="ledger" alt="Ledger" />
        <div>
          <p className="text-sm font-bold text-[#f5eee0]">Ledger</p>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-gold-500">Bills encoded · Live</p>
        </div>
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
          <p className="mt-2 text-sm font-medium text-gold-300">
            {compactNumber(insights.succeeded_missions)} bills encoded in {formatFastTime(insights.processing_seconds)}
            <span className="font-normal text-[#8a7f6d]">
              {" "}· ~{formatWorkTime(insights.succeeded_missions * insights.estimated_minutes_per_bill)} by hand
            </span>
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
