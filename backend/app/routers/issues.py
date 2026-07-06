import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.deps import require_commander, require_tenant_member
from app.db.session import get_db
from app.models.mission import Mission, MissionDocument
from app.models.sydekyk import Sydekyk
from app.models.tenant_issue import TenantIssue
from app.models.user import User
from app.schemas.tenant_issue import IssuesOut, MissionReviewItem, TenantIssueOut
from app.services import tenant_issues as tenant_issues_svc

router = APIRouter(prefix="/api/tenant", tags=["issues"], dependencies=[Depends(require_tenant_member)])


def _issue_out(db: Session, issue: TenantIssue, sydekyk_name: str | None) -> TenantIssueOut:
    return TenantIssueOut(
        id=issue.id, sydekyk_id=issue.sydekyk_id, sydekyk_name=sydekyk_name, kind=issue.kind,
        title=issue.title, detail=issue.detail, status=issue.status, occurrence_count=issue.occurrence_count,
        first_seen_at=issue.first_seen_at, last_seen_at=issue.last_seen_at, resolved_at=issue.resolved_at,
        odoo_bill_url=tenant_issues_svc.resolve_odoo_bill_url(db, issue),
    )


@router.get("/issues", response_model=IssuesOut)
def list_issues(user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    """Everything needing a tenant human's attention: standing config issues (e.g. missing Odoo
    tax setup) plus recent Missions the Playbook flagged for manual review. Also returns the most
    recently resolved issues so a Commander can reopen one after the fact, not just via the
    immediate undo toast."""
    rows = (
        db.query(TenantIssue, Sydekyk.name)
        .outerjoin(Sydekyk, Sydekyk.id == TenantIssue.sydekyk_id)
        .filter(TenantIssue.tenant_id == user.tenant_id, TenantIssue.status == "open")
        .order_by(TenantIssue.last_seen_at.desc())
        .all()
    )
    config_issues = [_issue_out(db, i, name) for i, name in rows]

    resolved_rows = (
        db.query(TenantIssue, Sydekyk.name)
        .outerjoin(Sydekyk, Sydekyk.id == TenantIssue.sydekyk_id)
        .filter(TenantIssue.tenant_id == user.tenant_id, TenantIssue.status == "resolved")
        .order_by(TenantIssue.resolved_at.desc())
        .limit(20)
        .all()
    )
    resolved_issues = [_issue_out(db, i, name) for i, name in resolved_rows]

    mission_rows = (
        db.query(Mission, MissionDocument.filename, Sydekyk.name)
        .outerjoin(MissionDocument, MissionDocument.mission_id == Mission.id)
        .outerjoin(Sydekyk, Sydekyk.id == Mission.sydekyk_id)
        .filter(
            Mission.tenant_id == user.tenant_id,
            Mission.result_summary["needs_review"].astext == "true",
        )
        .order_by(Mission.created_at.desc())
        .limit(50)
        .all()
    )
    missions_needing_review = [
        MissionReviewItem(
            mission_id=m.id, sydekyk_name=name, document_filename=fn,
            reason=(m.result_summary or {}).get("review_reason"), created_at=m.created_at,
        )
        for m, fn, name in mission_rows
    ]

    return IssuesOut(config_issues=config_issues, resolved_issues=resolved_issues,
                     missions_needing_review=missions_needing_review)


@router.post("/issues/{issue_id}/resolve", response_model=TenantIssueOut)
def resolve_issue(issue_id: uuid.UUID, user: User = Depends(require_commander), db: Session = Depends(get_db)):
    issue = db.query(TenantIssue).filter(TenantIssue.id == issue_id, TenantIssue.tenant_id == user.tenant_id).first()
    if issue is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Issue not found")
    tenant_issues_svc.resolve_issue(db, issue, user.id)
    sydekyk = db.get(Sydekyk, issue.sydekyk_id) if issue.sydekyk_id else None
    return _issue_out(db, issue, sydekyk.name if sydekyk else None)


@router.post("/issues/{issue_id}/reopen", response_model=TenantIssueOut)
def reopen_issue(issue_id: uuid.UUID, user: User = Depends(require_commander), db: Session = Depends(get_db)):
    """Undo a resolve — from the undo toast, or from the Resolved list later on."""
    issue = db.query(TenantIssue).filter(TenantIssue.id == issue_id, TenantIssue.tenant_id == user.tenant_id).first()
    if issue is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Issue not found")
    tenant_issues_svc.reopen_issue(db, issue)
    sydekyk = db.get(Sydekyk, issue.sydekyk_id) if issue.sydekyk_id else None
    return _issue_out(db, issue, sydekyk.name if sydekyk else None)
