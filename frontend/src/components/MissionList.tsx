import { useState } from "react";
import { Link } from "react-router-dom";
import { api, type Mission, type MissionDetail, type MissionStatus } from "../lib/api";
import { Badge } from "./ui";
import { ChevronRightIcon } from "./icons";
import { ReviewBadge, formatDuration } from "./review";
import { MissionDetailPanel } from "./MissionDetailPanel";
import { registryForPlaybook } from "../sydekyks/registry";

function StatusBadge({ status }: { status: MissionStatus }) {
  if (status === "succeeded") return <Badge tone="gold">Done</Badge>;
  if (status === "failed") return <Badge tone="danger">Failed</Badge>;
  if (status === "running") {
    return (
      <span className="inline-flex items-center gap-2 rounded-[2px] border-2 border-gold-700 bg-brand-softer px-2 py-1 text-xs font-medium uppercase tracking-[0.4px] text-gold-300">
        <span className="h-2 w-2 animate-pulse rounded-full bg-gold-400" aria-hidden="true" /> Running
      </span>
    );
  }
  return <Badge tone="neutral">Queued</Badge>;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function sourceLabel(mission: Mission): string {
  if (mission.source === "email") return "via Email";
  if (mission.initiated_by_email) return `Uploaded by ${mission.initiated_by_email}`;
  return "Manual upload";
}

function tokenLabel(tokens: number): string {
  if (tokens < 1_000) return tokens.toLocaleString();
  if (tokens < 1_000_000) return `${(tokens / 1_000).toFixed(tokens < 10_000 ? 1 : 0)}k`;
  return `${(tokens / 1_000_000).toFixed(1)}m`;
}

function capacityLabel(seconds: number): string {
  if (seconds === 0) return "0 sec";
  if (seconds < 0.1) return "<0.1 sec";
  return `${seconds.toFixed(seconds < 10 ? 1 : 0)} sec`;
}

/**
 * Canonical Mission list used by the Missions page, dashboard and every agent workspace. The
 * status rail, readable metadata blocks and compact expansion make the same run easy to scan in
 * both a broad operations feed and a single-agent Recent Missions section.
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
    const response = await api.get<MissionDetail>(`/tenant/missions/${id}`);
    setDetail(response.data);
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

  function handleChanged() {
    onReload?.();
    if (expanded) fetchDetail(expanded);
  }

  return (
    <div className="grid min-w-0 gap-2 p-2">
      {missions.map((mission) => {
        const needsReview = Boolean(mission.result_summary?.needs_review) && !mission.reviewed;
        const registry = registryForPlaybook(mission.playbook_key);
        const label = registry?.missionRowLabel?.(mission) ?? { title: mission.document_filename ?? "Mission" };
        const isHr = registry?.domain === "hr";
        const open = expanded === mission.id;
        const odooUrl = mission.odoo_record_url ?? mission.odoo_bill_url ?? null;
        const odooLabel = mission.odoo_record_label ?? "Open bill in Odoo";
        const rail = mission.status === "failed"
          ? "border-l-red-500"
          : needsReview
            ? "border-l-amber-500"
            : mission.status === "running"
              ? "border-l-gold-400"
              : "border-l-ink-500";
        const tint = isHr ? "bg-blue-500/[0.045] hover:bg-blue-500/[0.09]" : "bg-ink-900 hover:bg-ink-800";
        const duration = mission.completed_at ? formatDuration(mission.created_at, mission.completed_at) : null;

        return (
          <article key={mission.id} className={`fx-responsive-row min-w-0 overflow-hidden rounded-[4px] border-2 border-ink-600 border-l-4 ${rail}`}>
            <div className={`min-w-0 transition-colors ${tint}`}>
              <button
                type="button"
                aria-expanded={open}
                aria-controls={`mission-detail-${mission.id}`}
                onClick={() => toggle(mission.id)}
                className="grid min-h-11 w-full min-w-0 gap-3 p-4 text-left lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center"
              >
                <span className="min-w-0">
                  <span className="flex min-w-0 flex-wrap items-center gap-2">
                    {showSydekyk && mission.sydekyk_name && <Badge tone={isHr ? "neutral" : "gold"}>{mission.sydekyk_name}</Badge>}
                    <span className={`min-w-0 break-words text-base font-semibold ${label.muted ? "text-body" : "text-heading"}`}>
                      {label.title}
                    </span>
                    {mission.attempt_number > 1 && <Badge tone="neutral">Retry {mission.attempt_number - 1}</Badge>}
                  </span>

                  <span className="mt-2 flex min-w-0 flex-wrap gap-x-2 gap-y-1 text-sm leading-6 text-body">
                    {mission.document_filename && <span className="max-w-full break-all text-heading">{mission.document_filename}</span>}
                    <span>{sourceLabel(mission)}</span>
                    <span>{fmtDate(mission.created_at)}</span>
                    {duration && <span className="font-medium text-gold-300">Done in {duration}</span>}
                    {!duration && (mission.status === "running" || mission.status === "queued") && <span>In progress</span>}
                  </span>

                  <span className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs font-medium uppercase tracking-[0.4px] text-body">
                    <span>AI · {tokenLabel(mission.tokens_used ?? 0)} tokens</span>
                    <span>Capacity · {capacityLabel(mission.ai_capacity_seconds ?? 0)}</span>
                    {(mission.ai_calls ?? 0) > 0 && <span>{mission.ai_calls} model call{mission.ai_calls === 1 ? "" : "s"}</span>}
                  </span>
                </span>

                <span className="flex flex-wrap items-center gap-2 lg:justify-end">
                  {mission.source === "email" && <Badge tone="neutral">Email</Badge>}
                  <ReviewBadge reviewed={mission.reviewed} needsReview={Boolean(mission.result_summary?.needs_review)} />
                  <StatusBadge status={mission.status} />
                  <span className="grid h-11 w-11 shrink-0 place-items-center text-body" aria-hidden="true">
                    <ChevronRightIcon className={`h-4 w-4 transition-transform ${open ? "rotate-90" : ""}`} />
                  </span>
                </span>
              </button>

              {(odooUrl || needsReview) && (
                <div className="flex min-w-0 flex-wrap gap-2 border-t-2 border-ink-700 px-4 py-2">
                  {odooUrl && (
                    <a href={odooUrl} target="_blank" rel="noopener noreferrer" title={odooLabel} className="inline-flex min-h-11 items-center px-2 text-sm font-medium text-gold-300 hover:text-heading">
                      {odooLabel} →
                    </a>
                  )}
                  {needsReview && (
                    <Link to={`/hq/missions?view=attention&mission=${mission.id}`} className="inline-flex min-h-11 items-center px-2 text-sm font-medium text-amber-400 hover:text-heading">
                      Review mission →
                    </Link>
                  )}
                </div>
              )}
            </div>

            {open && (
              <div id={`mission-detail-${mission.id}`} className="min-w-0 border-t-2 border-ink-600 bg-ink-950/60 p-4">
                {!detail ? (
                  <p className="text-sm text-body" role="status">Loading mission detail…</p>
                ) : (
                  <MissionDetailPanel detail={detail} onChanged={handleChanged} />
                )}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
