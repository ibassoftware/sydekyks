import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.deps import require_super_admin
from app.core.security import hash_password
from app.db.session import get_db
from app.models.sydekyk import Sydekyk
from app.models.tenant import Tenant
from app.models.user import User
from app.schemas.sydekyk import SydekykAdminOut
from app.schemas.tenant import TenantCreate, TenantOut

router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(require_super_admin)])


@router.get("/tenants", response_model=list[TenantOut])
def list_tenants(db: Session = Depends(get_db)):
    return db.query(Tenant).order_by(Tenant.created_at.desc()).all()


@router.post("/tenants", response_model=TenantOut, status_code=status.HTTP_201_CREATED)
def create_tenant(payload: TenantCreate, db: Session = Depends(get_db)):
    if db.query(Tenant).filter(Tenant.slug == payload.slug).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Slug already in use")
    if db.query(User).filter(User.email == payload.commander_email).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already in use")

    tenant = Tenant(name=payload.name, slug=payload.slug)
    db.add(tenant)
    db.flush()

    commander = User(
        tenant_id=tenant.id,
        email=payload.commander_email,
        hashed_password=hash_password(payload.commander_password),
        role="commander",
    )
    db.add(commander)
    db.commit()
    db.refresh(tenant)
    return tenant


def _get_roster_sydekyk(db: Session, sydekyk_id: uuid.UUID) -> Sydekyk:
    sydekyk = db.query(Sydekyk).filter(Sydekyk.id == sydekyk_id, Sydekyk.tenant_id.is_(None)).first()
    if sydekyk is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Roster Sydekyk not found")
    return sydekyk


@router.get("/sydekyks", response_model=list[SydekykAdminOut])
def list_roster_sydekyks(db: Session = Depends(get_db)):
    return (
        db.query(Sydekyk)
        .filter(Sydekyk.tenant_id.is_(None))
        .order_by(Sydekyk.created_at.desc())
        .all()
    )


@router.post("/sydekyks/{sydekyk_id}/publish", response_model=SydekykAdminOut)
def publish_sydekyk(sydekyk_id: uuid.UUID, db: Session = Depends(get_db)):
    sydekyk = _get_roster_sydekyk(db, sydekyk_id)
    sydekyk.is_published = True
    db.commit()
    db.refresh(sydekyk)
    return sydekyk


@router.delete("/sydekyks/{sydekyk_id}/publish", response_model=SydekykAdminOut)
def unpublish_sydekyk(sydekyk_id: uuid.UUID, db: Session = Depends(get_db)):
    sydekyk = _get_roster_sydekyk(db, sydekyk_id)
    sydekyk.is_published = False
    db.commit()
    db.refresh(sydekyk)
    return sydekyk
