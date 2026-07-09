import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.crypto import decrypt_secret, encrypt_secret
from app.core.deps import require_super_admin
from app.core.security import hash_password
from app.db.session import get_db
from app.models.llm_provider import CentralProviderKey, SydekykHostedAssignment
from app.models.metering import ModelRateProfile, PlanTier
from app.models.mission import Mission, MissionDocument
from app.models.sydekyk import Sydekyk
from app.models.tenant import Tenant
from app.models.user import User
from app.schemas.hosted_assignment import HostedAssignmentOut, HostedAssignmentUpdate
from app.schemas.metering import (
    MeteringConfigOut,
    MeteringConfigUpdate,
    ModelRateOut,
    ModelRateUpsert,
    PlanTierOut,
    PlanTierUpdate,
    TenantPlanUpdate,
    TenantUsageLimitOut,
)
from app.schemas.mission import MissionDetailOut, MissionOut, MissionPage, MissionStepOut
from app.schemas.provider_key import ProviderKeyOut, ProviderKeyUpdate
from app.schemas.sydekyk import SydekykAdminOut, SydekykModelUpdate
from app.schemas.sydekyk_llm_config import SydekykUsageOut
from app.schemas.tenant import TenantCreate, TenantOut
from app.services import gadget_links, llm_provisioning, metering
from app.services.missions import apply_mission_filters
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


# ---------------------------------------------------------------------------
# GPU-second metering config + per-tenant plan caps (Command Center)
# ---------------------------------------------------------------------------


@router.get("/metering-config", response_model=MeteringConfigOut)
def get_metering_config(db: Session = Depends(get_db)):
    cfg = metering.get_config(db)
    return MeteringConfigOut(prompt_rate=cfg.prompt_rate, generation_rate=cfg.generation_rate)


@router.put("/metering-config", response_model=MeteringConfigOut)
def update_metering_config(payload: MeteringConfigUpdate, db: Session = Depends(get_db)):
    cfg = metering.get_config(db)
    cfg.prompt_rate = payload.prompt_rate
    cfg.generation_rate = payload.generation_rate
    db.commit()
    db.refresh(cfg)
    return MeteringConfigOut(prompt_rate=cfg.prompt_rate, generation_rate=cfg.generation_rate)


@router.get("/model-rates", response_model=list[ModelRateOut])
def list_model_rates(db: Session = Depends(get_db)):
    rows = db.query(ModelRateProfile).order_by(ModelRateProfile.model.asc()).all()
    return [ModelRateOut(model=r.model, multiplier=r.multiplier) for r in rows]


@router.put("/model-rates", response_model=ModelRateOut)
def upsert_model_rate(payload: ModelRateUpsert, db: Session = Depends(get_db)):
    """Set (create or update) a model's GPU multiplier, keyed by the model string."""
    row = db.query(ModelRateProfile).filter(ModelRateProfile.model == payload.model).first()
    if row is None:
        row = ModelRateProfile(model=payload.model, multiplier=payload.multiplier)
        db.add(row)
    else:
        row.multiplier = payload.multiplier
    db.commit()
    db.refresh(row)
    return ModelRateOut(model=row.model, multiplier=row.multiplier)


@router.delete("/model-rates/{model}", status_code=status.HTTP_204_NO_CONTENT)
def delete_model_rate(model: str, db: Session = Depends(get_db)):
    db.query(ModelRateProfile).filter(ModelRateProfile.model == model).delete()
    db.commit()


@router.get("/plan-tiers", response_model=list[PlanTierOut])
def list_plan_tiers(db: Session = Depends(get_db)):
    rows = db.query(PlanTier).order_by(PlanTier.sort_order.asc()).all()
    return [
        PlanTierOut(
            key=r.key, display_name=r.display_name, monthly_token_cap=r.monthly_token_cap,
            gpu_seconds_per_hour_cap=r.gpu_seconds_per_hour_cap, sort_order=r.sort_order,
        )
        for r in rows
    ]


@router.put("/plan-tiers/{key}", response_model=PlanTierOut)
def update_plan_tier(key: str, payload: PlanTierUpdate, db: Session = Depends(get_db)):
    tier = db.get(PlanTier, key)
    if tier is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown plan tier")
    tier.display_name = payload.display_name
    tier.monthly_token_cap = payload.monthly_token_cap
    tier.gpu_seconds_per_hour_cap = payload.gpu_seconds_per_hour_cap
    db.commit()
    db.refresh(tier)
    return PlanTierOut(
        key=tier.key, display_name=tier.display_name, monthly_token_cap=tier.monthly_token_cap,
        gpu_seconds_per_hour_cap=tier.gpu_seconds_per_hour_cap, sort_order=tier.sort_order,
    )


def _tenant_usage_out(db: Session, tenant: Tenant, plan_names: dict[str, str]) -> TenantUsageLimitOut:
    summary = metering.tenant_usage_summary(db, tenant)
    return TenantUsageLimitOut(
        tenant_id=tenant.id, tenant_name=tenant.name, plan=tenant.plan,
        plan_display_name=plan_names.get(tenant.plan, tenant.plan.title()),
        monthly_token_cap=summary["monthly_token_cap"],
        tokens_used_this_month=summary["tokens_used_this_month"],
        token_throttled=summary["token_throttled"],
        gpu_seconds_per_hour_cap=summary["gpu_seconds_per_hour_cap"],
        gpu_seconds_used_last_hour=summary["gpu_seconds_used_last_hour"],
        gpu_throttled=summary["gpu_throttled"],
        monthly_token_cap_override=tenant.monthly_token_cap_override,
        gpu_seconds_per_hour_cap_override=tenant.gpu_seconds_per_hour_cap_override,
    )


@router.get("/tenant-usage", response_model=list[TenantUsageLimitOut])
def list_tenant_usage(db: Session = Depends(get_db)):
    """Per-tenant token (month) + GPU-second (hour) usage vs caps, for the Command Center table."""
    plan_names = {t.key: t.display_name for t in db.query(PlanTier).all()}
    tenants = db.query(Tenant).order_by(Tenant.created_at.desc()).all()
    return [_tenant_usage_out(db, t, plan_names) for t in tenants]


@router.put("/tenants/{tenant_id}/plan", response_model=TenantUsageLimitOut)
def update_tenant_plan(tenant_id: uuid.UUID, payload: TenantPlanUpdate, db: Session = Depends(get_db)):
    tenant = db.get(Tenant, tenant_id)
    if tenant is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found")
    if db.get(PlanTier, payload.plan) is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown plan tier")
    tenant.plan = payload.plan
    tenant.monthly_token_cap_override = payload.monthly_token_cap_override
    tenant.gpu_seconds_per_hour_cap_override = payload.gpu_seconds_per_hour_cap_override
    db.commit()
    db.refresh(tenant)
    plan_names = {t.key: t.display_name for t in db.query(PlanTier).all()}
    return _tenant_usage_out(db, tenant, plan_names)


# ---------------------------------------------------------------------------
# Command Center: Missions across ALL tenants (raw/unsanitized — admin-only debugging view).
# Tenant-facing routers/missions.py sanitizes error_message; this one intentionally does not.
# ---------------------------------------------------------------------------


def _admin_mission_out(m: Mission, *, filename, source, sydekyk_name, tenant_name) -> MissionOut:
    return MissionOut(
        id=m.id, sydekyk_id=m.sydekyk_id, sydekyk_name=sydekyk_name, tenant_name=tenant_name,
        playbook_key=m.playbook_key, signal_type=m.signal_type, source=source, status=m.status,
        failure_category=m.failure_category, result_summary=m.result_summary,
        error_message=m.error_message,  # raw — no friendly_message() sanitization here
        document_filename=filename, parent_mission_id=m.parent_mission_id,
        root_mission_id=m.root_mission_id, attempt_number=m.attempt_number,
        created_at=m.created_at, completed_at=m.completed_at,
    )


@router.get("/missions", response_model=MissionPage)
def list_all_tenant_missions(
    tenant_id: uuid.UUID | None = None,
    sydekyk_id: uuid.UUID | None = None,
    status_: str | None = Query(default=None, alias="status"),
    signal_type: str | None = None,
    source: str | None = None,
    filename: str | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    limit: int = 25,
    offset: int = 0,
    db: Session = Depends(get_db),
):
    """Every Mission across every tenant — the Command Center operations feed."""
    limit = max(1, min(limit, 100))
    base = (
        db.query(Mission, MissionDocument.filename, MissionDocument.source, Sydekyk.name, Tenant.name)
        .outerjoin(MissionDocument, MissionDocument.mission_id == Mission.id)
        .outerjoin(Sydekyk, Sydekyk.id == Mission.sydekyk_id)
        .outerjoin(Tenant, Tenant.id == Mission.tenant_id)
    )
    base = apply_mission_filters(
        base, tenant_id=tenant_id, sydekyk_id=sydekyk_id, status=status_, signal_type=signal_type,
        source=source, filename=filename, date_from=date_from, date_to=date_to,
    )

    count_q = (
        db.query(func.count(Mission.id)).outerjoin(MissionDocument, MissionDocument.mission_id == Mission.id)
    )
    count_q = apply_mission_filters(
        count_q, tenant_id=tenant_id, sydekyk_id=sydekyk_id, status=status_, signal_type=signal_type,
        source=source, filename=filename, date_from=date_from, date_to=date_to,
    )
    total = count_q.scalar() or 0

    rows = base.order_by(Mission.created_at.desc()).limit(limit).offset(offset).all()
    items = [
        _admin_mission_out(m, filename=fn, source=src, sydekyk_name=syd_name, tenant_name=ten_name)
        for m, fn, src, syd_name, ten_name in rows
    ]
    return MissionPage(items=items, total=total, limit=limit, offset=offset)


@router.get("/missions/{mission_id}", response_model=MissionDetailOut)
def get_any_mission(mission_id: uuid.UUID, db: Session = Depends(get_db)):
    """Full, RAW Mission detail (any tenant) — including unsanitized step errors/stack traces."""
    mission = db.get(Mission, mission_id)
    if mission is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Mission not found")

    sydekyk = db.get(Sydekyk, mission.sydekyk_id)
    tenant = db.get(Tenant, mission.tenant_id)
    doc = (
        db.query(MissionDocument.filename, MissionDocument.source)
        .filter(MissionDocument.mission_id == mission.id)
        .first()
    )
    base = _admin_mission_out(
        mission, filename=doc[0] if doc else None, source=doc[1] if doc else None,
        sydekyk_name=sydekyk.name if sydekyk else None, tenant_name=tenant.name if tenant else None,
    )
    move_id = (mission.result_summary or {}).get("odoo_move_id")
    if move_id:
        base.odoo_bill_url = gadget_links.build_odoo_bill_url(
            db, tenant_id=mission.tenant_id, sydekyk_id=mission.sydekyk_id, move_id=move_id
        )
    base.odoo_record_url, base.odoo_record_label = gadget_links.build_mission_record_link(
        db, tenant_id=mission.tenant_id, sydekyk_id=mission.sydekyk_id, summary=mission.result_summary
    )
    steps = [MissionStepOut.model_validate(s, from_attributes=True) for s in mission.steps]
    return MissionDetailOut(**base.model_dump(), steps=steps)
