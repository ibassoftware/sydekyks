import csv
import io
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.deps import require_commander, require_tenant_member
from app.db.session import get_db
from app.models.mission import Mission, MissionDocument, MissionStep
from app.models.sydekyk import Sydekyk
from app.models.user import User
from app.schemas.mission import MissionDetailOut, MissionOut, MissionPage, MissionStepOut
from app.services.missions import retry_mission
from app.services.queue import enqueue_mission

router = APIRouter(prefix="/api/tenant", tags=["missions"], dependencies=[Depends(require_tenant_member)])


def _filename(db: Session, mission_id: uuid.UUID) -> str | None:
    doc = db.query(MissionDocument.filename).filter(MissionDocument.mission_id == mission_id).first()
    return doc[0] if doc else None


def _mission_out(
    m: Mission, *, filename: str | None, source: str | None, sydekyk_name: str | None, last_step_key: str | None = None
) -> MissionOut:
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
        error_message=m.error_message,
        document_filename=filename,
        last_step_key=last_step_key,
        parent_mission_id=m.parent_mission_id,
        root_mission_id=m.root_mission_id,
        attempt_number=m.attempt_number,
        created_at=m.created_at,
        completed_at=m.completed_at,
    )


def _apply_filters(query, *, sydekyk_id, status_, signal_type, source, filename, date_from, date_to):
    if sydekyk_id is not None:
        query = query.filter(Mission.sydekyk_id == sydekyk_id)
    if status_:
        query = query.filter(Mission.status == status_)
    if signal_type:
        query = query.filter(Mission.signal_type == signal_type)
    if source:
        query = query.filter(MissionDocument.source == source)
    if filename:
        query = query.filter(MissionDocument.filename.ilike(f"%{filename}%"))
    if date_from:
        query = query.filter(Mission.created_at >= date_from)
    if date_to:
        query = query.filter(Mission.created_at <= date_to)
    return query


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
    base = _apply_filters(
        base, sydekyk_id=sydekyk_id, status_=status_, signal_type=signal_type,
        source=source, filename=filename, date_from=date_from, date_to=date_to,
    )

    count_q = (
        db.query(func.count(Mission.id))
        .outerjoin(MissionDocument, MissionDocument.mission_id == Mission.id)
        .filter(Mission.tenant_id == user.tenant_id)
    )
    count_q = _apply_filters(
        count_q, sydekyk_id=sydekyk_id, status_=status_, signal_type=signal_type,
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
    q = _apply_filters(
        q, sydekyk_id=sydekyk_id, status_=status_, signal_type=signal_type,
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
    return MissionDetailOut(
        **base.model_dump(),
        steps=[MissionStepOut.model_validate(s, from_attributes=True) for s in mission.steps],
    )


@router.post("/missions/{mission_id}/retry", response_model=MissionOut, status_code=status.HTTP_201_CREATED)
async def retry(mission_id: uuid.UUID, user: User = Depends(require_commander), db: Session = Depends(get_db)):
    """Retry a failed Mission by creating a new linked Mission that replays the original (VS-4)."""
    original = db.get(Mission, mission_id)
    if original is None or original.tenant_id != user.tenant_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Mission not found")
    try:
        new_mission = retry_mission(db, original)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    await enqueue_mission(new_mission.id)
    sydekyk = db.get(Sydekyk, new_mission.sydekyk_id)
    return _mission_out(new_mission, filename=_filename(db, new_mission.id), source="web_upload"
                        if original.signal_type == "manual_upload" else "email",
                        sydekyk_name=sydekyk.name if sydekyk else None)
