"""arq worker for Mission execution (VS-7).

Run with:  arq worker.WorkerSettings

`run_mission` is synchronous and opens its own DB session, so it runs in a threadpool to avoid
blocking the event loop. Retry policy is driven by the Mission's `failure_category` (set by the
playbook), never by matching error strings:

  - transient / external  → let arq retry with backoff (raise to signal retry).
  - setup / validation     → terminal; do not retry (the Mission is already marked failed).
"""

import uuid

from arq.connections import RedisSettings

from app.core.config import settings
from app.db.session import SessionLocal
from app.models.mission import Mission

# Categories that are worth another attempt automatically.
_RETRYABLE = {"transient", "external"}
MAX_TRIES = 4


async def run_mission_task(ctx: dict, mission_id: str) -> str:
    import asyncio

    from app.services.missions import run_mission

    mid = uuid.UUID(mission_id)
    await asyncio.to_thread(run_mission, mid)

    # Decide whether arq should retry, based on the classified outcome.
    db = SessionLocal()
    try:
        mission = db.get(Mission, mid)
        if mission is None:
            return "gone"
        if mission.status == "failed" and mission.failure_category in _RETRYABLE and ctx["job_try"] < MAX_TRIES:
            from arq.worker import Retry

            # Backoff grows with the attempt number; setup/validation failures never reach here.
            raise Retry(defer=ctx["job_try"] * 10)
        return mission.status
    finally:
        db.close()


class WorkerSettings:
    functions = [run_mission_task]
    redis_settings = RedisSettings.from_dsn(settings.redis_url)
    max_tries = MAX_TRIES
    job_timeout = 300
