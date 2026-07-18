import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type IssuesOut, type MissionReviewItem, type Sydekyk, type TenantIssue } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Badge, Button, Card, Input } from "./ui";
import { CheckIcon, ChevronRightIcon, DocIcon, WarningIcon } from "./icons";
import { ReviewActions, ReviewBadge, formatDuration, timeAgo } from "./review";
import { registryForPlaybook } from "../sydekyks/registry";

type AttentionItem =
  | { kind: "configuration"; timestamp: string; issue: TenantIssue }
  | { kind: "mission"; timestamp: string; mission: MissionReviewItem };

const ATTENTION_PAGE_SIZE = 10;

export function AttentionWorkspace({
  sydekyks,
  sydekykId,
  focusMission,
  onSydekykChange,
}: {
  sydekyks: Sydekyk[];
  sydekykId: string;
  focusMission: string | null;
  onSydekykChange: (id: string) => void;
}) {
  const { user } = useAuth();
  const canManage = user?.role === "commander";
  const [issues, setIssues] = useState<IssuesOut | null>(null);
  const [query, setQuery] = useState("");
  const [showReviewed, setShowReviewed] = useState(Boolean(focusMission));
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(focusMission ? [focusMission] : []));
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [visibleCount, setVisibleCount] = useState(ATTENTION_PAGE_SIZE);

  const load = useCallback(() => {
    const params = sydekykId ? { sydekyk_id: sydekykId } : undefined;
    api.get<IssuesOut>("/tenant/issues", { params }).then((response) => setIssues(response.data));
  }, [sydekykId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!focusMission || !issues) return;
    setShowReviewed(true);
    setExpanded((current) => new Set(current).add(focusMission));
    requestAnimationFrame(() => {
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      document.getElementById(`mission-${focusMission}`)?.scrollIntoView({
        behavior: reduceMotion ? "auto" : "smooth",
        block: "center",
      });
    });
  }, [focusMission, issues]);

  function setBusy(id: string, busy: boolean) {
    setBusyIds((current) => {
      const next = new Set(current);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function resolve(issue: TenantIssue) {
    setBusy(issue.id, true);
    try {
      await api.post(`/tenant/issues/${issue.id}/resolve`);
      load();
    } finally {
      setBusy(issue.id, false);
    }
  }

  async function reopen(issue: TenantIssue) {
    setBusy(issue.id, true);
    try {
      await api.post(`/tenant/issues/${issue.id}/reopen`);
      load();
    } finally {
      setBusy(issue.id, false);
    }
  }

  function toggleMission(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const pendingReviews = issues?.missions_needing_review.filter((mission) => !mission.reviewed).length ?? 0;
  const configurationCount = issues?.config_issues.length ?? 0;
  const totalOpen = pendingReviews + configurationCount;
  const normalizedQuery = query.trim().toLowerCase();

  const queue = useMemo<AttentionItem[]>(() => {
    if (!issues) return [];
    const matchesIssue = (issue: TenantIssue) =>
      !normalizedQuery || [issue.title, issue.detail, issue.sydekyk_name].some((value) => value?.toLowerCase().includes(normalizedQuery));
    const matchesMission = (mission: MissionReviewItem) =>
      !normalizedQuery || [mission.document_filename, mission.reason, mission.vendor_name, mission.sydekyk_name, mission.invoice_number]
        .some((value) => value?.toLowerCase().includes(normalizedQuery));

    return [
      ...issues.config_issues.filter(matchesIssue).map((issue) => ({
        kind: "configuration" as const,
        timestamp: issue.last_seen_at,
        issue,
      })),
      ...issues.missions_needing_review
        .filter((mission) => (showReviewed || !mission.reviewed) && matchesMission(mission))
        .map((mission) => ({ kind: "mission" as const, timestamp: mission.created_at, mission })),
    ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [issues, normalizedQuery, showReviewed]);

  useEffect(() => {
    setVisibleCount(ATTENTION_PAGE_SIZE);
  }, [normalizedQuery, showReviewed, sydekykId]);

  useEffect(() => {
    if (!focusMission) return;
    const index = queue.findIndex((item) => item.kind === "mission" && item.mission.mission_id === focusMission);
    if (index >= 0) setVisibleCount(Math.max(ATTENTION_PAGE_SIZE, index + 1));
  }, [focusMission, queue]);

  const visibleQueue = queue.slice(0, visibleCount);

  return (
    <div className="mt-6 grid min-w-0 gap-6">
      <Card className="p-4">
        <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(14rem,20rem)_auto] lg:items-end">
          <div className="min-w-0">
            <label htmlFor="attention-search" className="mb-2 block text-sm font-medium text-heading">Search the attention queue</label>
            <Input
              id="attention-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Mission, agent, vendor, or blocker"
            />
          </div>
          <div className="min-w-0">
            <label htmlFor="attention-agent" className="mb-2 block text-sm font-medium text-heading">Agent</label>
            <div className="relative">
              <select
                id="attention-agent"
                value={sydekykId}
                onChange={(event) => onSydekykChange(event.target.value)}
                className="w-full appearance-none rounded-[4px] border-2 border-ink-600 bg-ink-800 px-4 py-3 pr-12 text-base text-heading focus:border-gold-500"
              >
                <option value="">All agents</option>
                {sydekyks.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
              </select>
              <ChevronRightIcon className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 rotate-90 text-body" />
            </div>
          </div>
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium text-body">
            <input
              type="checkbox"
              className="h-5 w-5 shrink-0 accent-gold-500"
              checked={showReviewed}
              onChange={(event) => setShowReviewed(event.target.checked)}
            />
            Show reviewed
          </label>
        </div>
      </Card>

      {!issues ? (
        <Card className="p-8" role="status"><p className="text-base text-body">Gathering missions that need command review…</p></Card>
      ) : (
        <>
          <section aria-labelledby="attention-summary-title" className="grid gap-4 sm:grid-cols-3">
            <h2 id="attention-summary-title" className="sr-only">Attention summary</h2>
            <AttentionStat label="Needs command" value={totalOpen} emphasis={totalOpen > 0} />
            <AttentionStat label="Mission reviews" value={pendingReviews} />
            <AttentionStat label="Setup blockers" value={configurationCount} />
          </section>

          <section aria-labelledby="attention-queue-title" className="min-w-0">
            <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.4px] text-gold-300">Unified workstream</p>
                <h2 id="attention-queue-title" className="mt-2 text-xl font-bold leading-none text-heading">Attention queue</h2>
              </div>
              <p className="text-sm text-body">Newest signals first</p>
            </div>

            {queue.length === 0 ? (
              <Card className="p-8 text-center">
                <CheckIcon className="mx-auto h-10 w-10 text-success" />
                <h3 className="mt-6 text-xl font-bold text-heading">All clear</h3>
                <p className="mt-4 text-base text-body">No configuration blockers or mission decisions match this view.</p>
              </Card>
            ) : (
              <div className="grid min-w-0 gap-3">
                {visibleQueue.map((item) => item.kind === "configuration" ? (
                  <ConfigurationAttentionCard
                    key={`config-${item.issue.id}`}
                    issue={item.issue}
                    canManage={canManage}
                    busy={busyIds.has(item.issue.id)}
                    onResolve={() => resolve(item.issue)}
                  />
                ) : (
                  <MissionAttentionCard
                    key={`mission-${item.mission.mission_id}`}
                    mission={item.mission}
                    expanded={expanded.has(item.mission.mission_id)}
                    onToggle={() => toggleMission(item.mission.mission_id)}
                    onChanged={load}
                  />
                ))}
                {visibleCount < queue.length && (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-[4px] border-2 border-ink-600 bg-ink-900 p-3">
                    <p className="text-sm text-body">Showing {visibleQueue.length} of {queue.length} attention items</p>
                    <Button variant="ghost" onClick={() => setVisibleCount((count) => count + ATTENTION_PAGE_SIZE)}>
                      Load {Math.min(ATTENTION_PAGE_SIZE, queue.length - visibleCount)} more
                    </Button>
                  </div>
                )}
              </div>
            )}
          </section>

          {issues.resolved_issues.length > 0 && (
            <details className="rounded-[4px] border-2 border-ink-600 bg-ink-900 p-4 shadow-[var(--shadow-xs)]">
              <summary className="flex min-h-11 cursor-pointer items-center text-base font-medium text-heading">
                Resolved setup blockers ({issues.resolved_issues.length})
              </summary>
              <div className="mt-4 grid gap-3">
                {issues.resolved_issues.map((issue) => (
                  <div key={issue.id} className="flex min-w-0 flex-col gap-4 border-t-2 border-ink-700 pt-4 first:border-0 first:pt-0 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="break-words text-base font-medium text-heading">{issue.title}</p>
                      <p className="mt-2 text-sm text-body">Resolved {issue.resolved_at ? timeAgo(issue.resolved_at) : "recently"}</p>
                    </div>
                    {canManage && <Button variant="ghost" disabled={busyIds.has(issue.id)} onClick={() => reopen(issue)}>{busyIds.has(issue.id) ? "Reopening…" : "Reopen blocker"}</Button>}
                  </div>
                ))}
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}

function AttentionStat({ label, value, emphasis = false }: { label: string; value: number; emphasis?: boolean }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium uppercase tracking-[0.4px] text-body">{label}</p>
      <p className={`mt-2 text-3xl font-bold tabular-nums ${emphasis ? "text-warning-fg" : "text-heading"}`}>{value}</p>
    </Card>
  );
}

function ConfigurationAttentionCard({
  issue,
  canManage,
  busy,
  onResolve,
}: {
  issue: TenantIssue;
  canManage: boolean;
  busy: boolean;
  onResolve: () => void;
}) {
  return (
    <article className="min-w-0 rounded-[4px] border-2 border-l-4 border-ink-600 border-l-amber-500 bg-ink-900 p-4 shadow-[var(--shadow-xs)]">
      <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 gap-4">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[4px] border-2 border-warning bg-warning-soft text-warning-fg">
            <WarningIcon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="danger">Setup blocker</Badge>
              {issue.sydekyk_name && <Badge tone="neutral">{issue.sydekyk_name}</Badge>}
            </div>
            <h3 className="mt-3 break-words text-base font-bold leading-tight text-heading">{issue.title}</h3>
            {issue.detail && <p className="mt-2 max-w-[65ch] break-words text-sm leading-6 text-body">{issue.detail}</p>}
            <p className="mt-2 text-sm text-body">Seen {issue.occurrence_count}× · last reported {timeAgo(issue.last_seen_at)}</p>
            {issue.odoo_bill_url && (
              <a href={issue.odoo_bill_url} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex min-h-11 items-center text-base font-medium text-gold-300 hover:text-heading">
                Open the affected draft in Odoo →
              </a>
            )}
          </div>
        </div>
        {canManage && <Button variant="ghost" disabled={busy} onClick={onResolve}>{busy ? "Resolving…" : "Mark blocker resolved"}</Button>}
      </div>
    </article>
  );
}

function MissionAttentionCard({
  mission,
  expanded,
  onToggle,
  onChanged,
}: {
  mission: MissionReviewItem;
  expanded: boolean;
  onToggle: () => void;
  onChanged: () => void;
}) {
  const registry = registryForPlaybook(mission.playbook_key ?? undefined);
  const label = registry?.missionRowLabel?.({ ...mission, id: mission.mission_id }) ?? { title: mission.document_filename ?? "Mission awaiting review" };
  const duration = mission.completed_at ? formatDuration(mission.created_at, mission.completed_at) : null;

  return (
    <article id={`mission-${mission.mission_id}`} className="min-w-0 scroll-mt-24 rounded-[4px] border-2 border-l-4 border-ink-600 border-l-red-500 bg-ink-900 shadow-[var(--shadow-xs)]">
      <button type="button" aria-expanded={expanded} onClick={onToggle} className="flex min-h-11 w-full min-w-0 items-start gap-4 p-4 text-left transition-colors hover:bg-ink-800">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[4px] border-2 border-gold-700 bg-brand-softer text-gold-300">
          {mission.reviewed ? <CheckIcon className="h-5 w-5" /> : <DocIcon className="h-5 w-5" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone="danger">Mission review</Badge>
            {mission.sydekyk_name && <Badge tone="neutral">{mission.sydekyk_name}</Badge>}
            <ReviewBadge reviewed={mission.reviewed} needsReview />
          </span>
          <span className={`mt-3 block break-words text-base font-bold leading-tight ${label.muted ? "text-body" : "text-heading"}`}>{label.title}</span>
          <span className="mt-2 block break-words text-sm leading-6 text-body">
            {mission.reason ?? "This mission was flagged for a command decision."}
            {duration ? ` · completed in ${duration}` : ""} · {timeAgo(mission.created_at)}
          </span>
          <span className="mt-2 block text-sm font-medium text-gold-300">{expanded ? "Hide review controls" : "Open review controls"}</span>
        </span>
      </button>

      {expanded && (
        <div className="min-w-0 border-t-2 border-ink-600 bg-ink-950/40 p-4">
          {(mission.vendor_name || mission.invoice_number || mission.total != null || mission.duplicate) && (
            <dl className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {mission.vendor_name && <Detail label="Vendor" value={mission.vendor_name} />}
              {mission.invoice_number && <Detail label="Invoice" value={mission.invoice_number} />}
              {mission.total != null && <Detail label="Total" value={`${mission.total.toLocaleString()} ${mission.currency ?? ""}`.trim()} />}
              {mission.duplicate && <Detail label="Flag" value="Suspected duplicate" />}
              {mission.posted != null && <Detail label="Auto-posted" value={mission.posted ? "Yes" : "No"} />}
            </dl>
          )}
          <div className="mt-4 min-w-0">
            <ReviewActions
              target={{
                missionId: mission.mission_id,
                needsReview: true,
                reviewed: mission.reviewed,
                reviewedByEmail: mission.reviewed_by_email,
                reviewedAt: mission.reviewed_at,
                odooBillUrl: mission.odoo_bill_url,
                odooRecordUrl: mission.odoo_record_url,
                odooRecordLabel: mission.odoo_record_label,
                recordKind: registry?.domain === "hr" ? "applicant" : "bill",
                canRetry: true,
              }}
              onChanged={onChanged}
            />
          </div>
        </div>
      )}
    </article>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase tracking-[0.4px] text-body">{label}</dt>
      <dd className="mt-2 break-words text-base text-heading">{value}</dd>
    </div>
  );
}
