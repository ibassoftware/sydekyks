"""Standing tenant-visible issue reporting.

`report_issue` is called from a Playbook when it detects a recurring environment/config gap
(e.g. missing Odoo tax config). It upserts by (tenant, sydekyk, kind) so 50 bills hitting the same
gap produce ONE issue row with an occurrence count, not 50 duplicate rows.
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models.tenant_issue import TenantIssue


def report_issue(
    db: Session, *, tenant_id: uuid.UUID, sydekyk_id: uuid.UUID | None, kind: str, title: str, detail: str | None
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
        # A previously resolved issue that recurs re-opens itself — the human action didn't stick.
        if existing.status == "resolved":
            existing.status = "open"
            existing.resolved_at = None
            existing.resolved_by_user_id = None
        db.commit()
        return existing

    issue = TenantIssue(
        tenant_id=tenant_id, sydekyk_id=sydekyk_id, kind=kind, title=title, detail=detail,
        status="open", occurrence_count=1, first_seen_at=now, last_seen_at=now,
    )
    db.add(issue)
    db.commit()
    db.refresh(issue)
    return issue


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
