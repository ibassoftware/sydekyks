# Mission events and SSE

How Mission execution is observed in real time, how model output becomes usable application data,
and why those are separate concerns.

## Architecture decision

Every Mission publishes the same versioned event protocol. An authorized browser may observe any
Mission through Server-Sent Events (SSE), regardless of whether it was started manually, by upload,
email, cron, retry, or an agent-specific action.

SSE is the observation channel, not the command channel or source of truth:

```text
Domain command endpoint  ──POST──▶ validate, create, and enqueue Mission
Browser                  ◀──────── 202 {mission_id, status: "queued"}
Browser                  ──GET───▶ /api/tenant/missions/{mission_id}/events
Browser                  ◀──SSE──  snapshot / steps / optional deltas / terminal event
Browser                  ──GET───▶ Mission or domain resource for authoritative final state
```

Domain command routes remain agent-specific because their inputs differ. They do not own worker
threads or implement custom SSE protocols. Starting work and watching work are independent, so a
refresh or reconnect observes the existing Mission rather than starting another one.

## Three layers that must not be conflated

1. **Provider delivery.** `vision_ai` is the shared gateway to LiteLLM. A provider may return chunks
   or one response; that wire choice is an adapter concern.
2. **Mission events.** The execution engine publishes lifecycle and step events. A safe prose
   operation may additionally publish provisional output deltas.
3. **Application completion.** Structured output is assembled and validated in full before code
   consumes it or performs side effects.

"Buffered" in this codebase means the third layer: application code waits for a complete result. It
does not mean nginx or the browser should hold back SSE frames. Structured buffering is a correctness
boundary, not a separate execution architecture.

## Event protocol

Each stored event has this envelope:

```json
{
  "id": "1730000000000-0",
  "version": 1,
  "mission_id": "…",
  "type": "step.completed",
  "timestamp": "2026-07-17T12:00:00+00:00",
  "data": {}
}
```

Version 1 event types:

| Type | Meaning |
|---|---|
| `mission.snapshot` | Authoritative database status when a browser connects or reconnects. |
| `mission.queued` | The command committed a queued Mission. |
| `mission.started` | A worker began execution. |
| `step.completed` | A durable `MissionStep` was committed. |
| `output.delta` | Provisional human-facing prose/HTML; not authoritative. |
| `mission.completed` | Successful terminal state; refetch the final resource. |
| `mission.failed` | Failed terminal state; refetch sanitized Mission detail. |
| `mission.cancelled` | Cancelled terminal state. |

Heartbeat comments keep idle connections alive and are not application events. Unknown event types
must be ignored for forward compatibility.

## What every agent streams

Every agent publishes Mission lifecycle and step events through `create_mission*`, `run_mission`, and
`record_step`. No browser must be connected at publication time.

Publishing `output.delta` depends on the output contract, not the agent's name:

| Output contract | Live event visibility | Consumption rule |
|---|---|---|
| Human-facing prose or HTML | Steps plus optional `output.delta` | Render deltas in a provisional surface; refetch after completion. |
| Structured JSON/extraction/score | Steps only while running | Parse and validate the complete object before use. |
| Side-effecting workflow | Steps only while running | Validate the complete object before any write or dispatch. |
| Background or cron prose | Steps by default; deltas only if a viewer benefits | Execution is identical with or without a subscriber. |

Never publish half-formed structured JSON and never perform a side effect from a partial result.

## Delivery, replay, and failure behavior

`services/mission_events.py` uses bounded Redis Streams when the durable queue is enabled. This lets
arq workers publish events that any API replica can serve. Queue-disabled development and unit tests
use the same interface with a bounded in-memory implementation.

The event stream is short-lived observation data. Mission rows and MissionSteps remain durable and
authoritative. On connection the server sends `mission.snapshot`; Redis event IDs then support replay
after `Last-Event-ID` or `?after=`. Expired event history does not lose the result because a terminal
snapshot and the normal Mission API remain available.

Event publication is best-effort: Redis or browser failure must never fail Mission execution. Streams
are capped and expire to bound memory. Raw prompts, credentials, provider payloads, structured
partials, and unsanitized errors must not be placed in events.

Once an SSE response starts it is already `200 OK`. Runtime failure therefore arrives as a
`mission.failed` event rather than an HTTP 4xx/5xx. Initial authentication and authorization failures
still use normal HTTP status codes. The client refetches Mission detail for the sanitized error.

## Browser transport

The frontend uses authenticated `fetch` plus `ReadableStream`, not native `EventSource`, because the
request must carry the Bearer token. `frontend/src/lib/sse.ts` implements framing, replay cursors,
bounded reconnects, terminal handling, and final-state refetch conventions.

Active Mission views use SSE-driven invalidation and then reload their REST projection. The global
activity surface retains a low-frequency discovery poll for Missions created elsewhere by cron or
email; once discovered, their progress and completion are observed through SSE.

## Infrastructure requirements

- Disable proxy buffering for the Mission event route (`X-Accel-Buffering: no` is set by the app).
- Do not cache or transform SSE responses.
- Keep proxy/read timeouts longer than the heartbeat interval.
- Preserve Redis persistence/availability used by the arq queue, while allowing graceful event
  degradation.
- Authorize every subscription by tenant and Sydekyk permission.

Key files: `services/mission_events.py` (publication/replay), `services/mission_sse.py` (SSE
projection), `routers/missions.py` (generic authorized endpoint), `services/missions.py` (lifecycle
publication), and `frontend/src/lib/sse.ts` (browser client).
