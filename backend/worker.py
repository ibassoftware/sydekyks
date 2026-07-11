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
from datetime import datetime, timezone

from arq import cron
from arq.connections import RedisSettings

from app.core.config import settings
from app.db.session import SessionLocal
from app.models.mission import Mission
from app.models.sydekyk import Sydekyk, SydekykInstall
from app.services import bill_poll, recruitment_poll, usage_snapshot
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


async def _poll_recruitment(db, *, slug: str, settings_model, require_job: bool = False) -> int:
    """Shared cron body for Decode/Scout: for each tenant with the Sydekyk installed + cron enabled,
    enqueue Missions for unprocessed applicants (≤30). `require_job` restricts to job-assigned
    applicants (Scout). Bumps each tenant's poll watermark."""
    sydekyk = db.query(Sydekyk).filter(Sydekyk.slug == slug).first()
    if sydekyk is None:
        return 0
    total = 0
    for st in db.query(settings_model).filter(settings_model.cron_enabled.is_(True)).all():
        installed = (
            db.query(SydekykInstall)
            .filter(SydekykInstall.tenant_id == st.tenant_id, SydekykInstall.sydekyk_id == sydekyk.id)
            .first()
        )
        if installed is None:
            continue
        since = st.cron_last_polled_at.strftime("%Y-%m-%d %H:%M:%S") if st.cron_last_polled_at else None
        total += await recruitment_poll.enqueue_untagged_applicants(
            db, tenant_id=st.tenant_id, sydekyk_id=sydekyk.id, tag_name=st.processed_tag_name,
            limit=st.cron_poll_limit, since=since, require_job=require_job,
        )
        st.cron_last_polled_at = datetime.now(timezone.utc)
        db.commit()
    return total


async def poll_decode(ctx: dict) -> int:
    from app.sydekyks.decode.models import DecodeTenantSettings

    db = SessionLocal()
    try:
        return await _poll_recruitment(db, slug="decode", settings_model=DecodeTenantSettings)
    finally:
        db.close()


async def poll_scout(ctx: dict) -> int:
    from app.sydekyks.scout.models import ScoutTenantSettings

    db = SessionLocal()
    try:
        return await _poll_recruitment(db, slug="scout", settings_model=ScoutTenantSettings, require_job=True)
    finally:
        db.close()


async def _poll_bills(db, *, slug: str, settings_model, store_model) -> int:
    """Shared cron body for the audit agents (Mirror, Shield): for each tenant with the Sydekyk
    installed + cron enabled, scan forward from the watermark for unchecked vendor bills."""
    sydekyk = db.query(Sydekyk).filter(Sydekyk.slug == slug).first()
    if sydekyk is None:
        return 0
    total = 0
    for st in db.query(settings_model).filter(settings_model.cron_enabled.is_(True)).all():
        installed = (
            db.query(SydekykInstall)
            .filter(SydekykInstall.tenant_id == st.tenant_id, SydekykInstall.sydekyk_id == sydekyk.id)
            .first()
        )
        if installed is None:
            continue
        # Mirror can restrict to posted bills via include_drafts; Shield always scans both.
        states = None if getattr(st, "include_drafts", True) else ["posted"]
        count, newest = await bill_poll.enqueue_recent_bills(
            db, tenant_id=st.tenant_id, sydekyk_id=sydekyk.id, store_model=store_model,
            days_back=st.cron_days_back, limit=st.cron_poll_limit, since=st.cron_last_checked_at, states=states,
        )
        if newest:
            st.cron_last_checked_at = newest
            db.commit()
        total += count
    return total


async def poll_mirror(ctx: dict) -> int:
    from app.sydekyks.mirror.models import MirrorFinding, MirrorTenantSettings

    db = SessionLocal()
    try:
        return await _poll_bills(db, slug="mirror", settings_model=MirrorTenantSettings, store_model=MirrorFinding)
    finally:
        db.close()


async def poll_shield(ctx: dict) -> int:
    from app.sydekyks.shield.models import ShieldFinding, ShieldTenantSettings

    db = SessionLocal()
    try:
        return await _poll_bills(db, slug="shield", settings_model=ShieldTenantSettings, store_model=ShieldFinding)
    finally:
        db.close()


async def audit_review_assignees(ctx: dict) -> int:
    """Daily: check that each agent's assigned Odoo reviewers still exist + are active; raise a
    Command-Center issue for the admin if any were removed or deactivated."""
    from app.models.review_assignment import ReviewAssignment
    from app.services import review_assignment as ra_svc

    db = SessionLocal()
    try:
        targets = [(ra.tenant_id, ra.sydekyk_id) for ra in db.query(ReviewAssignment).all() if ra.odoo_user_ids]
        flagged = 0
        for tid, sid in targets:
            bad = await asyncio.to_thread(ra_svc.audit_assignees, db, tenant_id=tid, sydekyk_id=sid)
            if bad:
                flagged += 1
        return flagged
    finally:
        db.close()


async def snapshot_daily_usage(ctx: dict) -> int:
    db = SessionLocal()
    try:
        return usage_snapshot.snapshot_yesterday(db)
    finally:
        db.close()


class WorkerSettings:
    functions = [run_mission_task]
    cron_jobs = [
        cron(poll_decode, minute={0, 15, 30, 45}),
        cron(poll_scout, minute={0, 15, 30, 45}),
        cron(poll_mirror, minute={5, 20, 35, 50}),
        cron(poll_shield, minute={10, 25, 40, 55}),
        cron(audit_review_assignees, hour={2}, minute={0}),
        cron(snapshot_daily_usage, hour={0}, minute={5}),
    ]
    redis_settings = RedisSettings.from_dsn(settings.redis_url)
    # We own retry via new linked Missions; arq must not also retry the same job.
    max_tries = 1
    job_timeout = 300
