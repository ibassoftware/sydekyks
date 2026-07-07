"""Billing-grade usage events (VS-15).

`record_usage` appends one attribution row per hosted-AI call, keyed by the LiteLLM request id so a
retried call never double-counts. `reconcile_tenant` compares our summed cost to LiteLLM's
authoritative spend and reports the delta — LiteLLM wins on money; our rows are for attribution.
"""

import uuid

from sqlalchemy.orm import Session

from app.models.usage_record import UsageRecord


def record_usage(
    db: Session,
    *,
    tenant_id: uuid.UUID,
    sydekyk_id: uuid.UUID | None,
    mission_id: uuid.UUID | None,
    provider: str,
    model: str | None,
    usage: dict | None,
    litellm_request_id: str | None,
    cost_usd: float = 0.0,
) -> UsageRecord | None:
    """Idempotent on litellm_request_id. Returns the row, or None if a duplicate was skipped."""
    if litellm_request_id:
        existing = (
            db.query(UsageRecord).filter(UsageRecord.litellm_request_id == litellm_request_id).first()
        )
        if existing is not None:
            return None

    usage = usage or {}
    prompt_tokens = int(usage.get("prompt_tokens") or 0)
    completion_tokens = int(usage.get("completion_tokens") or 0)
    # Freeze the GPU-second estimate now, from the then-current rate config + model multiplier.
    from app.services import metering

    estimated_gpu_seconds = metering.estimate_gpu_seconds(db, model, prompt_tokens, completion_tokens)
    record = UsageRecord(
        tenant_id=tenant_id,
        sydekyk_id=sydekyk_id,
        mission_id=mission_id,
        provider=provider,
        model=model,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        total_tokens=int(usage.get("total_tokens") or 0),
        cost_usd=cost_usd,
        estimated_gpu_seconds=estimated_gpu_seconds,
        litellm_request_id=litellm_request_id,
    )
    db.add(record)
    db.commit()
    return record


def tenant_usage_total(db: Session, tenant_id: uuid.UUID) -> dict:
    from sqlalchemy import func

    row = (
        db.query(
            func.coalesce(func.sum(UsageRecord.total_tokens), 0),
            func.coalesce(func.sum(UsageRecord.cost_usd), 0.0),
            func.count(UsageRecord.id),
        )
        .filter(UsageRecord.tenant_id == tenant_id)
        .first()
    )
    return {"total_tokens": int(row[0]), "cost_usd": float(row[1]), "events": int(row[2])}


def reconcile_tenant(db: Session, tenant_id: uuid.UUID, litellm_spend: float, tolerance: float = 0.01) -> dict:
    """Compare our attributed cost to LiteLLM's authoritative spend for a tenant."""
    ours = tenant_usage_total(db, tenant_id)["cost_usd"]
    delta = round(litellm_spend - ours, 6)
    return {"our_cost": ours, "litellm_spend": litellm_spend, "delta": delta, "in_sync": abs(delta) <= tolerance}
