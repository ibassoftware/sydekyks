"""Shared 'poll Odoo for unprocessed applicants → enqueue a Mission each' routine, reused by both
Decode (cron) and Scout (run-now + cron). Queries ONLY applicants not yet stamped with the given
processed tag (never all), hard-capped at 30, and passes the target applicant id + résumé bytes to
the Mission. DRY: one place resolves Odoo, reads résumés, and creates the Missions.
"""

import asyncio
import hashlib
import uuid

from sqlalchemy.orm import Session

from app.core.crypto import decrypt_secret
from app.models.sydekyk import Sydekyk
from app.services import gadget_links, odoo, odoo_hr
from app.services.missions import create_mission_for_document
from app.services.queue import enqueue_mission


async def enqueue_untagged_applicants(
    db: Session, *, tenant_id: uuid.UUID, sydekyk_id: uuid.UUID, tag_name: str, limit: int = 30,
    since: str | None = None, require_job: bool = False,
) -> int:
    """Enqueue a Mission for each Odoo applicant not yet tagged `tag_name` (unprocessed only, ≤30).
    Skips applicants with no PDF résumé. `require_job` further restricts to applicants assigned to a
    job position (Scout). Returns the number of Missions enqueued."""
    limit = min(limit or 30, 30)
    link = gadget_links.find_assigned_link(db, tenant_id=tenant_id, sydekyk_id=sydekyk_id, role_key="erp")
    if link is None:
        return 0
    sydekyk = db.get(Sydekyk, sydekyk_id)
    if sydekyk is None:
        return 0

    ok, _msg, client = await asyncio.to_thread(
        odoo.connect, link.url, link.database, link.username, decrypt_secret(link.encrypted_secret)
    )
    if not ok or client is None:
        return 0

    applicants = await asyncio.to_thread(
        odoo_hr.search_untagged_applicants, client, tag_name, since=since, limit=limit, require_job=require_job
    )

    count = 0
    for applicant in applicants:
        res = await asyncio.to_thread(odoo_hr.read_resume_attachment, client, applicant["id"])
        if res is None:
            continue  # nothing to read/score — skip (create_date watermark keeps it from re-polling)
        content_bytes, filename, mimetype = res
        mission = create_mission_for_document(
            db,
            tenant_id=tenant_id,
            sydekyk=sydekyk,
            user_id=None,
            document_bytes=content_bytes,
            filename=filename,
            content_type=mimetype,
            sha256_hash=hashlib.sha256(content_bytes).hexdigest(),
            source="odoo",
            signal_type="scheduled",
            trigger_context={"mode": "enrich_existing", "odoo_applicant_id": applicant["id"]},
        )
        await enqueue_mission(mission.id)
        count += 1
    return count
