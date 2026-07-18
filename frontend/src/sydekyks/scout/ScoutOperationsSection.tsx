import { useCallback, useEffect, useState } from "react";
import { api, type Mission, type RunNowResult, type ScoutReadiness, type Sydekyk } from "../../lib/api";
import { Button } from "../../components/ui";
import { MissionList } from "../../components/MissionList";
import { useMissionRefresh } from "../../lib/useMissionRefresh";

/**
 * Scout's operations panel - the batch "Run now" action on top plus a live Recent Missions list.
 * Scout has no upload dropzone (it reads résumés from Odoo itself), so this stands in for Ledger/
 * Decode's DocumentIntakeSection. Running missions surface in the global activity toast just like an
 * upload does; this list observes active Missions through SSE so they flip to Done in place.
 */
export function ScoutOperationsSection({ sydekyk, canManage }: { sydekyk: Sydekyk; canManage: boolean }) {
  const [missions, setMissions] = useState<Mission[] | null>(null);
  const [ready, setReady] = useState(false);
  const [running, setRunning] = useState(false);
  const [runMsg, setRunMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    api.get<Mission[]>(`/tenant/sydekyks/${sydekyk.id}/missions`).then((res) => setMissions(res.data));
  }, [sydekyk.id]);

  useEffect(() => {
    load();
    api.get<ScoutReadiness>("/tenant/scout/readiness").then((r) => setReady(r.data.can_upload));
  }, [load]);

  const active = missions?.some((m) => m.status === "queued" || m.status === "running");
  useMissionRefresh(
    active ? (missions ?? []).filter((m) => m.status === "queued" || m.status === "running").map((m) => m.id) : [],
    load,
  );

  async function runNow() {
    setRunning(true);
    setRunMsg(null);
    try {
      const r = await api.post<RunNowResult>("/tenant/scout/run-now");
      setRunMsg(
        r.data.queued === 0
          ? "No un-scored applicants found - everyone's already scored."
          : `Scoring ${r.data.queued} applicant${r.data.queued === 1 ? "" : "s"}…`,
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
          <p className="text-xs font-semibold uppercase tracking-wider text-gold-500">Score Now</p>
          <p className="mt-1 text-sm text-[#8a7f6d]">
            Score every applicant that hasn't been scored yet (up to your per-run cap).
          </p>
        </div>
        {canManage && (
          <Button disabled={running || !ready} onClick={runNow}>
            {running ? "Starting…" : "Run Scout now"}
          </Button>
        )}
      </div>
      {runMsg && <p className="mt-2 text-xs text-gold-400">{runMsg}</p>}
      {!ready && (
        <p className="mt-2 text-xs text-amber-400/90">Assign an Odoo instance in Settings before running.</p>
      )}

      <div className="mt-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-gold-500">Recent Missions</p>
        {!missions ? (
          <p className="mt-2 text-sm text-[#8a7f6d]">Loading…</p>
        ) : missions.length === 0 ? (
          <p className="mt-2 text-sm text-[#8a7f6d]">No missions yet - run Scout to start scoring applicants.</p>
        ) : (
          <div className="mt-2 min-w-0">
            <MissionList missions={missions} onReload={load} showSydekyk={false} />
          </div>
        )}
      </div>
    </div>
  );
}
