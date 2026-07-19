import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, field_validator
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.deps import require_commander, require_tenant_member
from app.db.session import get_db
from app.models.sydekyk import Sydekyk, SydekykInstall
from app.models.tenant import Tenant
from app.models.user import User
from app.models.metering import PlanTier
from app.schemas.dashboard import DashboardOut
from app.schemas.sydekyk import SydekykOut
from app.services import llm_provisioning, metering, permissions

router = APIRouter(prefix="/api/tenant", tags=["tenant"], dependencies=[Depends(require_tenant_member)])

# A curated set of ISO-4217 codes offered in the currency picker (formatting works for any valid ISO
# code; this just bounds the UI to common ones).
SUPPORTED_CURRENCIES = ["USD", "EUR", "GBP", "PHP", "AUD", "CAD", "SGD", "JPY", "INR", "AED", "CNY", "HKD"]


class TenantSettingsOut(BaseModel):
    currency: str
    supported_currencies: list[str]


class TenantSettingsUpdate(BaseModel):
    currency: str

    @field_validator("currency")
    @classmethod
    def _valid_currency(cls, v: str) -> str:
        v = (v or "").upper()
        if len(v) != 3 or not v.isalpha():
            raise ValueError("currency must be a 3-letter ISO 4217 code")
        return v


def _visible_sydekyks(db: Session, tenant_id: uuid.UUID) -> list[Sydekyk]:
    return (
        db.query(Sydekyk)
        .filter(
            Sydekyk.is_published.is_(True),
            or_(Sydekyk.tenant_id.is_(None), Sydekyk.tenant_id == tenant_id),
        )
        .order_by(Sydekyk.created_at.asc())
        .all()
    )


def _installed_ids(db: Session, tenant_id: uuid.UUID) -> set[uuid.UUID]:
    rows = db.query(SydekykInstall.sydekyk_id).filter(SydekykInstall.tenant_id == tenant_id).all()
    return {row[0] for row in rows}


def _to_out(sydekyk: Sydekyk, installed: bool, *, can_use: bool, can_configure: bool) -> SydekykOut:
    return SydekykOut(
        id=sydekyk.id,
        name=sydekyk.name,
        slug=sydekyk.slug,
        tagline=sydekyk.tagline,
        description=sydekyk.description,
        avatar_url=sydekyk.avatar_url,
        model=sydekyk.model,
        is_exclusive=sydekyk.is_exclusive,
        chat_enabled=sydekyk.chat_enabled,
        workflow_enabled=sydekyk.workflow_enabled,
        accepts_document_uploads=sydekyk.accepts_document_uploads,
        installed=installed,
        can_use=can_use,
        can_configure=can_configure,
        created_at=sydekyk.created_at,
    )


@router.get("/dashboard", response_model=DashboardOut)
def dashboard(user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    tenant = db.get(Tenant, user.tenant_id)
    if tenant is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found")

    installed_ids = _installed_ids(db, tenant.id)
    sydekyks = _visible_sydekyks(db, tenant.id)
    roster_count = sum(1 for s in sydekyks if not s.is_exclusive and s.id in installed_ids)
    exclusive_count = sum(1 for s in sydekyks if s.is_exclusive)

    usage = metering.tenant_usage_summary(db, tenant)
    tier = db.get(PlanTier, tenant.plan)

    return DashboardOut(
        tenant_id=tenant.id,
        tenant_name=tenant.name,
        tenant_slug=tenant.slug,
        plan=tenant.plan,
        plan_display_name=tier.display_name if tier else tenant.plan.title(),
        currency=tenant.currency or "USD",
        roster_sydekyk_count=roster_count,
        exclusive_sydekyk_count=exclusive_count,
        tokens_used_this_month=usage["tokens_used_this_month"],
        monthly_token_cap=usage["monthly_token_cap"],
        token_throttled=usage["token_throttled"],
        gpu_seconds_used_last_hour=usage["gpu_seconds_used_last_hour"],
        gpu_seconds_per_hour_cap=usage["gpu_seconds_per_hour_cap"],
        gpu_throttled=usage["gpu_throttled"],
    )


@router.get("/settings", response_model=TenantSettingsOut)
def get_tenant_settings(user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    tenant = db.get(Tenant, user.tenant_id)
    if tenant is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found")
    return TenantSettingsOut(currency=tenant.currency or "USD", supported_currencies=SUPPORTED_CURRENCIES)


@router.put("/settings", response_model=TenantSettingsOut)
def update_tenant_settings(
    payload: TenantSettingsUpdate, user: User = Depends(require_commander), db: Session = Depends(get_db)
):
    tenant = db.get(Tenant, user.tenant_id)
    if tenant is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found")
    tenant.currency = payload.currency
    db.commit()
    return TenantSettingsOut(currency=tenant.currency, supported_currencies=SUPPORTED_CURRENCIES)


@router.get("/sydekyks", response_model=list[SydekykOut])
def list_sydekyks(user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    installed_ids = _installed_ids(db, user.tenant_id)
    sydekyks = _visible_sydekyks(db, user.tenant_id)
    return [
        _to_out(
            s, installed=s.is_exclusive or s.id in installed_ids,
            can_use=permissions.can_use(db, user, s.id), can_configure=permissions.can_configure(db, user, s.id),
        )
        for s in sydekyks
    ]


def _get_visible_sydekyk(db: Session, tenant_id: uuid.UUID, sydekyk_id: uuid.UUID) -> Sydekyk:
    sydekyk = (
        db.query(Sydekyk)
        .filter(
            Sydekyk.id == sydekyk_id,
            Sydekyk.is_published.is_(True),
            or_(Sydekyk.tenant_id.is_(None), Sydekyk.tenant_id == tenant_id),
        )
        .first()
    )
    if sydekyk is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sydekyk not found")
    return sydekyk


@router.get("/sydekyks/{sydekyk_id}", response_model=SydekykOut)
def get_sydekyk(sydekyk_id: uuid.UUID, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    sydekyk = _get_visible_sydekyk(db, user.tenant_id, sydekyk_id)
    installed = sydekyk.id in _installed_ids(db, user.tenant_id)
    return _to_out(
        sydekyk, installed=sydekyk.is_exclusive or installed,
        can_use=permissions.can_use(db, user, sydekyk.id), can_configure=permissions.can_configure(db, user, sydekyk.id),
    )


@router.post("/sydekyks/{sydekyk_id}/install", response_model=SydekykOut, status_code=status.HTTP_201_CREATED)
def install_sydekyk(sydekyk_id: uuid.UUID, user: User = Depends(require_commander), db: Session = Depends(get_db)):
    sydekyk = _get_visible_sydekyk(db, user.tenant_id, sydekyk_id)
    if sydekyk.is_exclusive:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Exclusive Sydekyks are always active")

    existing = (
        db.query(SydekykInstall)
        .filter(SydekykInstall.tenant_id == user.tenant_id, SydekykInstall.sydekyk_id == sydekyk_id)
        .first()
    )
    if existing is None:
        db.add(SydekykInstall(tenant_id=user.tenant_id, sydekyk_id=sydekyk_id))
        db.flush()
        # Reduce setup: default the newly installed Sydekyk to Power Core when it's available, so
        # the tenant doesn't have to pick an engine manually before using it.
        llm_provisioning.default_to_power_core(db, user.tenant_id, sydekyk_id)
        db.commit()

    return _to_out(sydekyk, installed=True, can_use=True, can_configure=True)  # require_commander → full access


@router.delete("/sydekyks/{sydekyk_id}/install", response_model=SydekykOut)
def uninstall_sydekyk(sydekyk_id: uuid.UUID, user: User = Depends(require_commander), db: Session = Depends(get_db)):
    sydekyk = _get_visible_sydekyk(db, user.tenant_id, sydekyk_id)
    if sydekyk.is_exclusive:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Exclusive Sydekyks can't be uninstalled")

    db.query(SydekykInstall).filter(
        SydekykInstall.tenant_id == user.tenant_id, SydekykInstall.sydekyk_id == sydekyk_id
    ).delete()
    db.commit()

    return _to_out(sydekyk, installed=False, can_use=True, can_configure=True)  # require_commander → full access
