import uuid
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.core.crypto import decrypt_secret
from app.models.llm_provider import TenantSydekykLLMConfig, TenantSydekykUsageSnapshot
from app.models.sydekyk import Sydekyk
from app.models.tenant import Tenant
from app.services import litellm_admin


def _refresh_snapshot(db: Session, tenant_id: uuid.UUID, sydekyk_id: uuid.UUID, virtual_key_encrypted: str) -> tuple[float, bool]:
    virtual_key = decrypt_secret(virtual_key_encrypted)
    ok, message, data = litellm_admin.get_key_spend(virtual_key)

    snapshot = (
        db.query(TenantSydekykUsageSnapshot)
        .filter(TenantSydekykUsageSnapshot.tenant_id == tenant_id, TenantSydekykUsageSnapshot.sydekyk_id == sydekyk_id)
        .first()
    )

    if ok and data is not None:
        # /key/info responds as {"key": ..., "info": {"spend": ..., ...}}
        spend = float((data.get("info") or {}).get("spend") or 0.0)
        if snapshot is None:
            snapshot = TenantSydekykUsageSnapshot(tenant_id=tenant_id, sydekyk_id=sydekyk_id, spend_used=spend)
            db.add(snapshot)
        else:
            snapshot.spend_used = spend
            snapshot.refresh_error = None
        snapshot.last_refreshed_at = datetime.now(timezone.utc)
        db.commit()
        return spend, False

    if snapshot is not None:
        snapshot.refresh_error = message
        db.commit()
        return snapshot.spend_used, True

    return 0.0, True


def _power_core_configs(db: Session, tenant_id: uuid.UUID) -> list[TenantSydekykLLMConfig]:
    return (
        db.query(TenantSydekykLLMConfig)
        .filter(
            TenantSydekykLLMConfig.tenant_id == tenant_id,
            TenantSydekykLLMConfig.provider == "power_core",
            TenantSydekykLLMConfig.litellm_virtual_key_encrypted.isnot(None),
        )
        .all()
    )


def get_tenant_dashboard_usage(db: Session, tenant: Tenant) -> tuple[float, bool]:
    """Aggregate Power Core spend across every Sydekyk this tenant runs on the hosted tier.
    BYOK usage isn't tracked (per product decision — only Sydekyk-as-provider is metered)."""
    total = 0.0
    any_stale = False
    for config in _power_core_configs(db, tenant.id):
        spend, stale = _refresh_snapshot(db, tenant.id, config.sydekyk_id, config.litellm_virtual_key_encrypted)
        total += spend
        any_stale = any_stale or stale
    return total, any_stale


def get_tenant_usage_breakdown(db: Session, tenant: Tenant) -> list[dict]:
    results = []
    for config in _power_core_configs(db, tenant.id):
        sydekyk = db.get(Sydekyk, config.sydekyk_id)
        spend, stale = _refresh_snapshot(db, tenant.id, config.sydekyk_id, config.litellm_virtual_key_encrypted)
        results.append(
            {
                "sydekyk_id": config.sydekyk_id,
                "sydekyk_name": sydekyk.name if sydekyk else "Unknown",
                "spend_used": spend,
                "stale": stale,
            }
        )
    return results


def get_sydekyk_config_usage(db: Session, tenant_id: uuid.UUID, sydekyk_id: uuid.UUID) -> tuple[float, bool] | None:
    config = (
        db.query(TenantSydekykLLMConfig)
        .filter(TenantSydekykLLMConfig.tenant_id == tenant_id, TenantSydekykLLMConfig.sydekyk_id == sydekyk_id)
        .first()
    )
    if config is None or not config.litellm_virtual_key_encrypted:
        return None
    return _refresh_snapshot(db, tenant_id, sydekyk_id, config.litellm_virtual_key_encrypted)


def get_sydekyk_total_usage(db: Session, sydekyk_id: uuid.UUID) -> tuple[float, bool]:
    """Admin-facing: aggregate Power Core spend across every tenant running this Sydekyk."""
    configs = (
        db.query(TenantSydekykLLMConfig)
        .filter(
            TenantSydekykLLMConfig.sydekyk_id == sydekyk_id,
            TenantSydekykLLMConfig.provider == "power_core",
            TenantSydekykLLMConfig.litellm_virtual_key_encrypted.isnot(None),
        )
        .all()
    )
    total = 0.0
    any_stale = False
    for config in configs:
        spend, stale = _refresh_snapshot(db, config.tenant_id, sydekyk_id, config.litellm_virtual_key_encrypted)
        total += spend
        any_stale = any_stale or stale
    return total, any_stale
