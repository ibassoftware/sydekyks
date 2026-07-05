import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.deps import require_tenant_member
from app.db.session import get_db
from app.models.mission import Mission, MissionDocument
from app.models.user import User
from app.schemas.mission import MissionDetailOut, MissionOut, MissionStepOut

router = APIRouter(prefix="/api/tenant", tags=["missions"], dependencies=[Depends(require_tenant_member)])


def _filename(db: Session, mission_id: uuid.UUID) -> str | None:
    doc = db.query(MissionDocument.filename).filter(MissionDocument.mission_id == mission_id).first()
    return doc[0] if doc else None


@router.get("/sydekyks/{sydekyk_id}/missions", response_model=list[MissionOut])
def list_missions(
    sydekyk_id: uuid.UUID, limit: int = 20, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)
):
    missions = (
        db.query(Mission)
        .filter(Mission.tenant_id == user.tenant_id, Mission.sydekyk_id == sydekyk_id)
        .order_by(Mission.created_at.desc())
        .limit(min(limit, 100))
        .all()
    )
    return [
        MissionOut(
            id=m.id,
            sydekyk_id=m.sydekyk_id,
            playbook_key=m.playbook_key,
            signal_type=m.signal_type,
            status=m.status,
            result_summary=m.result_summary,
            error_message=m.error_message,
            document_filename=_filename(db, m.id),
            created_at=m.created_at,
            completed_at=m.completed_at,
        )
        for m in missions
    ]


@router.get("/missions/{mission_id}", response_model=MissionDetailOut)
def get_mission(mission_id: uuid.UUID, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    mission = db.get(Mission, mission_id)
    if mission is None or mission.tenant_id != user.tenant_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Mission not found")

    return MissionDetailOut(
        id=mission.id,
        sydekyk_id=mission.sydekyk_id,
        playbook_key=mission.playbook_key,
        signal_type=mission.signal_type,
        status=mission.status,
        result_summary=mission.result_summary,
        error_message=mission.error_message,
        document_filename=_filename(db, mission.id),
        created_at=mission.created_at,
        completed_at=mission.completed_at,
        steps=[MissionStepOut.model_validate(s, from_attributes=True) for s in mission.steps],
    )
