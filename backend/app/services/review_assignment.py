"""The shared review-assignment tool, reused by every agent (DRY). Two jobs:

1. `assign_on_flag(...)` — when an agent flags a record (a needs-review bill, a pooled applicant, a
   possible duplicate, a risky bill), create an Odoo To-Do activity on that record for each configured
   reviewer, so it lands in their Odoo activities. Called from each playbook at its flag point.
2. `audit_assignees(...)` — a cron checks that assigned reviewers still exist and are active in Odoo;
   if one was removed or deactivated, raise a Command-Center issue so an admin re-assigns.
"""

import uuid

from sqlalchemy.orm import Session

from app.core.crypto import decrypt_secret
from app.models.review_assignment import ReviewAssignment
from app.services import gadget_links, odoo, odoo_activity, tenant_issues


def get(db: Session, tenant_id: uuid.UUID, sydekyk_id: uuid.UUID) -> ReviewAssignment | None:
    return (
        db.query(ReviewAssignment)
        .filter(ReviewAssignment.tenant_id == tenant_id, ReviewAssignment.sydekyk_id == sydekyk_id)
        .first()
    )


def get_or_create(db: Session, tenant_id: uuid.UUID, sydekyk_id: uuid.UUID) -> ReviewAssignment:
    ra = get(db, tenant_id, sydekyk_id)
    if ra is None:
        ra = ReviewAssignment(tenant_id=tenant_id, sydekyk_id=sydekyk_id)
        db.add(ra)
        db.commit()
        db.refresh(ra)
    return ra


def _compose_note(note: str | None, steps: list[str] | None) -> str | None:
    """Build the activity body: the context (why it was flagged) followed by an actionable
    'What to do' checklist so the reviewer can fix it without guessing. Steps are optional — only
    included when the agent can suggest concrete next actions."""
    parts: list[str] = []
    if note:
        parts.append(note if note.lstrip().startswith("<") else f"<p>{note}</p>")
    if steps:
        parts.append("<p><b>What to do:</b></p><ol>" + "".join(f"<li>{s}</li>" for s in steps) + "</ol>")
    return "".join(parts) or None


def assign_on_flag(
    db: Session, client, *, tenant_id: uuid.UUID, sydekyk_id: uuid.UUID, model: str, res_id: int,
    summary: str, note: str | None = None, steps: list[str] | None = None,
) -> int:
    """Create a To-Do activity on the flagged record for each configured reviewer, with the context
    plus an actionable 'What to do' list (`steps`). No-op unless the agent has activity assignment
    turned on with at least one user. Best-effort — never fails the Mission. `client` is the
    already-open Odoo session from the playbook. Returns activities created."""
    ra = get(db, tenant_id, sydekyk_id)
    if ra is None or not ra.create_activity or not ra.odoo_user_ids:
        return 0
    body = _compose_note(note, steps)
    made = 0
    for uid in ra.odoo_user_ids:
        try:
            if odoo_activity.create_activity(
                client, model=model, res_id=res_id, user_id=int(uid), summary=summary, note=body, days=ra.activity_days
            ):
                made += 1
        except odoo.OdooError:
            continue
    return made


def audit_assignees(db: Session, *, tenant_id: uuid.UUID, sydekyk_id: uuid.UUID) -> list[int]:
    """Check each assigned reviewer against Odoo; return the ids that are removed or deactivated, and
    raise/refresh a Command-Center issue for the admin when any are found (auto-resolves when fixed)."""
    ra = get(db, tenant_id, sydekyk_id)
    if ra is None or not ra.odoo_user_ids:
        return []
    link = gadget_links.find_assigned_link(db, tenant_id=tenant_id, sydekyk_id=sydekyk_id, role_key="erp")
    if link is None:
        return []
    ok, _msg, client = odoo.connect(link.url, link.database, link.username, decrypt_secret(link.encrypted_secret))
    if not ok or client is None:
        return []
    status = odoo_activity.users_active_status(client, [int(u) for u in ra.odoo_user_ids])
    bad = [int(u) for u in ra.odoo_user_ids if not status.get(int(u), False)]  # missing (removed) or inactive
    if bad:
        names = odoo_activity.read_user_names(client, bad)
        who = ", ".join(names.get(u, f"user #{u}") for u in bad)
        tenant_issues.report_issue(  # idempotent upsert by (tenant, sydekyk, kind)
            db, tenant_id=tenant_id, sydekyk_id=sydekyk_id, kind="reviewer_unavailable",
            title="A review assignee is no longer available in Odoo",
            detail=f"These assigned reviewers were removed or deactivated in Odoo: {who}. "
                   f"Re-assign a reviewer in the Sydekyk's settings.",
        )
    return bad
