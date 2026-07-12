"""Shared 'scan for stale opportunities → enqueue a Mission each' poller for the sales agents (Nudge).

Bounded, never a full-table sweep: it pulls open opportunities with no *future* scheduled activity
that haven't been touched since a cutoff, then skips ones that are snoozed/whitelisted or were nudged
within the cadence window. The playbook applies the exact per-stage staleness test. A Mission carries
only the opp id in `trigger_context`. Hard-capped at 30 per run.
"""

import asyncio
import uuid
from datetime import date, datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.core.crypto import decrypt_secret
from app.models.sydekyk import Sydekyk
from app.services import gadget_links, odoo, odoo_crm
from app.services.missions import create_mission
from app.services.queue import enqueue_mission

MAX_LIMIT = 30


async def enqueue_stale_opportunities(
    db: Session, *, tenant_id: uuid.UUID, sydekyk_id: uuid.UUID, store_model, snooze_model,
    cadence_days: int, min_stale_days: int, limit: int = 30,
) -> tuple[int, dict | None]:
    """Enqueue a Mission per candidate opp that needs a closer look (≤30). `store_model`/`snooze_model`
    are Nudge's finding + snooze tables — used to skip recently-nudged and snoozed opps.

    Returns (enqueued_count, breakdown) where breakdown is a disposition of the WHOLE open pipeline so
    the run's 'sweep' receipt can honestly account for every opportunity, not just the ones it queued:
        {open_total, scheduled (has a future touch), snoozed, recently_nudged, enqueued}.
    Note: `enqueued` are opps that pass the coarse filter and go to the playbook for the precise
    per-stage staleness test — some will turn out 'still fresh' (recent chatter), so this is 'queued
    for review', not 'confirmed stale'.
    """
    limit = min(limit or MAX_LIMIT, MAX_LIMIT)
    link = gadget_links.find_assigned_link(db, tenant_id=tenant_id, sydekyk_id=sydekyk_id, role_key="erp")
    if link is None:
        return 0, None
    sydekyk = db.get(Sydekyk, sydekyk_id)
    if sydekyk is None:
        return 0, None

    ok, _msg, client = await asyncio.to_thread(
        odoo.connect, link.url, link.database, link.username, decrypt_secret(link.encrypted_secret)
    )
    if not ok or client is None:
        return 0, None

    won_ids = await asyncio.to_thread(odoo_crm.won_stage_ids, client)
    open_total = await asyncio.to_thread(odoo_crm.count_open_opportunities, client, won_ids=won_ids)
    scheduled = await asyncio.to_thread(odoo_crm.count_scheduled_opportunities, client, won_ids=won_ids)
    breakdown = {"open_total": open_total, "scheduled": scheduled, "snoozed": 0, "recently_nudged": 0, "enqueued": 0}

    cutoff = (datetime.now(timezone.utc) - timedelta(days=max(1, min_stale_days))).strftime("%Y-%m-%d %H:%M:%S")
    candidates = await asyncio.to_thread(
        odoo_crm.list_open_opportunities, client, cutoff=cutoff, limit=limit * 2, won_ids=won_ids
    )
    if not candidates:
        return 0, breakdown

    # Snoozed / whitelisted (snooze_until null = forever, else still in the future).
    today = date.today()
    snoozed = {
        r.odoo_lead_id
        for r in db.query(snooze_model.odoo_lead_id, snooze_model.snooze_until).filter(
            snooze_model.tenant_id == tenant_id, snooze_model.sydekyk_id == sydekyk_id
        )
        if r.snooze_until is None or (r.snooze_until.date() if hasattr(r.snooze_until, "date") else r.snooze_until) >= today
    }
    # Already nudged within the cadence window (any finding = a nudge we drafted).
    since = datetime.now(timezone.utc) - timedelta(days=max(1, cadence_days))
    recent = {
        r.odoo_lead_id
        for r in db.query(store_model.odoo_lead_id).filter(
            store_model.tenant_id == tenant_id, store_model.sydekyk_id == sydekyk_id,
            store_model.created_at >= since,
        )
    }

    count = 0
    for opp in candidates:
        if opp["id"] in snoozed:
            breakdown["snoozed"] += 1
            continue
        if opp["id"] in recent:
            breakdown["recently_nudged"] += 1
            continue
        if count >= limit:
            continue  # over the per-run cap — leave for the next run (scan-forward)
        mission = create_mission(
            db, tenant_id=tenant_id, sydekyk=sydekyk, user_id=None,
            source="odoo", signal_type="scheduled",
            trigger_context={"mode": "nudge_opp", "odoo_lead_id": opp["id"]},
        )
        await enqueue_mission(mission.id)
        count += 1
    breakdown["enqueued"] = count
    return count, breakdown
