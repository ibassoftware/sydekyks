"""SSE projection of the shared Mission event stream.

Starting work and observing it are intentionally separate. Domain command routes create and enqueue
a Mission; ``GET /missions/{id}/events`` calls this module to observe that Mission from any API
process. The database snapshot sent first is authoritative, while replayable events provide live
progress and optional prose deltas.
"""

import json
import uuid
from datetime import datetime, timezone
from typing import Callable

from fastapi.responses import StreamingResponse

from app.db.session import SessionLocal
from app.models.mission import Mission
from app.services import mission_events


def _frame(event: dict) -> str:
    event_id = event.get("id")
    id_line = f"id: {event_id}\n" if event_id else ""
    return f"{id_line}event: {event['type']}\ndata: {json.dumps(event)}\n\n"


def stream_mission_events(
    mission_id: uuid.UUID,
    *,
    snapshot: dict,
    last_event_id: str | None = None,
) -> StreamingResponse:
    """Return a replayable SSE observation stream for one already-created Mission."""
    return StreamingResponse(
        event_frames(
            mission_id,
            snapshot=snapshot,
            last_event_id=last_event_id,
            terminal_probe=lambda: _terminal_event_from_db(mission_id),
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


def _terminal_event_from_db(mission_id: uuid.UUID) -> dict | None:
    """Recover terminal delivery if the short-lived event transport missed the final publish."""
    db = SessionLocal()
    try:
        mission = db.get(Mission, mission_id)
        event_type = {
            "succeeded": "mission.completed",
            "failed": "mission.failed",
            "cancelled": "mission.cancelled",
        }.get(mission.status if mission is not None else None)
        if event_type is None:
            return None
        return {
            "version": mission_events.EVENT_VERSION,
            "mission_id": str(mission_id),
            "type": event_type,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "data": {
                "status": mission.status,
                "failure_category": mission.failure_category,
                "recovered_from_database": True,
            },
        }
    finally:
        db.close()


def event_frames(
    mission_id: uuid.UUID,
    *,
    snapshot: dict,
    last_event_id: str | None = None,
    terminal_probe: Callable[[], dict | None] | None = None,
):
    """Yield framed events. Kept separate from the HTTP response for deterministic protocol tests."""
    snapshot_event = {
        "version": mission_events.EVENT_VERSION,
        "mission_id": str(mission_id),
        "type": "mission.snapshot",
        "timestamp": snapshot.get("timestamp"),
        "data": snapshot,
    }
    yield _frame(snapshot_event)

    # A terminal database snapshot is sufficient even if the short-lived Redis history expired.
    if snapshot.get("status") in {"succeeded", "failed", "cancelled"}:
        return

    for event in mission_events.iter_events(mission_id, last_event_id):
        if event is None:
            terminal = terminal_probe() if terminal_probe is not None else None
            if terminal is not None:
                yield _frame(terminal)
                return
            yield ": keepalive\n\n"
            continue
        yield _frame(event)
        if event.get("type") in mission_events.TERMINAL_TYPES:
            return
