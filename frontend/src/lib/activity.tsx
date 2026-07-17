import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { api, type IssuesCount, type Mission, type MissionDetail } from "./api";
import { useAuth } from "./auth";
import { useMissionRefresh } from "./useMissionRefresh";
import { MISSION_ACTIVITY_EVENT } from "./missionActivity";

// Low-frequency discovery catches Missions created by cron/email. Browser-issued commands also
// signal this provider immediately; focused active Missions then use SSE for step/terminal updates.
const DISCOVERY_POLL_MS = 30000;
const ISSUES_POLL_MS = 15000;
const FINISHED_TTL_MS = 5000;

// Humanize a playbook step_key for the toast, e.g. "extract_bill_data" -> "Extracting bill data".
function stepLabel(key: string | null): string {
  if (!key) return "Starting…";
  const words = key.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** One aggregated in-flight "burst" of Missions — powers a single progress toast instead of one
 * toast per Mission. `total` is every distinct Mission seen active since the burst began; `running`
 * is how many are still going; `failed` counts finished-and-failed so far. */
interface Burst {
  total: number;
  running: number;
  failed: number;
  sydekyks: string[];
}

interface ActivityValue {
  active: Mission[];
  activeSydekykIds: Set<string>;
  count: number;
  issuesCount: number;
}

const ActivityContext = createContext<ActivityValue>({ active: [], activeSydekykIds: new Set(), count: 0, issuesCount: 0 });

export function useActivity() {
  return useContext(ActivityContext);
}

export function ActivityProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const enabled = user?.role === "commander" || user?.role === "hero";

  const [active, setActive] = useState<Mission[]>([]);
  const [burst, setBurst] = useState<Burst | null>(null);
  const [issuesCount, setIssuesCount] = useState(0);
  const prevActive = useRef<Map<string, Mission>>(new Map());
  const seenRef = useRef<Set<string>>(new Set()); // every Mission id seen active this burst
  const failedRef = useRef(0);
  const resetRef = useRef<number | null>(null);

  const poll = useCallback(async () => {
    try {
      const res = await api.get<Mission[]>("/tenant/missions/active");
      const next = res.data;
      const nextIds = new Set(next.map((m) => m.id));

      // Missions that were active last tick but aren't now → just completed. Fetch final status so
      // the burst can tally failures (progress itself is derived from seen − running, no fetch needed).
      const justGone = [...prevActive.current.values()].filter((m) => !nextIds.has(m.id));
      for (const gone of justGone) {
        api
          .get<MissionDetail>(`/tenant/missions/${gone.id}`)
          .then((d) => {
            if (d.data.status !== "succeeded") {
              failedRef.current += 1;
              setBurst((b) => (b ? { ...b, failed: failedRef.current } : b));
            }
          })
          .catch(() => undefined);
      }

      if (next.length > 0) {
        next.forEach((m) => seenRef.current.add(m.id));
        if (resetRef.current) {
          clearTimeout(resetRef.current);
          resetRef.current = null;
        }
      }

      prevActive.current = new Map(next.map((m) => [m.id, m]));
      setActive(next);

      if (seenRef.current.size > 0) {
        setBurst((prev) => ({
          total: seenRef.current.size,
          running: next.length,
          failed: failedRef.current,
          sydekyks: next.length
            ? Array.from(new Set(next.map((m) => m.sydekyk_name ?? "Sydekyk")))
            : prev?.sydekyks ?? ["Sydekyk"],
        }));
        // When the batch drains, keep the "done" summary briefly, then reset for the next burst.
        if (next.length === 0 && !resetRef.current) {
          resetRef.current = window.setTimeout(() => {
            seenRef.current = new Set();
            failedRef.current = 0;
            resetRef.current = null;
            setBurst(null);
          }, FINISHED_TTL_MS);
        }
      }
    } catch {
      // ignore transient poll errors
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setActive([]);
      prevActive.current = new Map();
      seenRef.current = new Set();
      failedRef.current = 0;
      setBurst(null);
      return;
    }
    poll();
    const id = setInterval(poll, DISCOVERY_POLL_MS);
    return () => clearInterval(id);
  }, [enabled, poll]);

  useEffect(() => {
    if (!enabled) return;
    const discoverNow = () => { void poll(); };
    window.addEventListener(MISSION_ACTIVITY_EVENT, discoverNow);
    return () => window.removeEventListener(MISSION_ACTIVITY_EVENT, discoverNow);
  }, [enabled, poll]);

  useMissionRefresh(active.map((mission) => mission.id), poll);

  const pollIssues = useCallback(async () => {
    try {
      const res = await api.get<IssuesCount>("/tenant/issues/count");
      setIssuesCount(res.data.total);
    } catch {
      // ignore transient poll errors
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setIssuesCount(0);
      return;
    }
    pollIssues();
    const id = setInterval(pollIssues, ISSUES_POLL_MS);
    return () => clearInterval(id);
  }, [enabled, pollIssues]);

  const value: ActivityValue = {
    active,
    activeSydekykIds: new Set(active.map((m) => m.sydekyk_id)),
    count: active.length,
    issuesCount,
  };

  return (
    <ActivityContext.Provider value={value}>
      {children}
      {enabled && <ActivityToasts active={active} burst={burst} />}
    </ActivityContext.Provider>
  );
}

/** A single aggregated progress toast for the whole in-flight burst — one popup with a bar, not one
 * popup per Mission. A lone Mission keeps its live step label; a batch shows determinate progress. */
function ActivityToasts({ active, burst }: { active: Mission[]; burst: Burst | null }) {
  const navigate = useNavigate();
  if (!burst) return null;

  const { total, running, failed, sydekyks } = burst;
  const done = total - running;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const doneState = running === 0;
  const label = sydekyks.length === 1 ? sydekyks[0] : `${sydekyks.length} Sydekyks`;
  const single = total === 1 && running === 1 ? active[0] : undefined;
  const go = () => navigate("/hq/missions");

  return createPortal(
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
      <button
        onClick={go}
        className={`pointer-events-auto animate-[fadeIn_0.2s_ease-out] rounded-xl border p-3 text-left shadow-xl transition-colors ${
          doneState
            ? failed > 0
              ? "border-red-700/50 bg-red-500/10"
              : "border-gold-600/50 bg-gold-500/10"
            : "border-gold-600/40 bg-gradient-to-b from-ink-800 to-ink-900 hover:border-gold-500"
        }`}
      >
        <div className="flex items-center gap-2">
          {doneState ? (
            <span className={failed > 0 ? "text-red-400" : "text-gold-300"}>{failed > 0 ? "✗" : "✓"}</span>
          ) : (
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-gold-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-gold-400" />
            </span>
          )}
          <span className="text-sm font-semibold text-gold-300">{label}</span>
          <span className="ml-auto text-[11px] uppercase tracking-wide text-[#8a7f6d]">
            {doneState ? "Done" : total > 1 ? `${done}/${total}` : "Running"}
          </span>
        </div>

        {single ? (
          <>
            <p className="mt-1 truncate text-xs text-[#d8cdb9]">{single.document_filename ?? "document"}</p>
            <p className="mt-1 text-[11px] text-[#8a7f6d]">
              {single.status === "queued" ? "Waiting to start…" : stepLabel(single.last_step_key)}
            </p>
            <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-ink-700">
              <div className="h-full w-1/2 animate-pulse rounded-full bg-gradient-to-r from-gold-600 to-gold-400" />
            </div>
          </>
        ) : (
          <>
            <p className="mt-1 text-xs text-[#d8cdb9]">
              {doneState
                ? `${total} mission${total > 1 ? "s" : ""} complete${failed > 0 ? ` · ${failed} failed` : ""}`
                : `${done} of ${total} complete · ${running} running`}
            </p>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-ink-700">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  doneState && failed > 0
                    ? "bg-gradient-to-r from-red-600 to-red-400"
                    : "bg-gradient-to-r from-gold-600 to-gold-400"
                }`}
                style={{ width: `${doneState ? 100 : pct}%` }}
              />
            </div>
          </>
        )}
      </button>
    </div>,
    document.body,
  );
}

/** Small live "N running" pill for page headers. Renders nothing when idle. */
export function HeaderActivity() {
  const { count } = useActivity();
  if (count === 0) return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-gold-600/40 bg-gold-500/10 px-2.5 py-1 text-xs font-semibold text-gold-300">
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-gold-400 opacity-75" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-gold-400" />
      </span>
      {count} running
    </span>
  );
}

/** Compact recent-missions strip for the dashboard/roster. */
export function RecentMissionsStrip({ limit = 6 }: { limit?: number }) {
  const navigate = useNavigate();
  const { active } = useActivity(); // re-render/refresh as activity changes
  const [missions, setMissions] = useState<Mission[] | null>(null);

  useEffect(() => {
    api.get<{ items: Mission[] }>("/tenant/missions", { params: { limit } }).then((r) => setMissions(r.data.items));
  }, [limit, active.length]);

  if (!missions) return null;

  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-gold-500">Recent Missions</p>
        <button onClick={() => navigate("/hq/missions")} className="text-xs font-semibold text-gold-400 hover:text-gold-300">
          View all →
        </button>
      </div>
      {missions.length === 0 ? (
        <p className="mt-2 text-sm text-[#8a7f6d]">No missions yet.</p>
      ) : (
        <div className="mt-2 divide-y divide-ink-700/60 overflow-hidden rounded-lg border border-ink-700">
          {missions.map((m) => (
            <button
              key={m.id}
              onClick={() => navigate("/hq/missions")}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-ink-800/50"
            >
              <span className="min-w-0 flex-1 truncate text-sm text-[#ede6da]">{m.document_filename ?? "document"}</span>
              <span className="hidden shrink-0 text-xs text-[#8a7f6d] sm:inline">{m.sydekyk_name}</span>
              <StatusDot status={m.status} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusDot({ status }: { status: Mission["status"] }) {
  const map: Record<Mission["status"], string> = {
    succeeded: "bg-gold-400",
    failed: "bg-red-500",
    running: "bg-amber-400 animate-pulse",
    queued: "bg-ink-500",
  };
  const label: Record<Mission["status"], string> = {
    succeeded: "Done",
    failed: "Failed",
    running: "Running",
    queued: "Queued",
  };
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-[#8a7f6d]">
      <span className={`h-1.5 w-1.5 rounded-full ${map[status]}`} /> {label[status]}
    </span>
  );
}
