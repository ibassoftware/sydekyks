import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Sydekyk } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useActivity } from "../lib/activity";
import { Badge, Button, Card } from "../components/ui";
import { HQShell } from "../components/HQShell";
import { FUNCTION_GROUPS, functionGroupForSlug, type FunctionGroup } from "../sydekyks/registry";

type RosterView = "all" | "activated" | "available";

export default function Roster() {
  const { user } = useAuth();
  const { activeSydekykIds } = useActivity();
  const [sydekyks, setSydekyks] = useState<Sydekyk[] | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [view, setView] = useState<RosterView>("all");
  const canManage = user?.role === "commander";

  useEffect(() => {
    api.get<Sydekyk[]>("/tenant/sydekyks").then((res) => setSydekyks(res.data));
  }, []);

  async function toggleInstall(sydekyk: Sydekyk) {
    if (!canManage || sydekyk.is_exclusive) return;
    setPendingId(sydekyk.id);
    try {
      const res = sydekyk.installed
        ? await api.delete<Sydekyk>(`/tenant/sydekyks/${sydekyk.id}/install`)
        : await api.post<Sydekyk>(`/tenant/sydekyks/${sydekyk.id}/install`);
      const updated = res.data;
      setSydekyks((prev) => prev?.map((s) => (s.id === updated.id ? updated : s)) ?? null);
    } finally {
      setPendingId(null);
    }
  }

  const activatedCount = sydekyks?.filter((agent) => agent.installed || agent.is_exclusive).length ?? 0;
  const availableCount = sydekyks?.filter((agent) => !agent.installed && !agent.is_exclusive).length ?? 0;
  const visibleAgents = (sydekyks ?? []).filter((agent) => {
    if (view === "activated") return agent.installed || agent.is_exclusive;
    if (view === "available") return !agent.installed && !agent.is_exclusive;
    return true;
  });

  return (
    <HQShell>
      <main id="main-content" className="mx-auto max-w-6xl px-6 py-12">
        <header className="typeui-grid relative overflow-hidden rounded-[4px] border-2 border-ink-600 bg-ink-900 p-6 shadow-[var(--shadow-md)] sm:p-8">
          <div className="relative grid gap-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.4px] text-gold-300">Roster command</p>
              <h1 className="mt-4 max-w-2xl text-[28px] font-bold leading-none text-heading">Choose who answers the call</h1>
              <p className="mt-4 max-w-[65ch] text-base leading-7 text-body">
                Organize your AI team by business function, see who is already on duty, and bring another specialist into HQ when the mission demands it.
              </p>
            </div>
            <dl className="grid grid-cols-3 gap-4 border-t-2 border-ink-600 pt-6 lg:border-l-2 lg:border-t-0 lg:pl-8 lg:pt-0">
              <RosterStat label="Roster" value={sydekyks?.length ?? 0} />
              <RosterStat label="On duty" value={activatedCount} />
              <RosterStat label="In action" value={activeSydekykIds.size} />
            </dl>
          </div>
        </header>

        {!sydekyks ? (
          <Card className="mt-8 p-8" role="status">
            <p className="text-base text-body">Scanning the roster…</p>
          </Card>
        ) : sydekyks.length === 0 ? (
          <Card className="mt-8 p-10 text-center">
            <h2 className="text-xl font-bold text-heading">The roster is gathering</h2>
            <p className="mt-4 text-base text-body">New Sydekyks will appear here as soon as they are available.</p>
          </Card>
        ) : (
          <>
            <div role="group" aria-label="Filter roster" className="mt-8 border-b-2 border-ink-600">
              <div className="flex flex-wrap gap-1">
                <RosterTab active={view === "all"} count={sydekyks.length} onClick={() => setView("all")}>Full roster</RosterTab>
                <RosterTab active={view === "activated"} count={activatedCount} onClick={() => setView("activated")}>On duty</RosterTab>
                <RosterTab active={view === "available"} count={availableCount} onClick={() => setView("available")}>Available</RosterTab>
              </div>
            </div>

            {visibleAgents.length === 0 ? (
              <Card className="mt-8 p-8 text-center">
                <h2 className="text-xl font-bold text-heading">No agents in this view</h2>
                <p className="mt-4 text-base text-body">Choose another roster view to see the full team.</p>
              </Card>
            ) : (
              groupByFunction(visibleAgents).map(({ key, label, items }) => (
                <section key={key} aria-labelledby={`roster-${key}`} className="py-12 first:pt-10">
                  <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-[0.4px] text-gold-300">Business unit</p>
                      <h2 id={`roster-${key}`} className="mt-3 text-2xl font-bold leading-none text-heading">{label}</h2>
                    </div>
                    <p className="text-sm text-body">{items.length} specialist{items.length === 1 ? "" : "s"}</p>
                  </div>
                  <div className="grid gap-6 xl:grid-cols-2">
                    {items.map((agent) => (
                      <SydekykCard
                        key={agent.id}
                        sydekyk={agent}
                        canManage={canManage}
                        pending={pendingId === agent.id}
                        working={activeSydekykIds.has(agent.id)}
                        onToggleInstall={() => toggleInstall(agent)}
                      />
                    ))}
                  </div>
                </section>
              ))
            )}
          </>
        )}
      </main>
    </HQShell>
  );
}

function RosterStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-16">
      <dt className="text-xs font-medium uppercase tracking-[0.4px] text-body">{label}</dt>
      <dd className="mt-2 text-2xl font-bold tabular-nums text-heading">{value}</dd>
    </div>
  );
}

function RosterTab({
  active,
  count,
  onClick,
  children,
}: {
  active: boolean;
  count: number;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex min-h-11 shrink-0 items-center gap-2 border-b-[3px] px-4 py-3 text-base font-medium transition-colors ${
        active
          ? "border-gold-400 text-gold-300"
          : "border-transparent text-body hover:border-ink-500 hover:text-heading"
      }`}
    >
      {children}
      <span className="rounded-[2px] border-2 border-ink-600 bg-ink-800 px-2 py-0.5 text-xs text-heading">{count}</span>
    </button>
  );
}

/** Group the roster by business function (Sales · Accounting · HR), in that order, with any
 * unmapped or exclusive Sydekyks collected under "Specialists" at the end. Empty groups are dropped. */
function groupByFunction(sydekyks: Sydekyk[]): { key: string; label: string; items: Sydekyk[] }[] {
  const buckets = new Map<FunctionGroup, Sydekyk[]>();
  const other: Sydekyk[] = [];
  for (const s of sydekyks) {
    const group = functionGroupForSlug(s.slug);
    if (group) buckets.set(group, [...(buckets.get(group) ?? []), s]);
    else other.push(s);
  }
  const groups: { key: string; label: string; items: Sydekyk[] }[] = FUNCTION_GROUPS.filter(
    (group) => buckets.get(group.key)?.length,
  ).map((group) => ({
    key: group.key,
    label: group.label,
    items: buckets.get(group.key)!,
  }));
  if (other.length) groups.push({ key: "other", label: "Specialists", items: other });
  return groups;
}

function SydekykCard({
  sydekyk,
  canManage,
  pending,
  working,
  onToggleInstall,
}: {
  sydekyk: Sydekyk;
  canManage: boolean;
  pending: boolean;
  working: boolean;
  onToggleInstall: () => void;
}) {
  const activated = sydekyk.installed || sydekyk.is_exclusive;
  const statusLabel = working ? "On a mission" : activated ? "Standing by" : "Available to recruit";
  const statusTone = working || activated ? "gold" : "neutral";

  return (
    <article className={`grid min-w-0 overflow-hidden rounded-[4px] border-2 bg-ink-900 shadow-[var(--shadow-xs)] sm:grid-cols-[160px_minmax(0,1fr)] ${working ? "border-gold-500" : "border-ink-600"}`}>
      <div className="relative min-h-64 overflow-hidden border-b-2 border-ink-600 bg-ink-950 sm:min-h-full sm:border-b-0 sm:border-r-2">
        <img src={sydekyk.avatar_url} alt={sydekyk.name} className="absolute inset-0 h-full w-full object-contain" />
      </div>

      <div className="flex min-w-0 flex-col p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-[0.4px] text-body">{sydekyk.is_exclusive ? "HQ exclusive" : "Shared specialist"}</p>
            <h3 className="agent-name mt-3 text-xl font-bold leading-tight text-heading">{sydekyk.name}</h3>
          </div>
          <Badge tone={statusTone}>{statusLabel}</Badge>
        </div>

        <p className="mt-4 text-base leading-7 text-body">{sydekyk.tagline}</p>

        <div className="mt-6 flex flex-wrap gap-2" aria-label={`${sydekyk.name} capabilities`}>
          {sydekyk.chat_enabled && <Badge tone="neutral">Chat</Badge>}
          {sydekyk.workflow_enabled && <Badge tone="neutral">Workflow</Badge>}
          {sydekyk.is_exclusive && <Badge tone="gold">Exclusive</Badge>}
        </div>

        <div className="mt-auto flex flex-wrap items-center gap-4 pt-8">
          <Link to={`/hq/roster/${sydekyk.id}`} className="inline-flex min-h-11 items-center text-base font-medium text-gold-300 hover:text-heading">
            View command post →
          </Link>
          {sydekyk.is_exclusive ? (
            <span className="ml-auto inline-flex min-h-11 items-center gap-2 text-sm font-medium text-body">
              <span className="h-2 w-2 rounded-full bg-gold-400" aria-hidden="true" />Always on duty
            </span>
          ) : canManage ? (
            <Button variant={sydekyk.installed ? "ghost" : "primary"} className="ml-auto" disabled={pending} onClick={onToggleInstall}>
              {pending ? (sydekyk.installed ? "Retiring…" : "Recruiting…") : sydekyk.installed ? "Retire from HQ" : "Recruit to HQ"}
            </Button>
          ) : (
            <span className="ml-auto text-sm text-body">Commander approval required</span>
          )}
        </div>
      </div>
    </article>
  );
}
