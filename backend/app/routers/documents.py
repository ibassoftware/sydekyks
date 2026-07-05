import hashlib
import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.deps import require_tenant_member
from app.db.session import get_db
from app.models.sydekyk import Sydekyk, SydekykInstall
from app.models.user import User
from app.schemas.mission import MissionOut
from app.services.missions import create_mission_for_document, run_mission

router = APIRouter(prefix="/api/tenant", tags=["documents"], dependencies=[Depends(require_tenant_member)])

_ALLOWED_TYPES = {"application/pdf", "image/png", "image/jpeg", "image/webp"}
_ALLOWED_EXTS = (".pdf", ".png", ".jpg", ".jpeg", ".webp")
_MAX_BYTES = 15 * 1024 * 1024


def _mission_out(mission, filename: str | None) -> MissionOut:
    return MissionOut(
        id=mission.id,
        sydekyk_id=mission.sydekyk_id,
        playbook_key=mission.playbook_key,
        signal_type=mission.signal_type,
        status=mission.status,
        result_summary=mission.result_summary,
        error_message=mission.error_message,
        document_filename=filename,
        created_at=mission.created_at,
        completed_at=mission.completed_at,
    )


@router.post("/sydekyks/{sydekyk_id}/documents", response_model=list[MissionOut], status_code=status.HTTP_201_CREATED)
async def upload_documents(
    sydekyk_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    files: list[UploadFile],
    user: User = Depends(require_tenant_member),
    db: Session = Depends(get_db),
):
    sydekyk = (
        db.query(Sydekyk)
        .filter(
            Sydekyk.id == sydekyk_id,
            Sydekyk.is_published.is_(True),
            or_(Sydekyk.tenant_id.is_(None), Sydekyk.tenant_id == user.tenant_id),
        )
        .first()
    )
    if sydekyk is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sydekyk not found")
    if not sydekyk.accepts_document_uploads or not sydekyk.playbook_key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This Sydekyk doesn't accept document uploads")
    if not sydekyk.is_exclusive:
        installed = (
            db.query(SydekykInstall)
            .filter(SydekykInstall.tenant_id == user.tenant_id, SydekykInstall.sydekyk_id == sydekyk_id)
            .first()
        )
        if installed is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Install this Sydekyk first")

    if not files:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No files uploaded")

    created = []
    for upload in files:
        data = await upload.read()
        name = upload.filename or "document"
        if upload.content_type not in _ALLOWED_TYPES and not name.lower().endswith(_ALLOWED_EXTS):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail=f"Unsupported file type: {name} ({upload.content_type})"
            )
        if len(data) > _MAX_BYTES:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{name} exceeds the 15MB limit")

        mission = create_mission_for_document(
            db,
            tenant_id=user.tenant_id,
            sydekyk=sydekyk,
            user_id=user.id,
            document_bytes=data,
            filename=name,
            content_type=upload.content_type or "application/octet-stream",
            sha256_hash=hashlib.sha256(data).hexdigest(),
            source="web_upload",
            signal_type="manual_upload",
        )
        background_tasks.add_task(run_mission, mission.id)
        created.append(_mission_out(mission, name))

    return created
