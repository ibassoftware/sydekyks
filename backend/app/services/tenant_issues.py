"""Standing tenant-visible issue reporting.

`report_issue` is called from a Playbook when it detects a recurring environment/config gap
(e.g. missing Odoo tax config). It upserts by (tenant, sydekyk, kind) so 50 bills hitting the same
gap produce ONE issue row with an occurrence count, not 50 duplicate rows.
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models.mission import Mission
from app.models.tenant_issue import TenantIssue
from app.services.gadget_links import build_odoo_bill_url


def report_issue(
    db: Session, *, tenant_id: uuid.UUID, sydekyk_id: uuid.UUID | None, kind: str, title: str, detail: str | None,
    mission_id: uuid.UUID | None = None,
) -> TenantIssue:
    existing = (
        db.query(TenantIssue)
        .filter(TenantIssue.tenant_id == tenant_id, TenantIssue.sydekyk_id == sydekyk_id, TenantIssue.kind == kind)
        .first()
    )
    now = datetime.now(timezone.utc)
    if existing is not None:
        existing.occurrence_count += 1
        existing.last_seen_at = now
        existing.detail = detail
        existing.mission_id = mission_id  # point at the LATEST mission that hit this gap
        # A previously resolved issue that recurs re-opens itself — the human action didn't stick.
        if existing.status == "resolved":
            existing.status = "open"
            existing.resolved_at = None
            existing.resolved_by_user_id = None
        db.commit()
        return existing

    issue = TenantIssue(
        tenant_id=tenant_id, sydekyk_id=sydekyk_id, kind=kind, title=title, detail=detail, mission_id=mission_id,
        status="open", occurrence_count=1, first_seen_at=now, last_seen_at=now,
    )
    db.add(issue)
    db.commit()
    db.refresh(issue)
    return issue


def resolve_odoo_bill_url(db: Session, issue: TenantIssue) -> str | None:
    """If this issue's most recent Mission created an Odoo vendor bill (even as an unposted
    draft), build a deep link straight to it — so a human jumps directly into Odoo instead of
    hunting for the bill manually. Returns None whenever any piece is missing (no linked Mission,
    the Mission never created a bill — e.g. an unresolvable-currency Mission creates none — or no
    Odoo instance is assigned)."""
    if issue.mission_id is None:
        return None
    mission = db.get(Mission, issue.mission_id)
    if mission is None or not mission.result_summary:
        return None
    move_id = mission.result_summary.get("odoo_move_id")
    if not move_id:
        return None
    return build_odoo_bill_url(db, tenant_id=issue.tenant_id, sydekyk_id=issue.sydekyk_id, move_id=move_id)


def resolve_issue(db: Session, issue: TenantIssue, resolved_by_user_id: uuid.UUID) -> TenantIssue:
    issue.status = "resolved"
    issue.resolved_at = datetime.now(timezone.utc)
    issue.resolved_by_user_id = resolved_by_user_id
    db.commit()
    db.refresh(issue)
    return issue


def reopen_issue(db: Session, issue: TenantIssue) -> TenantIssue:
    """Undo a resolve — a human decided too soon, or the fix didn't stick. Deliberately does NOT
    touch occurrence_count/last_seen_at (those track actual detection events, not this manual
    action)."""
    issue.status = "open"
    issue.resolved_at = None
    issue.resolved_by_user_id = None
    db.commit()
    db.refresh(issue)
    return issue
