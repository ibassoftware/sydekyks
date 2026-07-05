import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.crypto import decrypt_secret, encrypt_secret
from app.core.deps import require_super_admin
from app.core.security import hash_password
from app.db.session import get_db
from app.models.llm_provider import CentralProviderKey, SydekykHostedAssignment
from app.models.sydekyk import Sydekyk
from app.models.tenant import Tenant
from app.models.user import User
from app.schemas.hosted_assignment import HostedAssignmentOut, HostedAssignmentUpdate
from app.schemas.provider_key import ProviderKeyOut, ProviderKeyUpdate
from app.schemas.sydekyk import SydekykAdminOut, SydekykModelUpdate
from app.schemas.sydekyk_llm_config import SydekykUsageOut
from app.schemas.tenant import TenantCreate, TenantOut
from app.services import llm_provisioning
from app.services.usage import get_sydekyk_total_usage

router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(require_super_admin)])

_PROVIDERS = ("openai", "anthropic", "ollama_cloud")


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


@router.patch("/sydekyks/{sydekyk_id}/model", response_model=SydekykAdminOut)
def update_recommended_model(sydekyk_id: uuid.UUID, payload: SydekykModelUpdate, db: Session = Depends(get_db)):
    sydekyk = _get_roster_sydekyk(db, sydekyk_id)
    sydekyk.model = payload.model
    db.commit()
    db.refresh(sydekyk)
    return sydekyk


def _to_provider_key_out(key: CentralProviderKey) -> ProviderKeyOut:
    return ProviderKeyOut(
        provider=key.provider,
        has_api_key=bool(key.encrypted_api_key),
        api_base=key.api_base,
        updated_at=key.updated_at,
    )


@router.get("/provider-keys", response_model=list[ProviderKeyOut])
def list_provider_keys(db: Session = Depends(get_db)):
    existing = {k.provider: k for k in db.query(CentralProviderKey).all()}
    return [
        _to_provider_key_out(existing[p])
        if p in existing
        else ProviderKeyOut(provider=p, has_api_key=False, api_base=None, updated_at=None)
        for p in _PROVIDERS
    ]


def _get_or_create_provider_key(db: Session, provider: str) -> CentralProviderKey:
    if provider not in _PROVIDERS:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown provider")
    key = db.query(CentralProviderKey).filter(CentralProviderKey.provider == provider).first()
    if key is None:
        key = CentralProviderKey(provider=provider)
        db.add(key)
        db.flush()
    return key


@router.put("/provider-keys/{provider}", response_model=ProviderKeyOut)
def update_provider_key(provider: str, payload: ProviderKeyUpdate, db: Session = Depends(get_db)):
    key = _get_or_create_provider_key(db, provider)
    key.encrypted_api_key = encrypt_secret(payload.api_key)
    key.api_base = payload.api_base
    db.commit()
    db.refresh(key)
    return _to_provider_key_out(key)


@router.delete("/provider-keys/{provider}", response_model=ProviderKeyOut)
def clear_provider_key(provider: str, db: Session = Depends(get_db)):
    key = _get_or_create_provider_key(db, provider)
    key.encrypted_api_key = None
    key.api_base = None
    db.commit()
    db.refresh(key)
    return _to_provider_key_out(key)


# ---------------------------------------------------------------------------
# Per-Sydekyk Power Core assignment (the real provider/model behind "Power Core",
# shared across every tenant that picks it for this Sydekyk)
# ---------------------------------------------------------------------------


@router.get("/sydekyks/{sydekyk_id}/hosted-assignment", response_model=HostedAssignmentOut)
def get_hosted_assignment(sydekyk_id: uuid.UUID, db: Session = Depends(get_db)):
    _get_roster_sydekyk(db, sydekyk_id)
    assignment = db.query(SydekykHostedAssignment).filter(SydekykHostedAssignment.sydekyk_id == sydekyk_id).first()
    if assignment is None:
        return HostedAssignmentOut(sydekyk_id=sydekyk_id, hosted_provider=None, hosted_model=None)
    return HostedAssignmentOut(
        sydekyk_id=sydekyk_id, hosted_provider=assignment.hosted_provider, hosted_model=assignment.hosted_model
    )


@router.put("/sydekyks/{sydekyk_id}/hosted-assignment", response_model=HostedAssignmentOut)
def update_hosted_assignment(sydekyk_id: uuid.UUID, payload: HostedAssignmentUpdate, db: Session = Depends(get_db)):
    sydekyk = _get_roster_sydekyk(db, sydekyk_id)

    central = db.query(CentralProviderKey).filter(CentralProviderKey.provider == payload.hosted_provider).first()
    if central is None or not central.encrypted_api_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"No central API key configured for {payload.hosted_provider} yet",
        )

    assignment = db.query(SydekykHostedAssignment).filter(SydekykHostedAssignment.sydekyk_id == sydekyk_id).first()
    if assignment is None:
        assignment = SydekykHostedAssignment(sydekyk_id=sydekyk_id, hosted_provider=payload.hosted_provider, hosted_model=payload.hosted_model)
        db.add(assignment)
        db.flush()
    else:
        assignment.hosted_provider = payload.hosted_provider
        assignment.hosted_model = payload.hosted_model

    ok, message = llm_provisioning.ensure_hosted_assignment_model(
        assignment,
        alias=f"sydekyk-{sydekyk.slug}-core",
        api_key=decrypt_secret(central.encrypted_api_key),
        api_base=central.api_base,
    )
    if not ok:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=message)

    db.commit()
    db.refresh(assignment)
    return HostedAssignmentOut(
        sydekyk_id=sydekyk_id, hosted_provider=assignment.hosted_provider, hosted_model=assignment.hosted_model
    )


@router.get("/sydekyks/{sydekyk_id}/usage", response_model=SydekykUsageOut)
def get_sydekyk_usage(sydekyk_id: uuid.UUID, db: Session = Depends(get_db)):
    _get_roster_sydekyk(db, sydekyk_id)
    spend, stale = get_sydekyk_total_usage(db, sydekyk_id)
    return SydekykUsageOut(spend_used=spend, stale=stale)
