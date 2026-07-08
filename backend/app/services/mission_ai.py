"""Shared AI plumbing for Sydekyk playbooks: resolve the tenant's assigned engine for a Mission and
attribute usage. Extracted so Decode/Scout (and eventually Ledger) don't each re-implement it.
"""

from app.core.crypto import decrypt_secret
from app.models.llm_provider import SydekykHostedAssignment, TenantSydekykLLMConfig


def get_llm(db, mission):
    """Return (config, virtual_key, model_alias) for this Mission's Sydekyk, or (None, None, None)
    when no usable engine is configured."""
    llm = (
        db.query(TenantSydekykLLMConfig)
        .filter(
            TenantSydekykLLMConfig.tenant_id == mission.tenant_id,
            TenantSydekykLLMConfig.sydekyk_id == mission.sydekyk_id,
        )
        .first()
    )
    if llm is None or not llm.litellm_virtual_key_encrypted or not llm.litellm_model_alias:
        return None, None, None
    return llm, decrypt_secret(llm.litellm_virtual_key_encrypted), llm.litellm_model_alias


def real_model(db, mission, llm) -> str | None:
    """The underlying model (not the LiteLLM alias) for usage attribution + per-model GPU rates."""
    if llm.provider != "power_core":
        return llm.model or llm.litellm_model_alias
    assignment = (
        db.query(SydekykHostedAssignment)
        .filter(SydekykHostedAssignment.sydekyk_id == mission.sydekyk_id)
        .first()
    )
    return assignment.hosted_model if assignment and assignment.hosted_model else llm.litellm_model_alias


def emit_usage(db, mission, llm, meta: dict) -> None:
    """Best-effort usage attribution for one AI call — never fails the Mission."""
    try:
        from app.services import usage_events

        usage_events.record_usage(
            db,
            tenant_id=mission.tenant_id,
            sydekyk_id=mission.sydekyk_id,
            mission_id=mission.id,
            provider=llm.provider,
            model=real_model(db, mission, llm),
            usage=meta.get("usage"),
            litellm_request_id=meta.get("request_id"),
            cost_usd=float(meta.get("cost_usd") or 0.0),
        )
    except Exception:  # noqa: BLE001 — usage logging is non-critical
        db.rollback()
