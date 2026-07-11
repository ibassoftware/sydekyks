"""Shared 'scan forward from the last-checked watermark' poller for the audit agents (Mirror, Shield).

Both analyse EXISTING vendor bills (not an uploaded doc), so a Mission carries only the bill id in
`trigger_context`. The query scans vendor bills created since the tenant's watermark, never more than
`days_back` days back, hard-capped at 30 per run, and skips bills this agent already has a finding row
for (idempotent — re-running never re-flags the same bill). DRY: cron and the manual "Run now" button
call this same routine.
"""

import asyncio
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.core.crypto import decrypt_secret
from app.models.sydekyk import Sydekyk
from app.services import gadget_links, odoo, odoo_finance
from app.services.missions import create_mission
from app.services.queue import enqueue_mission

MAX_LIMIT = 30
MAX_DAYS_BACK = 5


async def enqueue_recent_bills(
    db: Session, *, tenant_id: uuid.UUID, sydekyk_id: uuid.UUID, store_model,
    days_back: int = 5, limit: int = 30, since: str | None = None, states: list[str] | None = None,
) -> tuple[int, str | None]:
    """Enqueue an analysis Mission for each unchecked vendor bill (scan-forward, ≤`days_back` days,
    ≤30). `store_model` is the agent's finding table (must have tenant_id/sydekyk_id/odoo_move_id) —
    used to skip already-analysed bills. `states` limits which move states are scanned (e.g.
    ["posted"] to skip drafts). Returns (enqueued_count, newest_create_date_seen)."""
    limit = min(limit or MAX_LIMIT, MAX_LIMIT)
    days_back = min(days_back or MAX_DAYS_BACK, MAX_DAYS_BACK)

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

    cutoff = (datetime.now(timezone.utc) - timedelta(days=days_back)).strftime("%Y-%m-%d %H:%M:%S")
    # Pull a buffer (2×) so that after skipping already-analysed bills we can still fill the batch.
    candidates = await asyncio.to_thread(
        odoo_finance.list_recent_bills, client, since=since, cutoff=cutoff, limit=limit * 2, states=states
    )
    if not candidates:
        return 0, None

    ids = [b["id"] for b in candidates]
    done = {
        r.odoo_move_id
        for r in db.query(store_model.odoo_move_id).filter(
            store_model.tenant_id == tenant_id,
            store_model.sydekyk_id == sydekyk_id,
            store_model.odoo_move_id.in_(ids),
        )
    }

    count = 0
    newest = since
    for bill in candidates:
        newest = bill.get("create_date") or newest  # candidates are create_date asc → advances
        if bill["id"] in done:
            continue
        mission = create_mission(
            db, tenant_id=tenant_id, sydekyk=sydekyk, user_id=None,
            source="odoo", signal_type="scheduled",
            trigger_context={"mode": "analyze_bill", "odoo_move_id": bill["id"]},
        )
        await enqueue_mission(mission.id)
        count += 1
        if count >= limit:
            break
    return count, newest
