import { useEffect } from "react";
import { observeMission } from "./sse";

/**
 * Keep an existing REST projection fresh while any listed Mission is active. SSE supplies the live
 * invalidation signal; the regular endpoint remains authoritative and determines what the UI shows.
 */
export function useMissionRefresh(missionIds: string[], refresh: () => void): void {
  const key = [...missionIds].sort().join(",");

  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    let timer: number | null = null;
    const scheduleRefresh = () => {
      if (timer !== null) return;
      timer = window.setTimeout(() => {
        timer = null;
        refresh();
      }, 150);
    };

    for (const missionId of key.split(",")) {
      observeMission(
        missionId,
        { onStep: scheduleRefresh, onDone: scheduleRefresh, onError: scheduleRefresh },
        controller.signal,
      ).catch(() => {
        if (!controller.signal.aborted) scheduleRefresh();
      });
    }

    return () => {
      controller.abort();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [key, refresh]);
}
