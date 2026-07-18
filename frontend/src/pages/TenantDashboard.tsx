import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, type CommandCenter, type LedgerInsights, type Mission, type Sydekyk } from "../lib/api";
import { useActivity } from "../lib/activity";
import { formatWorkTime, formatFastTime, formatMoneyCompact } from "../lib/format";
import { useTenantCurrency } from "../lib/useTenantCurrency";
import { Button, Card, buttonClassName } from "../components/ui";
import { HQShell } from "../components/HQShell";
import { MissionList } from "../components/MissionList";
import { AgentCardHeader } from "../components/AgentCardHeader";
import { DecodeInsightsSection } from "../sydekyks/decode/DecodeInsightsSection";
import { ScoutInsightsSection } from "../sydekyks/scout/ScoutInsightsSection";
import { MirrorInsightsSection } from "../sydekyks/mirror/MirrorInsightsSection";
import { ShieldInsightsSection } from "../sydekyks/shield/ShieldInsightsSection";
import { NudgeInsightsSection } from "../sydekyks/nudge/NudgeInsightsSection";
import { QuillInsightsSection } from "../sydekyks/quill/QuillInsightsSection";
import { SealInsightsSection } from "../sydekyks/seal/SealInsightsSection";
import { SignetInsightsSection } from "../sydekyks/signet/SignetInsightsSection";
import { AgentThumb } from "../components/AgentThumb";
import { TypeUIPanel } from "../components/TypeUIPanel";
import { AgentQuickAction } from "../components/AgentQuickAction";

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
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-[0.4px] text-gold-300">{label}</p>
        {throttled && <span className="rounded-[2px] border-2 border-red-700/50 bg-red-500/10 px-2 py-1 text-xs font-medium uppercase text-red-400">Paused</span>}
      </div>
      <p className="mt-3 text-2xl font-bold text-heading">
        {compactNumber(used)}
        <span className="text-base font-normal text-body"> / {compactNumber(cap)}</span>
      </p>
      <div className="mt-4 h-2 w-full overflow-hidden rounded-[2px] bg-ink-700">
        <div className={`h-full rounded-[2px] ${barTone}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-3 text-xs text-body">{caption}</p>
    </Card>
  );
}

export default function TenantDashboard() {
  const [commandCenter, setCommandCenter] = useState<CommandCenter | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const commandRequestRef = useRef<AbortController | null>(null);
  const { active, activeSydekykIds, issuesCount } = useActivity();

  const loadCommandCenter = useCallback(() => {
    commandRequestRef.current?.abort();
    const controller = new AbortController();
    commandRequestRef.current = controller;
    setLoadFailed(false);
    api.get<CommandCenter>("/tenant/command-center", { signal: controller.signal })
      .then((response) => setCommandCenter(response.data))
      .catch(() => {
        if (!controller.signal.aborted) setLoadFailed(true);
      })
      .finally(() => {
        if (commandRequestRef.current === controller) {
          commandRequestRef.current = null;
          setLoading(false);
        }
      });
  }, []);

  useEffect(() => {
    loadCommandCenter();
    return () => {
      const current = commandRequestRef.current;
      commandRequestRef.current = null;
      current?.abort();
    };
  }, [active.length, loadCommandCenter]);

  const dashboard = commandCenter?.dashboard ?? null;
  const sydekyks = commandCenter?.sydekyks ?? [];
  const missionPage = commandCenter?.missions ?? null;
  const moneySaved = commandCenter?.money_saved ?? null;
  const insights = commandCenter?.insights;
  const readiness = commandCenter?.readiness ?? {};
  const queues = commandCenter?.queues;
  const missions = missionPage?.items ?? [];
  const terminal = missions.filter((mission) => mission.status === "succeeded" || mission.status === "failed");
  const succeeded = terminal.filter((mission) => mission.status === "succeeded").length;
  const successRate = terminal.length ? Math.round((succeeded / terminal.length) * 100) : 0;
  const activated = sydekyks.filter((agent) => agent.installed || agent.is_exclusive);
  const trend = buildMissionTrend(missions);
  const workload = buildAgentWorkload(missions);

  return (
    <HQShell>
      <div className="hq-command-background min-h-screen">
      <main id="main-content" className="relative mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:py-12">
        {loading ? (
          <p className="text-sm text-body">Loading your HQ…</p>
        ) : loadFailed && !dashboard ? (
          <Card className="p-8">
            <h1 className="text-2xl font-bold text-heading">Command center unavailable</h1>
            <p className="mt-3 text-sm text-body">The dashboard could not load. The rest of HQ is still available.</p>
            <Button className="mt-6" onClick={loadCommandCenter}>Try again</Button>
          </Card>
        ) : !dashboard ? null : (
          <>
            <header className="typeui-grid rounded-[4px] border-2 border-ink-600 bg-ink-900 p-6 shadow-[var(--shadow-md)] sm:p-8">
              <div className="relative flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="rounded-[2px] border-2 border-gold-700 bg-brand-softer px-2 py-1 text-xs font-medium uppercase tracking-[0.4px] text-gold-300">Command center</span>
                    <span className="text-sm text-body">/{dashboard.tenant_slug} · {dashboard.plan_display_name}</span>
                  </div>
                  <h1 className="mt-6 text-4xl font-bold tracking-tight text-heading sm:text-5xl">{dashboard.tenant_name}</h1>
                  <p className="mt-4 max-w-2xl text-lg text-body">One view of the work your agents completed, what needs a decision, and where to act next.</p>
                </div>
                <div className="flex flex-wrap gap-4">
                  <Link to="/hq/missions" className={buttonClassName("primary")}>View missions</Link>
                  <Link to="/hq/missions?view=attention" className={buttonClassName("ghost")}>Command attention {issuesCount > 0 ? `(${issuesCount})` : ""}</Link>
                </div>
              </div>
            </header>

            <DashboardJumpNav agents={activated} />

            <section id="overview" aria-labelledby="overview-title" className="mt-8 scroll-mt-28">
              <div className="mb-4 flex items-center justify-between gap-4">
                <h2 id="overview-title" className="text-sm font-medium uppercase tracking-[0.4px] text-gold-300">Business overview</h2>
                <span className="text-xs text-body">Rolling sample · latest {missions.length || 0} missions</span>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
                <KpiCard
                  value={moneySaved == null ? " - " : formatMoneyCompact(moneySaved, dashboard.currency)}
                  label="Money saved"
                  detail={moneySaved == null ? "Calculating verified agent value" : "Labour avoided + duplicate payments prevented"}
                  tone="value"
                />
                <KpiCard value={compactNumber(missionPage?.total ?? 0)} label="Missions run" detail="All recorded agent work" href="/hq/missions" />
                <KpiCard value={`${successRate}%`} label="Successful outcomes" detail={`${succeeded} of ${terminal.length} completed in sample`} />
                <KpiCard value={String(issuesCount)} label="Decisions waiting" detail={issuesCount ? "Human review keeps work moving" : "No reviews waiting"} href="/hq/missions?view=attention" tone={issuesCount ? "warning" : "default"} />
                <KpiCard value={String(activated.length)} label="Agents on duty" detail={`${active.length} mission${active.length === 1 ? "" : "s"} running now`} href="/hq/roster" />
              </div>
            </section>

            <section aria-label="Mission analytics" className="mt-8 grid gap-6 xl:grid-cols-[1.5fr_1fr]">
              <MissionPulseChart trend={trend} />
              <WorkloadPanel workload={workload} />
            </section>

            <section id="capacity" aria-labelledby="capacity-title" className="mt-8 scroll-mt-28">
              <h2 id="capacity-title" className="mb-4 text-sm font-medium uppercase tracking-[0.4px] text-gold-300">AI capacity</h2>
              <div className="grid gap-4 md:grid-cols-2">
                <UsageMeter label="Tokens this month" used={dashboard.tokens_used_this_month} cap={dashboard.monthly_token_cap} throttled={dashboard.token_throttled} caption="Resets on the 1st at 00:01 UTC" />
                <UsageMeter label="AI capacity · past hour" used={dashboard.gpu_seconds_used_last_hour} cap={dashboard.gpu_seconds_per_hour_cap} throttled={dashboard.gpu_throttled} caption="GPU-seconds · rolling hour" />
              </div>
            </section>

            <AgentLaunchpad agents={activated} activeIds={activeSydekykIds} readiness={readiness} />

            <section aria-labelledby="agent-dashboards-title" className="mt-12">
              <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b-2 border-ink-600 pb-4">
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.4px] text-gold-300">Business dashboards</p>
                  <h2 id="agent-dashboards-title" className="mt-2 text-2xl font-bold text-heading">Your agents at work</h2>
                </div>
                <p className="max-w-xl text-sm text-body">Each panel translates agent activity into business outcomes, risk, throughput, and work waiting on your team.</p>
              </div>

            {/* Grouped by business function: Sales · Accounting · HR. Each card self-gates on activation. */}
            <div id="agent-nudge" className="scroll-mt-28"><NudgeInsightsSection initialData={insights?.nudge ?? null} initialQueue={queues?.nudge ?? null} /></div>
            <div id="agent-quill" className="scroll-mt-28"><QuillInsightsSection initialData={insights?.quill ?? null} /></div>
            <div id="agent-seal" className="scroll-mt-28"><SealInsightsSection initialData={insights?.seal ?? null} /></div>
            <div id="agent-signet" className="scroll-mt-28"><SignetInsightsSection initialData={insights?.signet ?? null} /></div>

            <div id="agent-ledger" className="scroll-mt-28">{insights?.ledger && (insights.ledger.activated ? <LedgerInsightsSection insights={insights.ledger} /> : <LedgerNotActivatedCard />)}</div>
            <div id="agent-mirror" className="scroll-mt-28"><MirrorInsightsSection initialData={insights?.mirror ?? null} initialQueue={queues?.mirror ?? null} /></div>
            <div id="agent-shield" className="scroll-mt-28"><ShieldInsightsSection initialData={insights?.shield ?? null} initialQueue={queues?.shield ?? null} /></div>

            <div id="agent-decode" className="scroll-mt-28"><DecodeInsightsSection initialData={insights?.decode ?? null} /></div>
            <div id="agent-scout" className="scroll-mt-28"><ScoutInsightsSection initialData={insights?.scout ?? null} /></div>
            </section>

            <DashboardRecentMissions initialMissions={missions.slice(0, 8)} />

            {dashboard.roster_sydekyk_count === 0 && dashboard.exclusive_sydekyk_count === 0 && (
              <Card className="mt-6 flex flex-col items-center gap-4 p-10 text-center">
                <p className="text-body">Activate Sydekyks from the Roster to put them to work for your team.</p>
                <div className="flex gap-3">
                  <Link to="/hq/roster" className={buttonClassName("primary")}>Open the roster</Link>
                  <Link to="/hq/missions" className={buttonClassName("ghost")}>View missions</Link>
                </div>
              </Card>
            )}
          </>
        )}
      </main>
      </div>
      <TypeUIPanel />
    </HQShell>
  );
}

function KpiCard({
  value,
  label,
  detail,
  href,
  tone = "default",
}: {
  value: string;
  label: string;
  detail: string;
  href?: string;
  tone?: "default" | "warning" | "value";
}) {
  const valueTone = tone === "warning" ? "text-amber-300" : tone === "value" ? "text-gold-300" : "text-heading";
  const dotTone = tone === "warning" ? "bg-amber-400" : tone === "value" ? "bg-gold-300" : "bg-gold-400";
  const card = (
    <Card className={`h-full p-5 ${href ? "fx-lift hover:border-gold-500 hover:bg-ink-800" : ""}`}>
      <div className="flex items-start justify-between gap-4">
        <p className="text-xs font-medium uppercase tracking-[0.4px] text-body">{label}</p>
        <span className={`mt-1 h-2 w-2 rounded-full ${dotTone}`} aria-hidden="true" />
      </div>
      <p className={`mt-5 text-4xl font-bold ${valueTone}`}>{value}</p>
      <p className="mt-3 text-sm text-body">{detail}</p>
      {href && <span className="mt-5 inline-flex text-sm font-medium text-gold-300">Open view →</span>}
    </Card>
  );
  return href ? <Link to={href}>{card}</Link> : card;
}

interface MissionTrendDay {
  key: string;
  label: string;
  succeeded: number;
  failed: number;
  active: number;
}

function buildMissionTrend(missions: Mission[]): MissionTrendDay[] {
  const days: MissionTrendDay[] = [];
  const now = new Date();
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - offset));
    days.push({
      key: date.toISOString().slice(0, 10),
      label: date.toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" }),
      succeeded: 0,
      failed: 0,
      active: 0,
    });
  }
  const byKey = new Map(days.map((day) => [day.key, day]));
  for (const mission of missions) {
    const day = byKey.get(mission.created_at.slice(0, 10));
    if (!day) continue;
    if (mission.status === "succeeded") day.succeeded += 1;
    else if (mission.status === "failed") day.failed += 1;
    else day.active += 1;
  }
  return days;
}

function MissionPulseChart({ trend }: { trend: MissionTrendDay[] }) {
  const max = Math.max(1, ...trend.map((day) => day.succeeded + day.failed + day.active));
  const total = trend.reduce((sum, day) => sum + day.succeeded + day.failed + day.active, 0);
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.4px] text-gold-300">Mission pulse</p>
          <h2 className="mt-2 text-xl font-bold text-heading">Seven-day throughput</h2>
        </div>
        <div className="text-right">
          <strong className="block text-2xl text-heading">{total}</strong>
          <span className="text-xs text-body">missions this week</span>
        </div>
      </div>
      <figure className="mt-8" aria-label="Missions by status over the last seven days">
        <div className="flex h-52 items-end justify-between gap-3 border-b-2 border-ink-600 px-2">
          {trend.map((day) => {
            return (
              <div key={day.key} className="flex h-full min-w-0 flex-1 flex-col justify-end gap-1" aria-label={`${day.label}: ${day.succeeded} succeeded, ${day.failed} failed, ${day.active} active`}>
                <div className="flex h-44 items-end justify-center gap-1">
                  <span className="w-2/5 rounded-t-[2px] bg-gold-500" style={{ height: day.succeeded ? `${Math.max(2, (day.succeeded / max) * 100)}%` : 0 }} title={`${day.succeeded} succeeded`} />
                  <span className="w-2/5 rounded-t-[2px] bg-red-500" style={{ height: day.failed + day.active ? `${Math.max(2, ((day.failed + day.active) / max) * 100)}%` : 0 }} title={`${day.failed} failed, ${day.active} active`} />
                </div>
                <span className="pb-2 text-center text-xs text-body">{day.label}</span>
              </div>
            );
          })}
        </div>
        <figcaption className="mt-4 flex flex-wrap gap-5 text-xs text-body">
          <span className="inline-flex items-center gap-2"><span className="h-2 w-2 bg-gold-500" />Succeeded</span>
          <span className="inline-flex items-center gap-2"><span className="h-2 w-2 bg-red-500" />Failed or active</span>
        </figcaption>
      </figure>
    </Card>
  );
}

interface AgentWorkload {
  name: string;
  count: number;
}

function buildAgentWorkload(missions: Mission[]): AgentWorkload[] {
  const counts = new Map<string, number>();
  for (const mission of missions) {
    const name = mission.sydekyk_name ?? "Unassigned";
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
}

function WorkloadPanel({ workload }: { workload: AgentWorkload[] }) {
  const max = Math.max(1, ...workload.map((item) => item.count));
  return (
    <Card className="p-5 sm:p-6">
      <p className="text-xs font-medium uppercase tracking-[0.4px] text-gold-300">Workload</p>
      <h2 className="mt-2 text-xl font-bold text-heading">Missions by agent</h2>
      {workload.length === 0 ? (
        <p className="mt-8 text-sm text-body">Agent workload will appear after the first mission.</p>
      ) : (
        <ul className="mt-8 grid gap-5">
          {workload.map((item) => (
            <li key={item.name}>
              <div className="mb-2 flex items-center justify-between gap-4 text-sm">
                <span className="font-medium text-heading">{item.name}</span>
                <span className="text-body">{item.count}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-[2px] bg-ink-700">
                <div className="h-full rounded-[2px] bg-gold-500" style={{ width: `${(item.count / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function AgentLaunchpad({
  agents,
  activeIds,
  readiness,
}: {
  agents: Sydekyk[];
  activeIds: Set<string>;
  readiness: CommandCenter["readiness"];
}) {
  return (
    <section id="quick-launch" aria-labelledby="launchpad-title" className="mt-10 scroll-mt-28">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.4px] text-gold-300">Quick launch</p>
          <h2 id="launchpad-title" className="mt-2 text-2xl font-bold text-heading">Your agents</h2>
        </div>
        <Link to="/hq/roster" className="text-sm font-medium text-gold-300 hover:text-heading">Manage roster →</Link>
      </div>
      {agents.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-body">Activate an agent to add it to your command center.</p>
          <Link to="/hq/roster" className={buttonClassName("primary", "mt-5")}>Open roster</Link>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {agents.map((agent) => {
            const working = activeIds.has(agent.id);
            return (
              <Card key={agent.id} className="fx-lift flex h-full min-w-0 flex-col p-5 hover:border-gold-500">
                <div className="flex items-start gap-3">
                  <AgentThumb slug={agent.slug} alt={agent.name} size={48} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="truncate text-lg font-bold text-heading">
                        <Link to={`/hq/roster/${agent.id}`} className="hover:text-gold-300">{agent.name}</Link>
                      </h3>
                      <span className={`inline-flex shrink-0 items-center gap-2 rounded-[2px] border-2 px-2 py-1 text-xs font-medium ${working ? "border-gold-700 bg-brand-softer text-gold-300" : "border-ink-600 bg-ink-800 text-body"}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${working ? "bg-gold-300" : "bg-body"}`} aria-hidden="true" />
                        {working ? "On a mission" : "Standing by"}
                      </span>
                    </div>
                    <p className="mt-2 min-h-10 line-clamp-2 text-sm text-body">{agent.tagline}</p>
                  </div>
                </div>
                <AgentQuickAction agent={agent} working={working} readiness={readiness[agent.slug]} />
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );
}

function DashboardRecentMissions({ initialMissions }: { initialMissions: Mission[] }) {
  const [missions, setMissions] = useState<Mission[]>(initialMissions);

  const load = useCallback(() => {
    api.get<{ items: Mission[] }>("/tenant/missions", { params: { limit: 8 } }).then((r) => setMissions(r.data.items));
  }, []);

  useEffect(() => {
    setMissions(initialMissions);
  }, [initialMissions]);

  return (
    <Card className="mt-6 p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-gold-500">Recent Missions</p>
        <Link to="/hq/missions" className="text-xs font-semibold text-gold-400 hover:text-gold-300">
          View all →
        </Link>
      </div>
      {missions.length === 0 ? (
        <p className="mt-3 text-sm text-body">No missions yet.</p>
      ) : (
        <div className="mt-3 min-w-0">
          <MissionList missions={missions} onReload={load} />
        </div>
      )}
    </Card>
  );
}

function LedgerInsightsSection({ insights }: { insights: LedgerInsights }) {
  const currency = useTenantCurrency();
  return (
    <Card className="relative mt-6 overflow-hidden p-6">
      <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-gold-500/10 blur-3xl" />
      <AgentCardHeader slug="ledger" name="Ledger" kicker="Bills encoded · Live" />

      <div className="relative mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-body">Estimated $ saved</p>
          <p className="mt-1 text-4xl font-bold text-heading">
            {formatMoneyCompact(insights.estimated_net_savings, currency)}
          </p>
          <p className="mt-1 text-xs text-body">
            {formatMoneyCompact(insights.estimated_manual_cost, currency)} manual entry avoided, less {formatMoneyCompact(insights.ai_cost, currency)} AI cost
          </p>
          <p className="mt-2 text-sm font-medium text-gold-300">
            {compactNumber(insights.succeeded_missions)} bills encoded in {formatFastTime(insights.processing_seconds)}
            <span className="font-normal text-body">
              {" "}· ~{formatWorkTime(insights.succeeded_missions * insights.estimated_minutes_per_bill)} by hand
            </span>
          </p>
          <p className="mt-2 text-xs text-body">
            Assumes ${insights.estimated_hourly_wage}/hr, {insights.estimated_minutes_per_bill} min per bill. Adjust in
            Ledger settings.
          </p>

          <div className="mt-5 grid grid-cols-3 gap-3">
            <div className="rounded-[4px] border-2 border-ink-700 bg-ink-900/50 p-3">
              <p className="text-2xl font-bold text-heading">{compactNumber(insights.succeeded_missions)}</p>
              <p className="mt-1 text-xs text-body">Bills processed</p>
            </div>
            <div className="rounded-[4px] border-2 border-ink-700 bg-ink-900/50 p-3">
              <p className="text-2xl font-bold text-heading">{compactNumber(insights.posted_count)}</p>
              <p className="mt-1 text-xs text-body">Auto-posted</p>
            </div>
            <div className="rounded-[4px] border-2 border-ink-700 bg-ink-900/50 p-3">
              <p className="text-2xl font-bold text-heading">{compactNumber(insights.needs_review_missions)}</p>
              <p className="mt-1 text-xs text-body">Needs review</p>
            </div>
          </div>
        </div>

        <LedgerAutomationChart insights={insights} />
      </div>
    </Card>
  );
}

function LedgerAutomationChart({ insights }: { insights: LedgerInsights }) {
  const days = insights.daily_trend.slice(-30);
  const rolling = days.map((day, index) => {
    const window = days.slice(Math.max(0, index - 6), index + 1);
    const completed = window.reduce((sum, point) => sum + point.succeeded, 0);
    const review = window.reduce((sum, point) => sum + point.needs_review, 0);
    return {
      ...day,
      volume: day.succeeded + day.failed,
      rate: completed > 0 ? Math.round(((completed - review) / completed) * 100) : null,
    };
  });
  const latestIndex = rolling.findLastIndex((point) => point.rate !== null);
  const latestRate = latestIndex >= 0 ? rolling[latestIndex].rate : null;
  const comparisonRate = latestIndex >= 7 ? rolling[latestIndex - 7].rate : null;
  const change = latestRate !== null && comparisonRate !== null ? latestRate - comparisonRate : null;

  const width = 640;
  const height = 220;
  const pad = { top: 24, right: 12, bottom: 30, left: 38 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const x = (index: number) => pad.left + (index / Math.max(1, rolling.length - 1)) * plotWidth;
  const y = (rate: number) => pad.top + ((100 - rate) / 100) * plotHeight;
  const maxVolume = Math.max(1, ...rolling.map((point) => point.volume));
  let linePath = "";
  let drawing = false;
  rolling.forEach((point, index) => {
    if (point.rate === null) {
      drawing = false;
      return;
    }
    linePath += `${drawing ? " L" : "M"}${x(index).toFixed(1)},${y(point.rate).toFixed(1)}`;
    drawing = true;
  });
  const hasVolume = rolling.some((point) => point.volume > 0);

  return (
    <figure className="rounded-[4px] border-2 border-ink-600 bg-ink-800 p-4 shadow-[var(--shadow-xs)] sm:p-5">
      <figcaption>
        <p className="text-xs font-medium uppercase tracking-[0.4px] text-gold-300">Bills cleared without review</p>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-3xl font-bold tabular-nums text-heading">{latestRate === null ? "Not enough data" : `${latestRate}%`}</p>
            <p className="mt-1 text-xs text-body">7-day rolling rate</p>
          </div>
          {change !== null && (
            <p className={`text-sm font-medium ${change >= 0 ? "text-success" : "text-warning-fg"}`}>
              {change >= 0 ? "Up" : "Down"} {Math.abs(change)} points from the prior week
            </p>
          )}
        </div>
        <p className="mt-3 text-sm text-body">Higher means Ledger completed more bills without sending them to a human for correction.</p>
      </figcaption>

      {!hasVolume ? (
        <div className="mt-6 grid min-h-44 place-items-center border-t-2 border-ink-600 text-center">
          <div><p className="font-medium text-heading">The graph begins with Ledger's first bill</p><p className="mt-1 text-sm text-body">Daily volume and the rolling touchless rate will appear here.</p></div>
        </div>
      ) : (
        <>
          <div className="mt-5 flex flex-wrap gap-5 text-xs text-body" aria-hidden="true">
            <span className="flex items-center gap-2"><span className="h-0.5 w-6 bg-brand" />7-day rate</span>
            <span className="flex items-center gap-2"><span className="h-3 w-3 rounded-[2px] bg-ink-600" />Daily bill volume</span>
          </div>
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="mt-2 block w-full"
            role="img"
            aria-label={`Thirty-day Ledger chart. Latest bills cleared without review rate is ${latestRate ?? 0} percent.`}
          >
            {[100, 50, 0].map((tick) => (
              <g key={tick}>
                <line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} stroke="var(--border-default-strong)" strokeWidth="2" />
                <text x={pad.left - 8} y={y(tick) + 4} textAnchor="end" fontSize="11" fill="var(--body)">{tick}%</text>
              </g>
            ))}
            {rolling.map((point, index) => {
              const barWidth = Math.max(3, plotWidth / Math.max(rolling.length, 1) - 5);
              const barHeight = (point.volume / maxVolume) * plotHeight * 0.3;
              return (
                <rect key={point.date} x={x(index) - barWidth / 2} y={pad.top + plotHeight - barHeight}
                  width={barWidth} height={barHeight} rx="2" fill="var(--border-default-strong)">
                  <title>{point.date}: {point.volume} bills</title>
                </rect>
              );
            })}
            {linePath && <path d={linePath} fill="none" stroke="var(--brand)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />}
            {rolling.map((point, index) => point.rate !== null && (index % 5 === 0 || index === latestIndex) ? (
              <circle key={point.date} cx={x(index)} cy={y(point.rate)} r={index === latestIndex ? 5 : 3}
                fill="var(--neutral-primary-soft)" stroke="var(--brand)" strokeWidth="3">
                <title>{point.date}: {point.rate}% cleared without review, {point.volume} bills</title>
              </circle>
            ) : null)}
            {[0, 10, 20, 29].filter((index) => rolling[index]).map((index) => (
              <text key={rolling[index].date} x={x(index)} y={height - 7} textAnchor={index === 0 ? "start" : index === 29 ? "end" : "middle"} fontSize="11" fill="var(--body)">
                {new Date(`${rolling[index].date}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })}
              </text>
            ))}
          </svg>
          <table className="sr-only">
            <caption>Ledger daily volume and seven-day bills-cleared-without-review rate</caption>
            <thead><tr><th>Date</th><th>Bills</th><th>Cleared without review</th></tr></thead>
            <tbody>{rolling.map((point) => <tr key={point.date}><td>{point.date}</td><td>{point.volume}</td><td>{point.rate === null ? "Not available" : `${point.rate}%`}</td></tr>)}</tbody>
          </table>
        </>
      )}
    </figure>
  );
}

function DashboardJumpNav({ agents }: { agents: Sydekyk[] }) {
  return (
    <nav aria-label="Command center sections" className="sticky top-0 z-20 mt-4 rounded-[4px] border-2 border-ink-600 bg-ink-900/95 p-2 shadow-[var(--shadow-md)] backdrop-blur">
      <div className="flex items-center gap-2 overflow-x-auto">
        <a href="#overview" className="shrink-0 rounded-[4px] px-3 py-2 text-sm font-medium text-body hover:bg-ink-700 hover:text-heading">Overview</a>
        <a href="#quick-launch" className="shrink-0 rounded-[4px] px-3 py-2 text-sm font-medium text-body hover:bg-ink-700 hover:text-heading">Quick launch</a>
        <a href="#capacity" className="shrink-0 rounded-[4px] px-3 py-2 text-sm font-medium text-body hover:bg-ink-700 hover:text-heading">AI capacity</a>
        <span className="h-6 w-0.5 shrink-0 bg-ink-600" aria-hidden="true" />
        {agents.map((agent) => <a key={agent.id} href={`#agent-${agent.slug}`} className="shrink-0 rounded-[4px] px-3 py-2 text-sm font-medium text-gold-300 hover:bg-ink-700 hover:text-heading">{agent.name}</a>)}
      </div>
    </nav>
  );
}

function LedgerNotActivatedCard() {
  return (
    <Card className="mt-6 flex flex-col items-center gap-3 p-8 text-center">
      <span className="text-2xl">📒</span>
      <p className="text-body">
        Activate Ledger to turn vendor bills into Odoo entries automatically - and see your estimated savings here.
      </p>
      <Link to="/hq/roster">
        <Button>Activate Ledger</Button>
      </Link>
    </Card>
  );
}
