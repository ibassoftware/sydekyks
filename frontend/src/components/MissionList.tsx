import { useState } from "react";
import { Link } from "react-router-dom";
import { api, type Mission, type MissionDetail, type MissionStatus } from "../lib/api";
import { Badge } from "./ui";
import { ReviewBadge } from "./review";
import { MissionDetailPanel } from "./MissionDetailPanel";

function StatusBadge({ status }: { status: MissionStatus }) {
  if (status === "succeeded") return <Badge tone="gold">Done</Badge>;
  if (status === "failed") return <Badge tone="danger">Failed</Badge>;
  if (status === "running")
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-gold-400">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gold-400" /> Running
      </span>
    );
  return <Badge tone="neutral">Queued</Badge>;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function sourceLabel(m: Mission): string {
  if (m.source === "email") return "via Email";
  if (m.initiated_by_email) return `Uploaded by ${m.initiated_by_email}`;
  return "Manual upload";
}

/**
 * The canonical Mission list: one expandable row design + the expand→fetch-detail logic, shared by
 * the Missions page and the Roster upload section (DRY). Parents fetch the Missions and pass them
 * in; `onReload` refreshes the parent after a review/retry action. `showSydekyk` hides the Sydekyk
 * chip in single-Sydekyk contexts (e.g. a Roster detail page).
 */
export function MissionList({
  missions,
  onReload,
  showSydekyk = true,
}: {
  missions: Mission[];
  onReload?: () => void;
  showSydekyk?: boolean;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<MissionDetail | null>(null);

  async function fetchDetail(id: string) {
    const res = await api.get<MissionDetail>(`/tenant/missions/${id}`);
    setDetail(res.data);
  }

  async function toggle(id: string) {
    if (expanded === id) {
      setExpanded(null);
      setDetail(null);
      return;
    }
    setExpanded(id);
    setDetail(null);
    await fetchDetail(id);
  }

  // After a review/retry the parent list refreshes AND the open detail re-fetches, so badges and
  // actions stay in sync without collapsing the row.
  function handleChanged() {
    onReload?.();
    if (expanded) fetchDetail(expanded);
  }

  return (
    <div className="divide-y divide-ink-700/60">
      {missions.map((m) => {
        const needsReview = Boolean(m.result_summary?.needs_review) && !m.reviewed;
        return (
          <div key={m.id}>
            <div className="flex items-stretch">
              <button
                onClick={() => toggle(m.id)}
                className="grid flex-1 grid-cols-[1fr_auto] items-center gap-3 px-5 py-3 text-left hover:bg-ink-800/50"
              >
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    {showSydekyk && m.sydekyk_name && (
                      <span className="shrink-0 rounded-md border border-gold-600/40 bg-gold-500/10 px-2 py-0.5 text-[11px] font-semibold text-gold-300">
                        {m.sydekyk_name}
                      </span>
                    )}
                    <p className="truncate text-sm font-medium text-[#ede6da]">
                      {m.document_filename ?? "document"}
                      {m.attempt_number > 1 && <span className="ml-1 text-xs text-[#8a7f6d]">· retry #{m.attempt_number - 1}</span>}
                    </p>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-[#8a7f6d]">
                    {sourceLabel(m)} · Started {fmtDate(m.created_at)}
                    {m.completed_at
                      ? ` · Done ${fmtDate(m.completed_at)}`
                      : m.status === "running" || m.status === "queued"
                        ? " · In progress"
                        : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {m.source === "email" && <Badge tone="neutral">Email</Badge>}
                  <ReviewBadge reviewed={m.reviewed} needsReview={Boolean(m.result_summary?.needs_review)} />
                  <StatusBadge status={m.status} />
                </div>
              </button>
              {needsReview && (
                <Link
                  to={`/hq/issues?mission=${m.id}`}
                  title="Jump to this bill on the Issues page"
                  className="flex items-center border-l border-ink-700/60 px-4 text-xs font-semibold text-amber-400 hover:bg-ink-800/50"
                >
                  Review →
                </Link>
              )}
            </div>
            {expanded === m.id && (
              <div className="border-t border-ink-700/60 bg-ink-950/40 px-5 py-3">
                {!detail ? (
                  <p className="text-sm text-[#8a7f6d]">Loading…</p>
                ) : (
                  <MissionDetailPanel detail={detail} onChanged={handleChanged} />
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
