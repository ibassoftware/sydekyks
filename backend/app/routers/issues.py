import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.deps import require_commander, require_tenant_member
from app.db.session import get_db
from app.models.mission import Mission, MissionDocument
from app.models.sydekyk import Sydekyk
from app.models.tenant_issue import TenantIssue
from app.models.user import User
from app.schemas.tenant_issue import IssuesCountOut, IssuesOut, MissionReviewItem, TenantIssueOut
from app.services import gadget_links, tenant_issues as tenant_issues_svc

router = APIRouter(prefix="/api/tenant", tags=["issues"], dependencies=[Depends(require_tenant_member)])


def _issue_out(db: Session, issue: TenantIssue, sydekyk_name: str | None) -> TenantIssueOut:
    return TenantIssueOut(
        id=issue.id, sydekyk_id=issue.sydekyk_id, sydekyk_name=sydekyk_name, kind=issue.kind,
        title=issue.title, detail=issue.detail, status=issue.status, occurrence_count=issue.occurrence_count,
        first_seen_at=issue.first_seen_at, last_seen_at=issue.last_seen_at, resolved_at=issue.resolved_at,
        odoo_bill_url=tenant_issues_svc.resolve_odoo_bill_url(db, issue),
    )


@router.get("/issues", response_model=IssuesOut)
def list_issues(
    sydekyk_id: uuid.UUID | None = None,
    user: User = Depends(require_tenant_member),
    db: Session = Depends(get_db),
):
    """Everything needing a tenant human's attention: standing config issues (e.g. missing Odoo
    tax setup) plus recent Missions the Playbook flagged for manual review. Also returns the most
    recently resolved issues so a Commander can reopen one after the fact, not just via the
    immediate undo toast. Optionally scoped to one Sydekyk (e.g. linked from its Roster detail
    page) — omit to see everything across the tenant."""
    open_q = (
        db.query(TenantIssue, Sydekyk.name)
        .outerjoin(Sydekyk, Sydekyk.id == TenantIssue.sydekyk_id)
        .filter(TenantIssue.tenant_id == user.tenant_id, TenantIssue.status == "open")
    )
    if sydekyk_id is not None:
        open_q = open_q.filter(TenantIssue.sydekyk_id == sydekyk_id)
    rows = open_q.order_by(TenantIssue.last_seen_at.desc()).all()
    config_issues = [_issue_out(db, i, name) for i, name in rows]

    resolved_q = (
        db.query(TenantIssue, Sydekyk.name)
        .outerjoin(Sydekyk, Sydekyk.id == TenantIssue.sydekyk_id)
        .filter(TenantIssue.tenant_id == user.tenant_id, TenantIssue.status == "resolved")
    )
    if sydekyk_id is not None:
        resolved_q = resolved_q.filter(TenantIssue.sydekyk_id == sydekyk_id)
    resolved_rows = resolved_q.order_by(TenantIssue.resolved_at.desc()).limit(20).all()
    resolved_issues = [_issue_out(db, i, name) for i, name in resolved_rows]

    mission_q = (
        db.query(Mission, MissionDocument.filename, Sydekyk.name, User.email)
        .outerjoin(MissionDocument, MissionDocument.mission_id == Mission.id)
        .outerjoin(Sydekyk, Sydekyk.id == Mission.sydekyk_id)
        .outerjoin(User, User.id == Mission.reviewed_by_user_id)
        .filter(
            Mission.tenant_id == user.tenant_id,
            Mission.result_summary["needs_review"].astext == "true",
        )
    )
    if sydekyk_id is not None:
        mission_q = mission_q.filter(Mission.sydekyk_id == sydekyk_id)
    # Unreviewed first, then most recent — so what still needs attention floats to the top.
    mission_rows = mission_q.order_by(Mission.reviewed_at.isnot(None), Mission.created_at.desc()).limit(50).all()
    missions_needing_review = [_review_item(db, m, fn, name, reviewer_email) for m, fn, name, reviewer_email in mission_rows]

    return IssuesOut(config_issues=config_issues, resolved_issues=resolved_issues,
                     missions_needing_review=missions_needing_review)


def _review_item(db: Session, m: Mission, filename, sydekyk_name, reviewer_email) -> MissionReviewItem:
    rs = m.result_summary or {}
    move_id = rs.get("odoo_move_id")
    odoo_url = (
        gadget_links.build_odoo_bill_url(db, tenant_id=m.tenant_id, sydekyk_id=m.sydekyk_id, move_id=move_id)
        if move_id else None
    )
    return MissionReviewItem(
        mission_id=m.id, sydekyk_name=sydekyk_name, document_filename=filename,
        reason=rs.get("review_reason"), created_at=m.created_at,
        odoo_bill_url=odoo_url, vendor_name=rs.get("vendor_name"), invoice_number=rs.get("invoice_number"),
        total=rs.get("total"), currency=rs.get("currency"), posted=rs.get("posted"), duplicate=rs.get("duplicate"),
        reviewed=m.reviewed_at is not None, reviewed_at=m.reviewed_at, reviewed_by_email=reviewer_email,
    )


@router.get("/issues/count", response_model=IssuesCountOut)
def issues_count(user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    """Lightweight counts for the sidebar notification badge — open config issues plus Missions
    still awaiting review (a reviewed Mission no longer counts)."""
    open_config = (
        db.query(func.count(TenantIssue.id))
        .filter(TenantIssue.tenant_id == user.tenant_id, TenantIssue.status == "open")
        .scalar()
    ) or 0
    needing_review = (
        db.query(func.count(Mission.id))
        .filter(
            Mission.tenant_id == user.tenant_id,
            Mission.result_summary["needs_review"].astext == "true",
            Mission.reviewed_at.is_(None),
        )
        .scalar()
    ) or 0
    return IssuesCountOut(
        config_issues=int(open_config), missions_needing_review=int(needing_review),
        total=int(open_config) + int(needing_review),
    )


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
