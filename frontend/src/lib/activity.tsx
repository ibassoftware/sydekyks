import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { api, type Mission, type MissionDetail } from "./api";
import { useAuth } from "./auth";

const POLL_MS = 3000;
const FINISHED_TTL_MS = 5000;

// Humanize a playbook step_key for the toast, e.g. "extract_bill_data" -> "Extracting bill data".
function stepLabel(key: string | null): string {
  if (!key) return "Starting…";
  const words = key.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

type Finished = { mission: Mission; status: "succeeded" | "failed" };

interface ActivityValue {
  active: Mission[];
  activeSydekykIds: Set<string>;
  count: number;
}

const ActivityContext = createContext<ActivityValue>({ active: [], activeSydekykIds: new Set(), count: 0 });

export function useActivity() {
  return useContext(ActivityContext);
}

export function ActivityProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const enabled = user?.role === "commander" || user?.role === "hero";

  const [active, setActive] = useState<Mission[]>([]);
  const [finished, setFinished] = useState<Finished[]>([]);
  const prevActive = useRef<Map<string, Mission>>(new Map());

  const poll = useCallback(async () => {
    try {
      const res = await api.get<Mission[]>("/tenant/missions/active");
      const next = res.data;
      const nextIds = new Set(next.map((m) => m.id));

      // Missions that were active last tick but aren't now → just completed. Fetch final status.
      const justGone = [...prevActive.current.values()].filter((m) => !nextIds.has(m.id));
      for (const gone of justGone) {
        api
          .get<MissionDetail>(`/tenant/missions/${gone.id}`)
          .then((d) => {
            const status = d.data.status === "succeeded" ? "succeeded" : "failed";
            const entry: Finished = { mission: d.data, status };
            setFinished((f) => [...f.filter((x) => x.mission.id !== gone.id), entry]);
            setTimeout(() => setFinished((f) => f.filter((x) => x.mission.id !== gone.id)), FINISHED_TTL_MS);
          })
          .catch(() => undefined);
      }

      prevActive.current = new Map(next.map((m) => [m.id, m]));
      setActive(next);
    } catch {
      // ignore transient poll errors
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setActive([]);
      prevActive.current = new Map();
      return;
    }
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => clearInterval(id);
  }, [enabled, poll]);

  const value: ActivityValue = {
    active,
    activeSydekykIds: new Set(active.map((m) => m.sydekyk_id)),
    count: active.length,
  };

  return (
    <ActivityContext.Provider value={value}>
      {children}
      {enabled && <ActivityToasts active={active} finished={finished} />}
    </ActivityContext.Provider>
  );
}

function ActivityToasts({ active, finished }: { active: Mission[]; finished: Finished[] }) {
  const navigate = useNavigate();
  if (active.length === 0 && finished.length === 0) return null;

  const go = () => navigate("/hq/missions");

  return createPortal(
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
      {active.map((m) => (
        <button
          key={m.id}
          onClick={go}
          className="pointer-events-auto animate-[fadeIn_0.2s_ease-out] rounded-xl border border-gold-600/40 bg-gradient-to-b from-ink-800 to-ink-900 p-3 text-left shadow-xl transition-colors hover:border-gold-500"
        >
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-gold-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-gold-400" />
            </span>
            <span className="text-sm font-semibold text-gold-300">{m.sydekyk_name ?? "Sydekyk"}</span>
            <span className="ml-auto text-[11px] uppercase tracking-wide text-[#8a7f6d]">
              {m.status === "queued" ? "Queued" : "Running"}
            </span>
          </div>
          <p className="mt-1 truncate text-xs text-[#d8cdb9]">{m.document_filename ?? "document"}</p>
          <p className="mt-1 text-[11px] text-[#8a7f6d]">
            {m.status === "queued" ? "Waiting to start…" : stepLabel(m.last_step_key)}
          </p>
          <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-ink-700">
            <div className="h-full w-1/2 animate-pulse rounded-full bg-gradient-to-r from-gold-600 to-gold-400" />
          </div>
        </button>
      ))}

      {finished.map(({ mission, status }) => (
        <button
          key={mission.id}
          onClick={go}
          className={`pointer-events-auto animate-[fadeIn_0.2s_ease-out] rounded-xl border p-3 text-left shadow-xl ${
            status === "succeeded" ? "border-gold-600/50 bg-gold-500/10" : "border-red-700/50 bg-red-500/10"
          }`}
        >
          <div className="flex items-center gap-2">
            <span className={status === "succeeded" ? "text-gold-300" : "text-red-400"}>
              {status === "succeeded" ? "✓" : "✗"}
            </span>
            <span className="text-sm font-semibold text-[#ede6da]">{mission.sydekyk_name ?? "Sydekyk"}</span>
            <span className="ml-auto text-[11px] uppercase tracking-wide text-[#8a7f6d]">
              {status === "succeeded" ? "Done" : "Failed"}
            </span>
          </div>
          <p className="mt-1 truncate text-xs text-[#d8cdb9]">{mission.document_filename ?? "document"}</p>
        </button>
      ))}
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
