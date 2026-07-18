import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.crypto import decrypt_secret, encrypt_secret
from app.core.deps import require_commander, require_tenant_member
from app.db.session import get_db
from app.models.llm_provider import SydekykHostedAssignment, TenantProviderCredential, TenantSydekykLLMConfig
from app.models.sydekyk import Sydekyk
from app.models.tenant import Tenant
from app.models.user import User
from app.schemas.provider_credential import ModelListResult, ProviderCredentialOut, ProviderCredentialUpdate
from app.schemas.sydekyk_llm_config import (
    SydekykLLMConfigOut,
    SydekykLLMConfigTestResult,
    SydekykLLMConfigUpdate,
    SydekykUsageOut,
    TenantUsageBreakdownItem,
)
from app.services import llm_provisioning, permissions, provider_catalog
from app.services.litellm_admin import test_completion
from app.services.usage import get_sydekyk_config_usage, get_tenant_usage_breakdown

router = APIRouter(prefix="/api/tenant", tags=["llm-settings"], dependencies=[Depends(require_tenant_member)])

_BYOK_PROVIDERS = ("openai", "anthropic", "ollama_cloud")


# ---------------------------------------------------------------------------
# Provider credentials (tenant's own BYOK connections)
# ---------------------------------------------------------------------------


def _to_credential_out(cred: TenantProviderCredential | None, provider: str) -> ProviderCredentialOut:
    if cred is None:
        return ProviderCredentialOut(provider=provider, has_api_key=False, api_base=None, updated_at=None)
    return ProviderCredentialOut(provider=provider, has_api_key=True, api_base=cred.api_base, updated_at=cred.updated_at)


@router.get("/provider-credentials", response_model=list[ProviderCredentialOut])
def list_provider_credentials(user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    existing = {
        c.provider: c
        for c in db.query(TenantProviderCredential).filter(TenantProviderCredential.tenant_id == user.tenant_id).all()
    }
    return [_to_credential_out(existing.get(p), p) for p in _BYOK_PROVIDERS]


@router.put("/provider-credentials/{provider}", response_model=ProviderCredentialOut)
def update_provider_credential(
    provider: str,
    payload: ProviderCredentialUpdate,
    user: User = Depends(require_commander),
    db: Session = Depends(get_db),
):
    if provider not in _BYOK_PROVIDERS:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown provider")

    cred = (
        db.query(TenantProviderCredential)
        .filter(TenantProviderCredential.tenant_id == user.tenant_id, TenantProviderCredential.provider == provider)
        .first()
    )
    if cred is None:
        cred = TenantProviderCredential(tenant_id=user.tenant_id, provider=provider, encrypted_api_key="")
        db.add(cred)

    cred.encrypted_api_key = encrypt_secret(payload.api_key)
    cred.api_base = payload.api_base
    db.commit()
    db.refresh(cred)
    return _to_credential_out(cred, provider)


@router.delete("/provider-credentials/{provider}", status_code=status.HTTP_204_NO_CONTENT)
def delete_provider_credential(provider: str, user: User = Depends(require_commander), db: Session = Depends(get_db)):
    db.query(TenantProviderCredential).filter(
        TenantProviderCredential.tenant_id == user.tenant_id, TenantProviderCredential.provider == provider
    ).delete()
    db.commit()


@router.post("/llm-models/openai", response_model=ModelListResult)
def list_openai_models(user: User = Depends(require_commander), db: Session = Depends(get_db)):
    cred = (
        db.query(TenantProviderCredential)
        .filter(TenantProviderCredential.tenant_id == user.tenant_id, TenantProviderCredential.provider == "openai")
        .first()
    )
    if cred is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Connect an OpenAI credential in Settings first")
    ok, message, models = provider_catalog.fetch_openai_models(decrypt_secret(cred.encrypted_api_key))
    return ModelListResult(ok=ok, message=message, models=models)


@router.post("/llm-models/anthropic", response_model=ModelListResult)
def list_anthropic_models(user: User = Depends(require_commander)):
    return ModelListResult(ok=True, message="ok", models=provider_catalog.anthropic_static_models())


# ---------------------------------------------------------------------------
# Per-Sydekyk engine configuration
# ---------------------------------------------------------------------------


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


def _to_config_out(sydekyk_id: uuid.UUID, config: TenantSydekykLLMConfig | None) -> SydekykLLMConfigOut:
    if config is None:
        return SydekykLLMConfigOut(
            sydekyk_id=sydekyk_id, provider="power_core", model=None, status="untested", last_tested_at=None, last_test_error=None
        )
    return SydekykLLMConfigOut(
        sydekyk_id=sydekyk_id,
        provider=config.provider,
        model=config.model,
        status=config.status,
        last_tested_at=config.last_tested_at,
        last_test_error=config.last_test_error,
    )


def _get_or_create_config(db: Session, tenant_id: uuid.UUID, sydekyk_id: uuid.UUID) -> TenantSydekykLLMConfig:
    config = (
        db.query(TenantSydekykLLMConfig)
        .filter(TenantSydekykLLMConfig.tenant_id == tenant_id, TenantSydekykLLMConfig.sydekyk_id == sydekyk_id)
        .first()
    )
    if config is None:
        config = TenantSydekykLLMConfig(tenant_id=tenant_id, sydekyk_id=sydekyk_id, provider="power_core")
        db.add(config)
        db.flush()
    return config


@router.get("/sydekyks/{sydekyk_id}/llm-config", response_model=SydekykLLMConfigOut)
def get_sydekyk_llm_config(sydekyk_id: uuid.UUID, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    permissions.assert_can_configure(db, user, sydekyk_id)
    _get_visible_sydekyk(db, user.tenant_id, sydekyk_id)
    config = (
        db.query(TenantSydekykLLMConfig)
        .filter(TenantSydekykLLMConfig.tenant_id == user.tenant_id, TenantSydekykLLMConfig.sydekyk_id == sydekyk_id)
        .first()
    )
    return _to_config_out(sydekyk_id, config)


@router.put("/sydekyks/{sydekyk_id}/llm-config", response_model=SydekykLLMConfigOut)
def update_sydekyk_llm_config(
    sydekyk_id: uuid.UUID,
    payload: SydekykLLMConfigUpdate,
    user: User = Depends(require_tenant_member),
    db: Session = Depends(get_db),
):
    permissions.assert_can_configure(db, user, sydekyk_id)
    tenant = db.get(Tenant, user.tenant_id)
    if tenant is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found")

    sydekyk = _get_visible_sydekyk(db, user.tenant_id, sydekyk_id)
    config = _get_or_create_config(db, user.tenant_id, sydekyk_id)
    previous_provider = config.provider

    if previous_provider != payload.provider:
        llm_provisioning.revoke_tenant_config(config)

    if payload.provider == "power_core":
        assignment = db.query(SydekykHostedAssignment).filter(SydekykHostedAssignment.sydekyk_id == sydekyk_id).first()
        config.provider = "power_core"
        config.model = None

        if assignment is None or not assignment.litellm_model_alias:
            config.status = "error"
            config.last_test_error = "Sydekyks hasn't configured this Sydekyk's Power Core engine yet."
            db.commit()
            db.refresh(config)
            return _to_config_out(sydekyk_id, config)

        ok, message = llm_provisioning.provision_power_core(config, assignment)
        config.status = "untested" if ok else "error"
        config.last_tested_at = None
        config.last_test_error = None if ok else message
        db.commit()
        db.refresh(config)
        if not ok:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=message)
        return _to_config_out(sydekyk_id, config)

    # BYOK providers
    if not payload.model:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A model is required for this provider")

    cred = (
        db.query(TenantProviderCredential)
        .filter(TenantProviderCredential.tenant_id == user.tenant_id, TenantProviderCredential.provider == payload.provider)
        .first()
    )
    if cred is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Connect a {payload.provider} credential in Settings first",
        )

    alias = f"tenant-{tenant.slug}-{sydekyk.slug}-{payload.provider}"
    ok, message = llm_provisioning.provision_byok(
        config,
        alias=alias,
        provider=payload.provider,
        model=payload.model,
        api_key=decrypt_secret(cred.encrypted_api_key),
        api_base=cred.api_base,
    )

    config.provider = payload.provider
    config.model = payload.model
    config.status = "untested" if ok else "error"
    config.last_tested_at = None
    config.last_test_error = None if ok else message
    db.commit()
    db.refresh(config)

    if not ok:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=message)
    return _to_config_out(sydekyk_id, config)


@router.post("/sydekyks/{sydekyk_id}/llm-config/test", response_model=SydekykLLMConfigTestResult)
def test_sydekyk_llm_config(sydekyk_id: uuid.UUID, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    permissions.assert_can_configure(db, user, sydekyk_id)
    config = (
        db.query(TenantSydekykLLMConfig)
        .filter(TenantSydekykLLMConfig.tenant_id == user.tenant_id, TenantSydekykLLMConfig.sydekyk_id == sydekyk_id)
        .first()
    )
    if config is None or not config.litellm_virtual_key_encrypted or not config.litellm_model_alias:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No active configuration to test yet")

    virtual_key = decrypt_secret(config.litellm_virtual_key_encrypted)
    ok, message = test_completion(virtual_key, config.litellm_model_alias)

    config.status = "connected" if ok else "error"
    config.last_tested_at = datetime.now(timezone.utc)
    config.last_test_error = None if ok else message
    db.commit()
    db.refresh(config)

    return SydekykLLMConfigTestResult(ok=ok, message=message, config=_to_config_out(sydekyk_id, config))


@router.get("/sydekyks/{sydekyk_id}/usage", response_model=SydekykUsageOut)
def get_sydekyk_usage(sydekyk_id: uuid.UUID, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    result = get_sydekyk_config_usage(db, user.tenant_id, sydekyk_id)
    if result is None:
        return SydekykUsageOut(spend_used=0.0, stale=False)
    spend, stale = result
    return SydekykUsageOut(spend_used=spend, stale=stale)


@router.get("/usage", response_model=list[TenantUsageBreakdownItem])
def get_usage_breakdown(user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    tenant = db.get(Tenant, user.tenant_id)
    return [TenantUsageBreakdownItem(**item) for item in get_tenant_usage_breakdown(db, tenant)]
