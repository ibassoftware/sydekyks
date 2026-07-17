"""The `enqueue()` seam for Mission execution (VS-7).

Call sites (web upload, email webhook, retry) only ever call `enqueue_mission(id)`; they never learn
whether a durable queue (arq + Redis) or the in-process fallback ran the job. `run_mission` stays the
single worker entry point (it already opens its own DB session), so swapping backends is contained.

- `queue_enabled=True`  → dispatch to the arq worker over Redis (durable, survives restarts, retries).
- otherwise / on failure → fire-and-forget in-process on the threadpool (demo/dev without Redis).

The arq job id is set to the mission id so the same Mission can't be enqueued twice concurrently.
"""

import asyncio
import logging
import uuid

from app.core.config import settings

logger = logging.getLogger(__name__)


def _run_in_process(mission_id: uuid.UUID) -> None:
    """Fire-and-forget threadpool execution — the no-Redis fallback. Does not block the request;
    `run_mission` guarantees a terminal Mission status on its own."""
    from app.services.missions import run_mission

    try:
        loop = asyncio.get_running_loop()
        loop.run_in_executor(None, run_mission, mission_id)
    except RuntimeError:
        # No running loop (called from sync context) — run directly.
        run_mission(mission_id)


async def enqueue_mission(mission_id: uuid.UUID) -> str:
    """Schedule a Mission for execution. Returns the backend used: 'queue' or 'in-process'."""
    if settings.queue_enabled:
        try:
            from arq import create_pool
            from arq.connections import RedisSettings

            pool = await create_pool(RedisSettings.from_dsn(settings.redis_url))
            await pool.enqueue_job("run_mission_task", str(mission_id), _job_id=f"mission:{mission_id}")
            await pool.aclose()
            return "queue"
        except Exception as exc:  # noqa: BLE001 — degrade gracefully rather than drop the Mission
            logger.warning("arq enqueue failed (%s); falling back to in-process execution", exc)

    _run_in_process(mission_id)
    return "in-process"
