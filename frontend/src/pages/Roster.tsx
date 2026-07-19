import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Sydekyk } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useActivity } from "../lib/activity";
import { Badge, Button, Card, buttonClassName } from "../components/ui";
import { ConfirmUninstallModal } from "../components/ConfirmUninstallModal";
import { HQShell } from "../components/HQShell";
import { FUNCTION_GROUPS, functionGroupForSlug, type FunctionGroup } from "../sydekyks/registry";

type RosterView = "all" | "activated" | "available";

export default function Roster() {
  const { user } = useAuth();
  const { activeSydekykIds } = useActivity();
  const [sydekyks, setSydekyks] = useState<Sydekyk[] | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<Sydekyk | null>(null);
  const [view, setView] = useState<RosterView>("all");
  const canManage = user?.role === "commander";

  useEffect(() => {
    api.get<Sydekyk[]>("/tenant/sydekyks").then((res) => setSydekyks(res.data));
  }, []);

  async function toggleInstall(sydekyk: Sydekyk) {
    if (!canManage || sydekyk.is_exclusive) return;
    // Uninstall is destructive (wipes config) — confirm first via a dialog, never act on one click.
    if (sydekyk.installed) {
      setConfirmRemove(sydekyk);
      return;
    }
    setPendingId(sydekyk.id);
    try {
      const res = await api.post<Sydekyk>(`/tenant/sydekyks/${sydekyk.id}/install`);
      const updated = res.data;
      setSydekyks((prev) => prev?.map((s) => (s.id === updated.id ? updated : s)) ?? null);
    } finally {
      setPendingId(null);
    }
  }

  async function confirmUninstall() {
    if (!confirmRemove) return;
    setPendingId(confirmRemove.id);
    try {
      const res = await api.delete<Sydekyk>(`/tenant/sydekyks/${confirmRemove.id}/install`);
      const updated = res.data;
      setSydekyks((prev) => prev?.map((s) => (s.id === updated.id ? updated : s)) ?? null);
      setConfirmRemove(null);
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
      <div className="hq-command-background min-h-screen">
      <main id="main-content" className="relative mx-auto max-w-6xl px-6 py-10">
        <header className="typeui-grid relative overflow-hidden rounded-[4px] border-2 border-ink-600 bg-ink-900 p-6 shadow-[var(--shadow-md)] sm:p-8">
          <div className="relative grid gap-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.4px] text-gold-300">Team directory</p>
              <h1 className="mt-4 max-w-2xl text-[28px] font-bold leading-none text-heading">Your Sydekyks</h1>
              <p className="mt-4 max-w-[65ch] text-base leading-7 text-body">
                See what every specialist owns, who is ready, and who is already carrying out a mission.
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
                <section key={key} aria-labelledby={`roster-${key}`} className="py-8 first:pt-8">
                  <div className="overflow-hidden rounded-[4px] border-2 border-ink-600 bg-ink-900 shadow-[var(--shadow-xs)]">
                    <div className="flex flex-wrap items-center justify-between gap-4 border-b-2 border-ink-600 bg-ink-800 px-4 py-4 sm:px-6">
                      <div className="flex items-baseline gap-3">
                        <h2 id={`roster-${key}`} className="text-xl font-bold leading-none text-heading">{label}</h2>
                        <p className="text-xs font-medium uppercase tracking-[0.4px] text-body">Business unit</p>
                      </div>
                      <p className="text-sm text-body">{items.length} specialist{items.length === 1 ? "" : "s"}</p>
                    </div>
                    <div className="divide-y-2 divide-ink-600">
                    {items.map((agent) => (
                      <SydekykRow
                        key={agent.id}
                        sydekyk={agent}
                        canManage={canManage}
                        pending={pendingId === agent.id}
                        working={activeSydekykIds.has(agent.id)}
                        onToggleInstall={() => toggleInstall(agent)}
                      />
                    ))}
                    </div>
                  </div>
                </section>
              ))
            )}
          </>
        )}
      </main>
      </div>
      <ConfirmUninstallModal
        sydekykName={confirmRemove?.name ?? ""}
        open={confirmRemove !== null}
        pending={pendingId === confirmRemove?.id}
        onConfirm={confirmUninstall}
        onClose={() => setConfirmRemove(null)}
      />
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
          : "border-transparent text-body hover:border-ink-600 hover:text-heading"
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

function SydekykRow({
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
  const statusLabel = working ? "Mission underway" : activated ? "Standing ready" : "Available";
  const statusTone = working ? "gold" : activated ? "success" : "neutral";
  const workMode = sydekyk.accepts_document_uploads
    ? "Document intake"
    : sydekyk.workflow_enabled
      ? "Mission workflow"
      : "Collaborative workspace";

  return (
    <article className={`fx-responsive-row relative grid min-w-0 gap-4 p-4 sm:grid-cols-[72px_minmax(0,1fr)] sm:p-5 lg:grid-cols-[72px_minmax(0,1fr)_160px_220px] lg:items-center ${working ? "bg-brand-softer" : "bg-ink-900"}`}>
      <div className="relative h-[72px] w-[72px] overflow-hidden rounded-[4px] border-2 border-ink-600 bg-ink-950">
        <img src={sydekyk.avatar_url} alt="" className="absolute inset-0 h-full w-full object-contain" />
      </div>

      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h3 className="agent-name text-xl font-bold leading-tight text-heading">
            <Link to={`/hq/roster/${sydekyk.id}`} className="hover:text-gold-300">{sydekyk.name}</Link>
          </h3>
          {sydekyk.is_exclusive && <span className="text-xs font-medium uppercase tracking-[0.4px] text-gold-300">HQ exclusive</span>}
        </div>
        <p className="mt-2 max-w-[58ch] text-sm leading-6 text-body">{sydekyk.tagline}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:col-start-2 lg:col-start-auto lg:block">
        <Badge tone={statusTone}>{statusLabel}</Badge>
        <p className="text-xs text-body lg:mt-2">{workMode}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:col-start-2 lg:col-start-auto lg:justify-end">
        {activated && (
          <Link to={`/hq/roster/${sydekyk.id}`} className={buttonClassName("primary", "px-4 text-sm")}>
            Workspace
          </Link>
        )}
        {!activated && (
          <Link to={`/hq/roster/${sydekyk.id}`} className={buttonClassName("ghost", "px-4 text-sm")}>
            View details
          </Link>
        )}
        {!sydekyk.is_exclusive && canManage && (
          <Button variant={sydekyk.installed ? "ghost" : "primary"} className="px-4 text-sm" disabled={pending} onClick={onToggleInstall}>
            {pending ? (sydekyk.installed ? "Removing…" : "Adding…") : sydekyk.installed ? "Remove" : "Add to HQ"}
          </Button>
        )}
        {!sydekyk.is_exclusive && !canManage && !activated && <span className="text-sm text-body">Commander approval required</span>}
      </div>
    </article>
  );
}
