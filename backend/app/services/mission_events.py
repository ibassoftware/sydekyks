"""Mission event publication and replay.

Every Mission publishes the same versioned event protocol whether or not a browser is currently
watching it.  Redis Streams are used when the durable queue is enabled so the API and arq worker can
live in different processes.  Queue-disabled development and unit tests use the bounded in-memory
implementation below.

Mission rows and MissionSteps remain the durable source of truth.  This stream is a short-lived
observation channel: losing it must never fail or roll back Mission work.
"""

from __future__ import annotations

import json
import logging
import threading
import uuid
from collections import deque
from datetime import datetime, timezone
from typing import Iterator

from app.core.config import settings

logger = logging.getLogger(__name__)

EVENT_VERSION = 1
HEARTBEAT_SECONDS = 15.0
MAX_EVENTS_PER_MISSION = 2_000
RETENTION_SECONDS = 24 * 60 * 60
TERMINAL_TYPES = {"mission.completed", "mission.failed", "mission.cancelled"}


def _stream_key(mission_id: uuid.UUID) -> str:
    return f"mission:{mission_id}:events"


def _payload(mission_id: uuid.UUID, event_type: str, data: dict | None) -> dict:
    return {
        "version": EVENT_VERSION,
        "mission_id": str(mission_id),
        "type": event_type,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "data": data or {},
    }


class _MemoryStream:
    def __init__(self) -> None:
        self.condition = threading.Condition()
        self.events: deque[dict] = deque(maxlen=MAX_EVENTS_PER_MISSION)
        self.sequence = 0

    def publish(self, event: dict) -> str:
        with self.condition:
            self.sequence += 1
            event_id = f"{self.sequence}-0"
            stored = {**event, "id": event_id}
            self.events.append(stored)
            self.condition.notify_all()
            return event_id

    def read_after(self, last_event_id: str | None) -> list[dict]:
        try:
            last_sequence = int((last_event_id or "0-0").split("-", 1)[0])
        except ValueError:
            last_sequence = 0
        return [event for event in self.events if int(event["id"].split("-", 1)[0]) > last_sequence]


_MEMORY_STREAMS: dict[uuid.UUID, _MemoryStream] = {}
_MEMORY_LOCK = threading.Lock()


def _memory_stream(mission_id: uuid.UUID) -> _MemoryStream:
    with _MEMORY_LOCK:
        return _MEMORY_STREAMS.setdefault(mission_id, _MemoryStream())


def _redis_client(*, blocking: bool = False):
    import redis

    # XREAD may block for one heartbeat interval; its socket timeout must be longer than that.
    socket_timeout = HEARTBEAT_SECONDS + 5 if blocking else 2
    return redis.Redis.from_url(
        settings.redis_url,
        decode_responses=True,
        socket_connect_timeout=2,
        socket_timeout=socket_timeout,
    )


def publish(mission_id: uuid.UUID, event_type: str, data: dict | None = None) -> str | None:
    """Publish one Mission event after the corresponding database commit.

    Event delivery is deliberately best-effort. The caller's Mission work has already committed and
    must continue if Redis is unavailable.
    """
    event = _payload(mission_id, event_type, data)
    if settings.queue_enabled:
        client = None
        try:
            client = _redis_client()
            key = _stream_key(mission_id)
            event_id = client.xadd(
                key,
                {"event": json.dumps(event, separators=(",", ":"))},
                maxlen=MAX_EVENTS_PER_MISSION,
                approximate=True,
            )
            client.expire(key, RETENTION_SECONDS)
            return str(event_id)
        except Exception as exc:  # noqa: BLE001 - observation must not break execution
            logger.warning("Could not publish Mission event to Redis (%s)", exc)
            return None
        finally:
            if client is not None:
                try:
                    client.close()
                except Exception:  # noqa: BLE001 - closing observation transport is best-effort
                    pass

    # Queue-disabled execution and tests share a process, so the local transport is sufficient.
    return _memory_stream(mission_id).publish(event)


def _decode_redis_event(event_id: str, fields: dict) -> dict | None:
    try:
        event = json.loads(fields["event"])
    except (KeyError, TypeError, json.JSONDecodeError):
        return None
    return {**event, "id": str(event_id)}


def _iter_redis(mission_id: uuid.UUID, last_event_id: str | None) -> Iterator[dict | None]:
    client = _redis_client(blocking=True)
    key = _stream_key(mission_id)
    cursor = last_event_id or "0-0"
    try:
        while True:
            rows = client.xread({key: cursor}, count=100, block=int(HEARTBEAT_SECONDS * 1000))
            if not rows:
                yield None
                continue
            for _stream_name, entries in rows:
                for event_id, fields in entries:
                    cursor = str(event_id)
                    event = _decode_redis_event(cursor, fields)
                    if event is not None:
                        yield event
    finally:
        client.close()


def _iter_memory(mission_id: uuid.UUID, last_event_id: str | None) -> Iterator[dict | None]:
    stream = _memory_stream(mission_id)
    cursor = last_event_id
    while True:
        with stream.condition:
            events = stream.read_after(cursor)
            if not events:
                stream.condition.wait(timeout=HEARTBEAT_SECONDS)
                events = stream.read_after(cursor)
        if not events:
            yield None
            continue
        for event in events:
            cursor = event["id"]
            yield event


def iter_events(mission_id: uuid.UUID, last_event_id: str | None = None) -> Iterator[dict | None]:
    """Yield stored events after ``last_event_id``; yield ``None`` for an SSE heartbeat interval."""
    if settings.queue_enabled:
        try:
            yield from _iter_redis(mission_id, last_event_id)
        except Exception as exc:  # noqa: BLE001 - browser reconnect handles observation failure
            logger.warning("Could not read Mission events from Redis (%s)", exc)
        # End this HTTP stream. The browser reconnects with the last Redis event id; mixing a local
        # cursor namespace into a Redis-backed Mission would make replay ordering ambiguous.
        return
    yield from _iter_memory(mission_id, last_event_id)


def reset_memory() -> None:
    """Clear the queue-disabled transport. Intended for isolated tests."""
    with _MEMORY_LOCK:
        _MEMORY_STREAMS.clear()
