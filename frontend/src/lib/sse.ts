// Shared Mission command + observation client.
//
// Domain routes validate their own inputs, create/enqueue a Mission, and return its id. The browser
// then observes that Mission through the generic authenticated SSE endpoint. Mission state remains
// authoritative in the regular REST API; completion handlers should refetch their domain resource.

import { notifyMissionActivity } from "./missionActivity";

export interface MissionEvent<T = Record<string, unknown>> {
  id?: string;
  version: number;
  mission_id: string;
  type: string;
  timestamp: string | null;
  data: T;
}

export interface MissionStepEvent {
  index: number;
  key: string;
  step_type: string;
  status: string;
  has_error: boolean;
}

export interface SSEHandlers {
  onOpen?: (data: { mission_id: string }) => void;
  onStep?: (data: MissionStepEvent) => void;
  onDelta?: (text: string) => void;
  onDone?: () => void | Promise<void>;
  onError?: (msg: string) => void | Promise<void>;
}

type Terminal = "completed" | "failed" | null;

function parseFrame(frame: string): { id?: string; event?: MissionEvent } {
  let id: string | undefined;
  const dataLines: string[] = [];
  for (const line of frame.replaceAll("\r\n", "\n").split("\n")) {
    if (line.startsWith(":")) return {};
    if (line.startsWith("id:")) id = line.slice(3).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (!dataLines.length) return { id };
  try {
    return { id, event: JSON.parse(dataLines.join("\n")) as MissionEvent };
  } catch {
    return { id };
  }
}

function dispatch(event: MissionEvent, handlers: SSEHandlers): Terminal {
  switch (event.type) {
    case "mission.snapshot": {
      handlers.onOpen?.({ mission_id: event.mission_id });
      const status = (event.data as { status?: string }).status;
      if (status === "succeeded") return "completed";
      if (status === "failed" || status === "cancelled") return "failed";
      return null;
    }
    case "step.completed":
      handlers.onStep?.(event.data as unknown as MissionStepEvent);
      return null;
    case "output.delta":
      handlers.onDelta?.((event.data as { text?: string }).text ?? "");
      return null;
    case "mission.completed":
      return "completed";
    case "mission.failed":
    case "mission.cancelled":
      return "failed";
    default:
      // Forward compatibility: old clients safely ignore event types added by newer backends.
      return null;
  }
}

function tokenHeaders(): Record<string, string> {
  const token = localStorage.getItem("sydekyks_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

interface MissionState {
  status?: string;
  error_message?: string | null;
}

async function missionState(missionId: string): Promise<MissionState | null> {
  try {
    const res = await fetch(`/api/tenant/missions/${missionId}`, { headers: tokenHeaders() });
    if (res.ok) {
      return await res.json() as MissionState;
    }
  } catch {
    // A reconnect below may recover from a transient detail failure.
  }
  return null;
}

async function missionError(missionId: string): Promise<string> {
  const mission = await missionState(missionId);
  return mission?.error_message || "The Mission failed";
}

/** Observe an existing Mission. Reconnects from the last event id after an unexpected EOF. */
export async function observeMission(
  missionId: string,
  handlers: SSEHandlers,
  signal?: AbortSignal,
): Promise<void> {
  let cursor = "";
  let reconnects = 0;

  while (!signal?.aborted) {
    const suffix = cursor ? `?after=${encodeURIComponent(cursor)}` : "";
    const res = await fetch(`/api/tenant/missions/${missionId}/events${suffix}`, {
      headers: { Accept: "text/event-stream", ...tokenHeaders() },
      signal,
    });
    if (!res.ok || !res.body) {
      throw new Error(`Mission event stream failed (${res.status})`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let terminal: Terminal = null;

    while (!terminal) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true }).replaceAll("\r\n", "\n");
      let separator: number;
      while ((separator = buf.indexOf("\n\n")) !== -1) {
        const frame = buf.slice(0, separator);
        buf = buf.slice(separator + 2);
        if (!frame.trim()) continue;
        const parsed = parseFrame(frame);
        if (parsed.id) cursor = parsed.id;
        if (parsed.event) terminal = dispatch(parsed.event, handlers);
        if (terminal) break;
      }
    }
    reader.releaseLock();

    if (terminal === "completed") {
      await handlers.onDone?.();
      return;
    }
    if (terminal === "failed") {
      await handlers.onError?.(await missionError(missionId));
      return;
    }

    // If Redis/SSE degraded after execution committed, durable Mission state still closes the UI.
    const durable = await missionState(missionId);
    if (durable?.status === "succeeded") {
      await handlers.onDone?.();
      return;
    }
    if (durable?.status === "failed" || durable?.status === "cancelled") {
      await handlers.onError?.(durable.error_message || "The Mission failed");
      return;
    }

    reconnects += 1;
    if (reconnects > 30) throw new Error("Mission event stream ended before the Mission completed");
    await new Promise((resolve) => window.setTimeout(resolve, Math.min(2000, reconnects * 300)));
  }
}

/** Start a domain-specific Mission command, then observe it through the generic Mission stream. */
export async function streamMission(
  path: string,
  body: unknown,
  handlers: SSEHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`/api${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...tokenHeaders() },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const payload = await res.json() as { detail?: string };
      if (payload.detail) msg = payload.detail;
    } catch {
      // Body was not JSON.
    }
    await handlers.onError?.(msg);
    return;
  }
  const started = await res.json() as { mission_id: string };
  if (!started.mission_id) throw new Error("Mission command did not return a Mission id");
  notifyMissionActivity();
  await observeMission(started.mission_id, handlers, signal);
}
