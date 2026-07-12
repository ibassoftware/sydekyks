import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Mission, type NudgeReadiness, type RunNowResult, type Sydekyk } from "../../lib/api";
import { Button } from "../../components/ui";
import { MissionList } from "../../components/MissionList";

/** Nudge's operations panel — the batch "Check pipeline now" scan on top plus a live Recent Missions
 * list. Nudge has no upload; it works the Odoo pipeline on a schedule or on demand. */
export function NudgeOperationsSection({ sydekyk, canManage }: { sydekyk: Sydekyk; canManage: boolean }) {
  const [missions, setMissions] = useState<Mission[] | null>(null);
  const [ready, setReady] = useState(false);
  const [running, setRunning] = useState(false);
  const [runMsg, setRunMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    api.get<Mission[]>(`/tenant/sydekyks/${sydekyk.id}/missions`).then((res) => setMissions(res.data));
  }, [sydekyk.id]);

  useEffect(() => {
    load();
    api.get<NudgeReadiness>("/tenant/nudge/readiness").then((r) => setReady(r.data.can_upload));
  }, [load]);

  const active = missions?.some((m) => m.status === "queued" || m.status === "running");
  const activeRef = useRef(active);
  activeRef.current = active;
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => {
      if (activeRef.current) load();
    }, 4000);
    return () => clearInterval(t);
  }, [active, load]);

  async function runNow() {
    setRunning(true);
    setRunMsg(null);
    try {
      const r = await api.post<RunNowResult>("/tenant/nudge/run-now");
      setRunMsg(
        r.data.queued === 0
          ? "No stale opportunities — your pipeline is being tended."
          : `Drafting follow-ups for ${r.data.queued} opportunit${r.data.queued === 1 ? "y" : "ies"}…`,
      );
      load();
    } catch {
      setRunMsg("Couldn't start a run. Check the Odoo connection in Settings.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-gold-500">Check Pipeline Now</p>
          <p className="mt-1 text-sm text-[#8a7f6d]">
            Scan for open opportunities that have gone quiet and draft a follow-up for each (up to 30).
          </p>
        </div>
        {canManage && (
          <Button className="px-4 py-2 text-xs" disabled={running || !ready} onClick={runNow}>
            {running ? "Starting…" : "Check pipeline now"}
          </Button>
        )}
      </div>
      {runMsg && <p className="mt-2 text-xs text-gold-400">{runMsg}</p>}
      {!ready && <p className="mt-2 text-xs text-amber-400/90">Assign an Odoo instance in Settings before running.</p>}

      <div className="mt-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-gold-500">Recent Missions</p>
        {!missions ? (
          <p className="mt-2 text-sm text-[#8a7f6d]">Loading…</p>
        ) : missions.length === 0 ? (
          <p className="mt-2 text-sm text-[#8a7f6d]">No follow-ups yet — run Nudge to check your pipeline.</p>
        ) : (
          <div className="mt-2 overflow-hidden rounded-lg border border-ink-700">
            <MissionList missions={missions} onReload={load} showSydekyk={false} />
          </div>
        )}
      </div>
    </div>
  );
}
