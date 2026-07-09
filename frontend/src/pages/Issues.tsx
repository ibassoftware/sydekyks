import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useSearchParams } from "react-router-dom";
import { api, type IssuesOut, type MissionReviewItem, type Sydekyk, type TenantIssue } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Badge, Button, Card } from "../components/ui";
import { HQShell } from "../components/HQShell";
import { CheckIcon, DocIcon, WarningIcon } from "../components/icons";
import { ReviewActions, ReviewBadge, timeAgo, formatDuration } from "../components/review";
import { registryForPlaybook } from "../sydekyks/registry";

export default function Issues() {
  const { user } = useAuth();
  const canManage = user?.role === "commander";
  const [searchParams, setSearchParams] = useSearchParams();
  const sydekykId = searchParams.get("sydekyk_id");
  const focusMission = searchParams.get("mission");

  const [sydekyks, setSydekyks] = useState<Sydekyk[]>([]);
  const [query, setQuery] = useState("");
  const [showReviewed, setShowReviewed] = useState(true);
  const [issues, setIssues] = useState<IssuesOut | null>(null);
  const [leavingIds, setLeavingIds] = useState<Set<string>>(new Set());
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [showResolved, setShowResolved] = useState(false);
  const [undoIssue, setUndoIssue] = useState<TenantIssue | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const undoTimerRef = useRef<number | null>(null);

  const load = useCallback(() => {
    const params = sydekykId ? { sydekyk_id: sydekykId } : undefined;
    api.get<IssuesOut>("/tenant/issues", { params }).then((res) => setIssues(res.data));
  }, [sydekykId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    api.get<Sydekyk[]>("/tenant/sydekyks").then((r) => setSydekyks(r.data)).catch(() => setSydekyks([]));
  }, []);

  // Deep link from a "Review →" link: auto-expand the targeted Mission and scroll it into view, so
  // the user lands directly on the bill instead of hunting for it.
  useEffect(() => {
    if (!focusMission || !issues) return;
    setExpanded((prev) => (prev.has(focusMission) ? prev : new Set(prev).add(focusMission)));
    requestAnimationFrame(() => {
      document.getElementById(`mission-${focusMission}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, [focusMission, issues]);

  function setSydekykFilter(id: string) {
    const next = new URLSearchParams(searchParams);
    if (id) next.set("sydekyk_id", id);
    else next.delete("sydekyk_id");
    setSearchParams(next);
  }

  useEffect(() => () => {
    if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current);
  }, []);

  function triggerUndo(issue: TenantIssue) {
    if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current);
    setUndoIssue(issue);
    undoTimerRef.current = window.setTimeout(() => setUndoIssue(null), 6000);
  }

  function markBusy(id: string, busy: boolean) {
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function resolve(issue: TenantIssue) {
    markBusy(issue.id, true);
    setLeavingIds((prev) => new Set(prev).add(issue.id));
    window.setTimeout(() => {
      setIssues((prev) =>
        prev
          ? {
              ...prev,
              config_issues: prev.config_issues.filter((i) => i.id !== issue.id),
              resolved_issues: [
                { ...issue, status: "resolved", resolved_at: new Date().toISOString() },
                ...prev.resolved_issues,
              ],
            }
          : prev
      );
      setLeavingIds((prev) => {
        const next = new Set(prev);
        next.delete(issue.id);
        return next;
      });
      markBusy(issue.id, false);
      triggerUndo(issue);
    }, 220);
    api.post(`/tenant/issues/${issue.id}/resolve`).catch(load);
  }

  function reopen(issue: TenantIssue) {
    markBusy(issue.id, true);
    setIssues((prev) =>
      prev
        ? {
            ...prev,
            resolved_issues: prev.resolved_issues.filter((i) => i.id !== issue.id),
            config_issues: [{ ...issue, status: "open", resolved_at: null }, ...prev.config_issues],
          }
        : prev
    );
    markBusy(issue.id, false);
    api.post(`/tenant/issues/${issue.id}/reopen`).catch(load);
  }

  function handleUndoClick() {
    if (!undoIssue) return;
    const issue = undoIssue;
    setUndoIssue(null);
    if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current);
    reopen(issue);
  }

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const openCount = issues?.config_issues.length ?? 0;
  // Only Missions still awaiting review count as "needs attention"; reviewed ones stay listed with a badge.
  const flaggedCount = issues?.missions_needing_review.filter((m) => !m.reviewed).length ?? 0;
  const totalOpen = openCount + flaggedCount;

  // Client-side text search + show/hide reviewed, applied to the displayed lists (stat tiles stay full).
  const q = query.trim().toLowerCase();
  const matchIssue = (i: TenantIssue) => !q || [i.title, i.detail, i.sydekyk_name].some((v) => v?.toLowerCase().includes(q));
  const matchMission = (m: MissionReviewItem) =>
    !q || [m.document_filename, m.reason, m.vendor_name, m.sydekyk_name, m.invoice_number].some((v) => v?.toLowerCase().includes(q));
  const visibleConfig = issues ? issues.config_issues.filter(matchIssue) : [];
  const visibleMissions = issues
    ? issues.missions_needing_review.filter((m) => (showReviewed || !m.reviewed) && matchMission(m))
    : [];

  return (
    <HQShell>
      <main className="mx-auto max-w-5xl px-6 py-10">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-gold-500">Attention Needed</p>
          <h1 className="mt-1 text-3xl font-bold text-[#f5eee0]">Issues</h1>
        </div>

        <Card className="mt-6 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <select
              className="rounded-md border border-ink-600 bg-ink-900 px-3 py-2 text-sm text-[#ede6da] outline-none focus:border-gold-500"
              value={sydekykId ?? ""}
              onChange={(e) => setSydekykFilter(e.target.value)}
            >
              <option value="">All Sydekyks</option>
              {sydekyks.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <input
              className="min-w-[200px] flex-1 rounded-md border border-ink-600 bg-ink-900 px-3 py-2 text-sm text-[#ede6da] outline-none focus:border-gold-500"
              placeholder="Search issues & bills…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <label className="flex shrink-0 items-center gap-2 text-xs text-[#b9ad98]">
              <input type="checkbox" className="h-4 w-4 accent-gold-500" checked={showReviewed} onChange={(e) => setShowReviewed(e.target.checked)} />
              Show reviewed
            </label>
          </div>
        </Card>

        {!issues ? (
          <p className="mt-8 text-sm text-[#b9ad98]">Loading…</p>
        ) : (
          <div className="mt-8 grid gap-6">
            {/* Hero: celebratory all-clear, or an urgency banner */}
            {totalOpen === 0 ? (
              <Card className="relative overflow-hidden p-10 text-center">
                <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-gold-500/10 blur-3xl" />
                <div className="pointer-events-none absolute -bottom-24 -left-24 h-72 w-72 rounded-full bg-gold-500/10 blur-3xl" />
                <div className="relative">
                  <div
                    className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-gold-500/10 text-gold-400 shadow-[0_0_40px_-8px_rgba(212,168,40,0.6)]"
                    style={{ animation: "popIn 0.5s ease-out" }}
                  >
                    <CheckIcon className="h-9 w-9" />
                  </div>
                  <h2 className="mt-5 text-2xl font-bold text-[#f5eee0]">All clear</h2>
                  <p className="mx-auto mt-1.5 max-w-md text-sm text-[#b9ad98]">
                    Nothing needs your attention right now — your Sydekyks are running smoothly.
                  </p>
                </div>
              </Card>
            ) : (
              <Card className="relative overflow-hidden p-6">
                <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-red-500/10 blur-3xl" />
                <div className="relative flex flex-wrap items-center gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-red-500/10 text-red-400">
                    <WarningIcon className="h-6 w-6" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-widest text-red-400/90">Action needed</p>
                    <h2 className="mt-0.5 text-xl font-bold text-[#f5eee0]">
                      {totalOpen} {totalOpen === 1 ? "thing needs" : "things need"} your attention
                    </h2>
                  </div>
                </div>
              </Card>
            )}

            {/* Stat tiles */}
            <div className="grid gap-4 sm:grid-cols-3">
              <Card className="p-5">
                <p className="text-xs font-semibold uppercase tracking-wider text-gold-500">Config Issues</p>
                <p className="mt-2 text-3xl font-bold text-[#f5eee0]">{openCount}</p>
              </Card>
              <Card className="p-5">
                <p className="text-xs font-semibold uppercase tracking-wider text-gold-500">Missions Flagged</p>
                <p className="mt-2 text-3xl font-bold text-[#f5eee0]">{flaggedCount}</p>
              </Card>
              <Card className="p-5">
                <p className="text-xs font-semibold uppercase tracking-wider text-gold-500">Recently Resolved</p>
                <p className="mt-2 text-3xl font-bold text-[#f5eee0]">{issues.resolved_issues.length}</p>
              </Card>
            </div>

            {/* Config issues */}
            {visibleConfig.length > 0 && (
              <section>
                <p className="text-xs font-semibold uppercase tracking-wider text-gold-500">Configuration Issues</p>
                <div className="mt-3 grid gap-3">
                  {visibleConfig.map((issue, i) => (
                    <div
                      key={issue.id}
                      style={{ animation: `fadeIn 0.3s ease-out ${i * 40}ms both` }}
                      className={`transition-all duration-200 ease-out ${
                        leavingIds.has(issue.id) ? "scale-95 opacity-0" : "scale-100 opacity-100"
                      }`}
                    >
                      <Card className="relative overflow-hidden p-4">
                        <div className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-red-500 to-amber-500" />
                        <div className="flex items-start justify-between gap-4 pl-3">
                          <div className="flex min-w-0 gap-3">
                            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-500/10 text-red-400">
                              <WarningIcon className="h-4 w-4" />
                            </div>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-sm font-semibold text-[#ede6da]">{issue.title}</p>
                                {issue.sydekyk_name && <Badge tone="neutral">{issue.sydekyk_name}</Badge>}
                              </div>
                              {issue.detail && <p className="mt-1 text-sm text-[#b9ad98]">{issue.detail}</p>}
                              <div className="mt-2 flex flex-wrap items-center gap-3">
                                <p className="text-xs text-[#8a7f6d]">
                                  Seen {issue.occurrence_count}× · last {timeAgo(issue.last_seen_at)}
                                </p>
                                {issue.odoo_bill_url && (
                                  <a
                                    href={issue.odoo_bill_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-xs font-semibold text-gold-400 hover:text-gold-300"
                                  >
                                    Review draft in Odoo →
                                  </a>
                                )}
                              </div>
                              {issue.odoo_bill_url && (
                                <p className="mt-1 text-[11px] text-[#8a7f6d]">
                                  A draft bill was created but not posted — add the tax and post it once fixed.
                                </p>
                              )}
                            </div>
                          </div>
                          {canManage && (
                            <Button
                              variant="ghost"
                              className="shrink-0 px-3 py-1.5 text-xs"
                              disabled={busyIds.has(issue.id)}
                              onClick={() => resolve(issue)}
                            >
                              {busyIds.has(issue.id) ? "…" : "Mark resolved"}
                            </Button>
                          )}
                        </div>
                      </Card>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Missions needing review */}
            {visibleMissions.length > 0 && (
              <section>
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wider text-gold-500">Missions Needing Review</p>
                  <Link to="/hq/missions" className="text-xs font-semibold text-gold-400 hover:text-gold-300">
                    View all Missions →
                  </Link>
                </div>
                <div className="mt-3 divide-y divide-ink-700/60 overflow-hidden rounded-lg border border-ink-700">
                  {visibleMissions.map((m) => {
                    const open = expanded.has(m.mission_id);
                    const reg = registryForPlaybook(m.playbook_key ?? undefined);
                    const label = reg?.missionRowLabel?.(m) ?? { title: m.document_filename ?? "document" };
                    const hr = reg?.domain === "hr";
                    const duration = m.completed_at ? formatDuration(m.created_at, m.completed_at) : null;
                    return (
                      <div
                        id={`mission-${m.mission_id}`}
                        key={m.mission_id}
                        className={`scroll-mt-24 ${m.reviewed ? "bg-ink-900/30" : hr ? "bg-blue-500/[0.035]" : ""}`}
                      >
                        <button
                          onClick={() => toggleExpand(m.mission_id)}
                          className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors ${
                            hr ? "hover:bg-blue-500/[0.07]" : "hover:bg-ink-800/40"
                          }`}
                        >
                          <div
                            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                              m.reviewed ? "bg-gold-500/10 text-gold-400" : "bg-amber-500/10 text-amber-400"
                            }`}
                          >
                            {m.reviewed ? <CheckIcon className="h-3.5 w-3.5" /> : <DocIcon className="h-3.5 w-3.5" />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              {m.sydekyk_name && (
                                <span
                                  className={`shrink-0 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${
                                    hr
                                      ? "border-blue-400/40 bg-blue-500/10 text-blue-200"
                                      : "border-gold-600/40 bg-gold-500/10 text-gold-300"
                                  }`}
                                >
                                  {m.sydekyk_name}
                                </span>
                              )}
                              <p className={`truncate text-sm font-medium ${label.muted ? "text-[#8a7f6d]" : "text-[#ede6da]"}`}>
                                {label.title}
                              </p>
                              <ReviewBadge reviewed={m.reviewed} needsReview />
                            </div>
                            <p className="mt-0.5 truncate text-xs text-[#8a7f6d]">
                              {m.document_filename ? `${m.document_filename} · ` : ""}
                              {m.reason ?? "Flagged for review"}
                              {duration && (
                                <>
                                  {" · Done "}
                                  <span className="font-semibold text-gold-300">in {duration}</span>
                                </>
                              )}
                            </p>
                          </div>
                          <span className="shrink-0 text-xs text-[#8a7f6d]">{timeAgo(m.created_at)}</span>
                          <span className="shrink-0 text-[#8a7f6d]">{open ? "▾" : "▸"}</span>
                        </button>

                        {open && (
                          <div className="border-t border-ink-700/60 bg-ink-900/40 px-4 py-4">
                            <p className="text-xs font-semibold uppercase tracking-wider text-gold-500">Why it needs review</p>
                            <p className="mt-1 text-sm text-[#d8cdb9]">{m.reason ?? "The Playbook flagged this Mission for a human to review."}</p>

                            {(m.vendor_name || m.invoice_number || m.total != null) && (
                              <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-3">
                                {m.vendor_name && <Detail label="Vendor" value={m.vendor_name} />}
                                {m.invoice_number && <Detail label="Invoice #" value={m.invoice_number} />}
                                {m.total != null && (
                                  <Detail label="Total" value={`${m.total.toLocaleString()} ${m.currency ?? ""}`.trim()} />
                                )}
                                {m.duplicate && <Detail label="Flag" value="Suspected duplicate" />}
                                <Detail label="Auto-posted" value={m.posted ? "Yes" : "No"} />
                              </div>
                            )}

                            <div className="mt-4">
                              <ReviewActions
                                target={{
                                  missionId: m.mission_id,
                                  needsReview: true,
                                  reviewed: m.reviewed,
                                  reviewedByEmail: m.reviewed_by_email,
                                  reviewedAt: m.reviewed_at,
                                  odooBillUrl: m.odoo_bill_url,
                                  odooRecordUrl: m.odoo_record_url,
                                  odooRecordLabel: m.odoo_record_label,
                                  recordKind: registryForPlaybook(m.playbook_key ?? undefined)?.domain === "hr" ? "applicant" : "bill",
                                  canRetry: true,
                                }}
                                onChanged={load}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Recently resolved (collapsible, reopenable) */}
            {issues.resolved_issues.length > 0 && (
              <section>
                <button onClick={() => setShowResolved((v) => !v)} className="flex w-full items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wider text-gold-500">
                    Recently Resolved ({issues.resolved_issues.length})
                  </p>
                  <span className="text-xs text-[#8a7f6d]">{showResolved ? "Hide ▲" : "Show ▼"}</span>
                </button>
                {showResolved && (
                  <div className="mt-3 grid gap-2">
                    {issues.resolved_issues.map((issue) => (
                      <div
                        key={issue.id}
                        style={{ animation: "fadeIn 0.2s ease-out" }}
                        className="flex items-center justify-between gap-4 rounded-lg border border-ink-700 bg-ink-900/40 px-4 py-3"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <CheckIcon className="h-4 w-4 shrink-0 text-gold-400" />
                          <div className="min-w-0">
                            <p className="truncate text-sm text-[#b9ad98] line-through decoration-[#8a7f6d]/50">
                              {issue.title}
                            </p>
                            <div className="flex flex-wrap items-center gap-3">
                              <p className="text-xs text-[#8a7f6d]">
                                Resolved {issue.resolved_at ? timeAgo(issue.resolved_at) : ""}
                              </p>
                              {issue.odoo_bill_url && (
                                <a
                                  href={issue.odoo_bill_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-xs font-semibold text-gold-400 hover:text-gold-300"
                                >
                                  Open bill in Odoo →
                                </a>
                              )}
                            </div>
                          </div>
                        </div>
                        {canManage && (
                          <Button
                            variant="ghost"
                            className="shrink-0 px-3 py-1.5 text-xs"
                            disabled={busyIds.has(issue.id)}
                            onClick={() => reopen(issue)}
                          >
                            {busyIds.has(issue.id) ? "…" : "Reopen"}
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}
          </div>
        )}
      </main>

      {undoIssue &&
        createPortal(
          <div className="pointer-events-none fixed bottom-4 right-4 z-50">
            <div
              className="pointer-events-auto relative w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-gold-600/40 bg-gradient-to-b from-ink-800 to-ink-900 p-4 shadow-xl"
              style={{ animation: "fadeIn 0.2s ease-out" }}
            >
              <div className="flex items-center gap-3">
                <CheckIcon className="h-5 w-5 shrink-0 text-gold-400" />
                <p className="min-w-0 flex-1 truncate text-sm text-[#ede6da]">Issue resolved</p>
                <button onClick={handleUndoClick} className="shrink-0 text-xs font-semibold text-gold-400 hover:text-gold-300">
                  Undo
                </button>
              </div>
              <div className="absolute inset-x-0 bottom-0 h-0.5 bg-gold-600/20">
                <div key={undoIssue.id} className="h-full bg-gold-400" style={{ animation: "shrinkWidth 6s linear forwards" }} />
              </div>
            </div>
          </div>,
          document.body
        )}
    </HQShell>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-[#8a7f6d]">{label}</p>
      <p className="text-[#ede6da]">{value}</p>
    </div>
  );
}
