import csv
import io
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.deps import require_tenant_member
from app.db.session import get_db
from app.models.mission import Mission, MissionDocument, MissionStep
from app.models.sydekyk import Sydekyk
from app.models.user import User
from app.services import permissions
from app.schemas.mission import MissionDetailOut, MissionOut, MissionPage, MissionStepOut
from app.schemas.tenant_issue import MissionReviewStatusOut
from app.services import gadget_links
from app.services.error_display import friendly_message
from app.services.missions import apply_mission_filters, retry_mission
from app.services.queue import enqueue_mission

router = APIRouter(prefix="/api/tenant", tags=["missions"], dependencies=[Depends(require_tenant_member)])


def _filename(db: Session, mission_id: uuid.UUID) -> str | None:
    doc = db.query(MissionDocument.filename).filter(MissionDocument.mission_id == mission_id).first()
    return doc[0] if doc else None


def _mission_out(
    m: Mission, *, filename: str | None, source: str | None, sydekyk_name: str | None, last_step_key: str | None = None
) -> MissionOut:
    """Tenant-facing serialization — error_message is sanitized (raw text stays in the DB and is
    what Command Center's admin endpoints return; see app/services/error_display.py)."""
    return MissionOut(
        id=m.id,
        sydekyk_id=m.sydekyk_id,
        sydekyk_name=sydekyk_name,
        playbook_key=m.playbook_key,
        signal_type=m.signal_type,
        source=source,
        status=m.status,
        failure_category=m.failure_category,
        result_summary=m.result_summary,
        error_message=friendly_message(m.error_message),
        document_filename=filename,
        last_step_key=last_step_key,
        reviewed=m.reviewed_at is not None,
        parent_mission_id=m.parent_mission_id,
        root_mission_id=m.root_mission_id,
        attempt_number=m.attempt_number,
        created_at=m.created_at,
        completed_at=m.completed_at,
    )


@router.get("/sydekyks/{sydekyk_id}/missions", response_model=list[MissionOut])
def list_missions(
    sydekyk_id: uuid.UUID, limit: int = 20, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)
):
    # Single LEFT JOIN instead of a per-row filename lookup (avoids N+1).
    rows = (
        db.query(Mission, MissionDocument.filename, MissionDocument.source, Sydekyk.name)
        .outerjoin(MissionDocument, MissionDocument.mission_id == Mission.id)
        .outerjoin(Sydekyk, Sydekyk.id == Mission.sydekyk_id)
        .filter(Mission.tenant_id == user.tenant_id, Mission.sydekyk_id == sydekyk_id)
        .order_by(Mission.created_at.desc())
        .limit(min(limit, 100))
        .all()
    )
    return [_mission_out(m, filename=fn, source=src, sydekyk_name=name) for m, fn, src, name in rows]


@router.get("/missions", response_model=MissionPage)
def list_all_missions(
    sydekyk_id: uuid.UUID | None = None,
    status_: str | None = Query(default=None, alias="status"),
    signal_type: str | None = None,
    source: str | None = None,
    filename: str | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    limit: int = 25,
    offset: int = 0,
    user: User = Depends(require_tenant_member),
    db: Session = Depends(get_db),
):
    """Tenant-wide Mission operations feed with filters + pagination (VS-3)."""
    limit = max(1, min(limit, 100))
    base = (
        db.query(Mission, MissionDocument.filename, MissionDocument.source, Sydekyk.name)
        .outerjoin(MissionDocument, MissionDocument.mission_id == Mission.id)
        .outerjoin(Sydekyk, Sydekyk.id == Mission.sydekyk_id)
        .filter(Mission.tenant_id == user.tenant_id)
    )
    base = apply_mission_filters(
        base, sydekyk_id=sydekyk_id, status=status_, signal_type=signal_type,
        source=source, filename=filename, date_from=date_from, date_to=date_to,
    )

    count_q = (
        db.query(func.count(Mission.id))
        .outerjoin(MissionDocument, MissionDocument.mission_id == Mission.id)
        .filter(Mission.tenant_id == user.tenant_id)
    )
    count_q = apply_mission_filters(
        count_q, sydekyk_id=sydekyk_id, status=status_, signal_type=signal_type,
        source=source, filename=filename, date_from=date_from, date_to=date_to,
    )
    total = count_q.scalar() or 0

    rows = base.order_by(Mission.created_at.desc()).limit(limit).offset(offset).all()
    items = [_mission_out(m, filename=fn, source=src, sydekyk_name=name) for m, fn, src, name in rows]
    return MissionPage(items=items, total=total, limit=limit, offset=offset)


@router.get("/missions/active", response_model=list[MissionOut])
def list_active_missions(user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    """Currently queued/running Missions for the tenant — powers the live activity toast, roster
    badges, and dashboard count. Kept small (only active runs), so the per-row latest-step lookup is
    cheap."""
    rows = (
        db.query(Mission, MissionDocument.filename, MissionDocument.source, Sydekyk.name)
        .outerjoin(MissionDocument, MissionDocument.mission_id == Mission.id)
        .outerjoin(Sydekyk, Sydekyk.id == Mission.sydekyk_id)
        .filter(Mission.tenant_id == user.tenant_id, Mission.status.in_(["queued", "running"]))
        .order_by(Mission.created_at.desc())
        .all()
    )
    out = []
    for m, fn, src, name in rows:
        last_step = (
            db.query(MissionStep.step_key)
            .filter(MissionStep.mission_id == m.id)
            .order_by(MissionStep.step_index.desc())
            .first()
        )
        out.append(_mission_out(m, filename=fn, source=src, sydekyk_name=name,
                                last_step_key=last_step[0] if last_step else None))
    return out


@router.get("/missions/export")
def export_missions(
    sydekyk_id: uuid.UUID | None = None,
    status_: str | None = Query(default=None, alias="status"),
    signal_type: str | None = None,
    source: str | None = None,
    filename: str | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    user: User = Depends(require_tenant_member),
    db: Session = Depends(get_db),
):
    """CSV export of the filtered Mission list (VS-14)."""
    q = (
        db.query(Mission, MissionDocument.filename, MissionDocument.source, Sydekyk.name)
        .outerjoin(MissionDocument, MissionDocument.mission_id == Mission.id)
        .outerjoin(Sydekyk, Sydekyk.id == Mission.sydekyk_id)
        .filter(Mission.tenant_id == user.tenant_id)
    )
    q = apply_mission_filters(
        q, sydekyk_id=sydekyk_id, status=status_, signal_type=signal_type,
        source=source, filename=filename, date_from=date_from, date_to=date_to,
    ).order_by(Mission.created_at.desc())

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["mission_id", "sydekyk", "filename", "source", "signal_type", "status",
                     "failure_category", "attempt", "created_at", "completed_at"])
    for m, fn, src, name in q.all():
        writer.writerow([
            str(m.id), name or "", fn or "", src or "", m.signal_type, m.status,
            m.failure_category or "", m.attempt_number,
            m.created_at.isoformat() if m.created_at else "",
            m.completed_at.isoformat() if m.completed_at else "",
        ])
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=missions.csv"},
    )


@router.get("/missions/{mission_id}", response_model=MissionDetailOut)
def get_mission(mission_id: uuid.UUID, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    mission = db.get(Mission, mission_id)
    if mission is None or mission.tenant_id != user.tenant_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Mission not found")

    sydekyk = db.get(Sydekyk, mission.sydekyk_id)
    doc = db.query(MissionDocument.filename, MissionDocument.source).filter(
        MissionDocument.mission_id == mission.id
    ).first()

    base = _mission_out(
        mission,
        filename=doc[0] if doc else None,
        source=doc[1] if doc else None,
        sydekyk_name=sydekyk.name if sydekyk else None,
    )
    # Only the detail endpoint pays for this lookup (not list rows) — a link straight to the Odoo
    # bill this Mission created, if any.
    move_id = (mission.result_summary or {}).get("odoo_move_id")
    if move_id:
        base.odoo_bill_url = gadget_links.build_odoo_bill_url(
            db, tenant_id=mission.tenant_id, sydekyk_id=mission.sydekyk_id, move_id=move_id
        )
    steps = [MissionStepOut.model_validate(s, from_attributes=True) for s in mission.steps]
    # Sanitize step-level errors too — this is exactly where a raw provider payload would otherwise
    # surface in the tenant-facing step trail.
    steps = [s.model_copy(update={"error_message": friendly_message(s.error_message)}) for s in steps]
    return MissionDetailOut(**base.model_dump(), steps=steps)


@router.post("/missions/{mission_id}/retry", response_model=MissionOut, status_code=status.HTTP_201_CREATED)
async def retry(mission_id: uuid.UUID, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    """Retry a failed Mission by creating a new linked Mission that replays the original (VS-4)."""
    original = db.get(Mission, mission_id)
    if original is None or original.tenant_id != user.tenant_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Mission not found")
    permissions.assert_can_use(db, user, original.sydekyk_id)
    try:
        new_mission = retry_mission(db, original)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    await enqueue_mission(new_mission.id)
    sydekyk = db.get(Sydekyk, new_mission.sydekyk_id)
    return _mission_out(new_mission, filename=_filename(db, new_mission.id), source="web_upload"
                        if original.signal_type == "manual_upload" else "email",
                        sydekyk_name=sydekyk.name if sydekyk else None)


def _review_status(m: Mission, reviewer_email: str | None) -> MissionReviewStatusOut:
    return MissionReviewStatusOut(
        mission_id=m.id, reviewed=m.reviewed_at is not None,
        reviewed_at=m.reviewed_at, reviewed_by_email=reviewer_email,
    )


@router.post("/missions/{mission_id}/review", response_model=MissionReviewStatusOut)
def mark_reviewed(mission_id: uuid.UUID, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    """Sign off on a Mission the Playbook flagged for review — records who cleared it and when."""
    mission = db.get(Mission, mission_id)
    if mission is None or mission.tenant_id != user.tenant_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Mission not found")
    permissions.assert_can_use(db, user, mission.sydekyk_id)
    mission.reviewed_at = datetime.now(timezone.utc)
    mission.reviewed_by_user_id = user.id
    db.commit()
    return _review_status(mission, user.email)


@router.delete("/missions/{mission_id}/review", response_model=MissionReviewStatusOut)
def unmark_reviewed(mission_id: uuid.UUID, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    """Undo a review sign-off — puts the Mission back in the needs-review queue."""
    mission = db.get(Mission, mission_id)
    if mission is None or mission.tenant_id != user.tenant_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Mission not found")
    permissions.assert_can_use(db, user, mission.sydekyk_id)
    mission.reviewed_at = None
    mission.reviewed_by_user_id = None
    db.commit()
    return _review_status(mission, None)
