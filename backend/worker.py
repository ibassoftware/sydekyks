"""arq worker for Mission execution (VS-7).

Run with:  arq worker.WorkerSettings

`run_mission` is synchronous and opens its own DB session, so it runs in a threadpool to avoid
blocking the event loop.

Retry model (fixed after review): a retryable failure must NOT re-run the same Mission row —
`mission_steps` has a unique (mission_id, step_index), so re-running collides with the audit trail.
Instead, on a retryable outcome we create a NEW linked Mission via `retry_mission` (same lineage as
manual retry) and enqueue that. arq's own retry is disabled (`max_tries = 1`) so the two models
never fight. The chain length is capped by `attempt_number`.
"""

import asyncio
import uuid

from arq.connections import RedisSettings

from app.core.config import settings
from app.db.session import SessionLocal
from app.models.mission import Mission
from app.services.missions import retry_mission, run_mission
from app.services.queue import enqueue_mission

# Failure categories worth another attempt automatically.
_RETRYABLE = {"transient", "external"}
# Cap on the retry chain length (attempt_number of the original is 1).
MAX_ATTEMPTS = 4


async def run_mission_task(ctx: dict, mission_id: str) -> str:
    mid = uuid.UUID(mission_id)
    # Execute the (fresh) Mission. run_mission guarantees a terminal status on its own.
    await asyncio.to_thread(run_mission, mid)

    db = SessionLocal()
    try:
        mission = db.get(Mission, mid)
        if mission is None:
            return "gone"
        # Audit-trail-safe auto-retry: spawn a NEW linked Mission and enqueue it, never re-run this
        # row (which would collide on mission_steps).
        if (
            mission.status == "failed"
            and mission.failure_category in _RETRYABLE
            and mission.attempt_number < MAX_ATTEMPTS
        ):
            retried = retry_mission(db, mission)
            await enqueue_mission(retried.id)
            return f"retried:{retried.id}"
        return mission.status
    finally:
        db.close()


class WorkerSettings:
    functions = [run_mission_task]
    redis_settings = RedisSettings.from_dsn(settings.redis_url)
    # We own retry via new linked Missions; arq must not also retry the same job.
    max_tries = 1
    job_timeout = 300
