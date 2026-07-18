import { useCallback, useEffect, useState } from "react";
import { api, type Mission, type RunNowResult, type ShieldReadiness, type Sydekyk } from "../../lib/api";
import { Button } from "../../components/ui";
import { MissionList } from "../../components/MissionList";
import { useMissionRefresh } from "../../lib/useMissionRefresh";

/** Shield's operations panel - the batch "Assess now" scan on top plus a live Recent Missions list. */
export function ShieldOperationsSection({ sydekyk, canManage }: { sydekyk: Sydekyk; canManage: boolean }) {
  const [missions, setMissions] = useState<Mission[] | null>(null);
  const [ready, setReady] = useState(false);
  const [running, setRunning] = useState(false);
  const [runMsg, setRunMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    api.get<Mission[]>(`/tenant/sydekyks/${sydekyk.id}/missions`).then((res) => setMissions(res.data));
  }, [sydekyk.id]);

  useEffect(() => {
    load();
    api.get<ShieldReadiness>("/tenant/shield/readiness").then((r) => setReady(r.data.can_upload));
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
      const r = await api.post<RunNowResult>("/tenant/shield/run-now");
      setRunMsg(
        r.data.queued === 0
          ? "No new bills to assess - all caught up."
          : `Assessing ${r.data.queued} bill${r.data.queued === 1 ? "" : "s"} for risk…`,
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
          <p className="text-xs font-semibold uppercase tracking-wider text-gold-500">Assess Now</p>
          <p className="mt-1 text-sm text-[#8a7f6d]">
            Scan forward for new vendor bills and flag fraud-risk signals for review (up to 30, last 5 days).
          </p>
        </div>
        {canManage && (
          <Button disabled={running || !ready} onClick={runNow}>
            {running ? "Starting…" : "Assess bills now"}
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
          <p className="mt-2 text-sm text-[#8a7f6d]">No assessments yet - run Shield to scan your bills.</p>
        ) : (
          <div className="mt-2 min-w-0">
            <MissionList missions={missions} onReload={load} showSydekyk={false} />
          </div>
        )}
      </div>
    </div>
  );
}
