from sqlalchemy.orm import Session

from app.core.crypto import decrypt_secret, encrypt_secret
from app.models.llm_provider import SydekykHostedAssignment, TenantSydekykLLMConfig
from app.models.sydekyk import Sydekyk
from app.models.tenant import Tenant
from app.services import litellm_admin


def litellm_model_string(provider: str, model: str) -> str:
    if provider == "openai":
        return f"openai/{model}"
    if provider == "anthropic":
        return f"anthropic/{model}"
    if provider == "ollama_cloud":
        # Verified against a live Ollama Cloud account (2026-07-05): the hosted API is
        # OpenAI-compatible at https://ollama.com/v1, so it must be driven through LiteLLM's
        # `openai/` provider with that api_base — NOT the `ollama/` prefix (which targets a local
        # Ollama daemon). The api_base is supplied by the tenant credential / hosted assignment.
        return f"openai/{model}"
    raise ValueError(f"Unknown provider: {provider}")


def _ensure_model(
    existing_model_id: str | None, alias: str, provider: str, model: str, api_key: str | None, api_base: str | None
) -> tuple[bool, str, str | None]:
    litellm_model = litellm_model_string(provider, model)
    if existing_model_id:
        ok, message, data = litellm_admin.update_model(existing_model_id, alias, litellm_model, api_key, api_base)
    else:
        ok, message, data = litellm_admin.register_model(alias, litellm_model, api_key, api_base)
    if not ok:
        return False, message, None
    model_id = (data or {}).get("model_info", {}).get("id") or existing_model_id
    return True, "ok", model_id


def _ensure_virtual_key(
    existing_key_encrypted: str | None, alias: str, max_budget: float | None, metadata: dict
) -> tuple[bool, str, str | None]:
    if existing_key_encrypted:
        ok, message, _ = litellm_admin.update_virtual_key(
            decrypt_secret(existing_key_encrypted), models=[alias], max_budget=max_budget
        )
        return ok, message, existing_key_encrypted if ok else None
    ok, message, key = litellm_admin.generate_virtual_key([alias], max_budget=max_budget, metadata=metadata)
    if not ok or not key:
        return False, message, None
    return True, "ok", encrypt_secret(key)


def revoke_tenant_config(config: TenantSydekykLLMConfig) -> None:
    """Best-effort teardown when a tenant switches away from their current engine choice for a
    Sydekyk. Never deletes a Power Core model registration — that's shared across tenants and
    owned by the SydekykHostedAssignment, not by any one tenant's config."""
    if config.litellm_virtual_key_encrypted:
        litellm_admin.revoke_virtual_key(decrypt_secret(config.litellm_virtual_key_encrypted))
    if config.provider != "power_core" and config.litellm_model_id:
        litellm_admin.delete_model(config.litellm_model_id)
    config.litellm_model_alias = None
    config.litellm_model_id = None
    config.litellm_virtual_key_encrypted = None


def provision_byok(
    config: TenantSydekykLLMConfig,
    *,
    alias: str,
    provider: str,
    model: str,
    api_key: str,
    api_base: str | None,
) -> tuple[bool, str]:
    """Registers a per-(tenant, sydekyk) model + virtual key using the tenant's own credential."""
    ok, message, model_id = _ensure_model(config.litellm_model_id, alias, provider, model, api_key, api_base)
    if not ok:
        return False, message
    config.litellm_model_alias = alias
    config.litellm_model_id = model_id

    ok, message, encrypted_key = _ensure_virtual_key(
        config.litellm_virtual_key_encrypted, alias, max_budget=None, metadata={"provider": provider}
    )
    if not ok:
        return False, message
    config.litellm_virtual_key_encrypted = encrypted_key
    return True, "ok"


def ensure_hosted_assignment_model(
    assignment: SydekykHostedAssignment, *, alias: str, api_key: str, api_base: str | None
) -> tuple[bool, str]:
    """Admin-triggered: registers/updates the SHARED model backing every tenant's Power Core
    config for this Sydekyk."""
    ok, message, model_id = _ensure_model(
        assignment.litellm_model_id, alias, assignment.hosted_provider, assignment.hosted_model, api_key, api_base
    )
    if not ok:
        return False, message
    assignment.litellm_model_alias = alias
    assignment.litellm_model_id = model_id
    return True, "ok"


def provision_power_core(config: TenantSydekykLLMConfig, assignment: SydekykHostedAssignment) -> tuple[bool, str]:
    """Tenant-triggered: issues/updates this tenant's own virtual key scoped to the Sydekyk's
    shared Power Core model, so each tenant's usage is tracked separately even though the
    underlying model deployment is shared."""
    if not assignment.litellm_model_alias:
        return False, "Sydekyks hasn't configured this Sydekyk's Power Core engine yet."

    ok, message, encrypted_key = _ensure_virtual_key(
        config.litellm_virtual_key_encrypted,
        assignment.litellm_model_alias,
        max_budget=None,
        metadata={"provider": "power_core"},
    )
    if not ok:
        return False, message
    config.litellm_model_alias = assignment.litellm_model_alias
    config.litellm_model_id = assignment.litellm_model_id
    config.litellm_virtual_key_encrypted = encrypted_key
    return True, "ok"


def default_to_power_core(db: Session, tenant_id, sydekyk_id) -> bool:
    """When a Sydekyk is installed, wire it to the shared Power Core engine so the tenant can use it
    right away instead of having to open the engine picker and Save. Only acts when an admin has
    actually provisioned a hosted assignment for the Sydekyk, and never overrides an existing
    config. Best-effort: a provisioning failure (e.g. proxy unreachable) just leaves the Sydekyk for
    the user to configure manually — it never blocks the install. Returns True iff it provisioned."""
    existing = (
        db.query(TenantSydekykLLMConfig)
        .filter(TenantSydekykLLMConfig.tenant_id == tenant_id, TenantSydekykLLMConfig.sydekyk_id == sydekyk_id)
        .first()
    )
    if existing is not None:
        return False
    assignment = (
        db.query(SydekykHostedAssignment)
        .filter(SydekykHostedAssignment.sydekyk_id == sydekyk_id)
        .first()
    )
    if assignment is None or not assignment.litellm_model_alias:
        return False  # Power Core isn't available for this Sydekyk yet — leave it unconfigured.
    config = TenantSydekykLLMConfig(tenant_id=tenant_id, sydekyk_id=sydekyk_id, provider="power_core")
    db.add(config)
    db.flush()
    ok, message = provision_power_core(config, assignment)
    config.status = "untested" if ok else "error"
    config.last_test_error = None if ok else message
    return ok


def reprovision_hosted_for_provider(
    db: Session, *, provider: str, api_key: str, api_base: str | None
) -> list[str]:
    """Re-push the given credentials to every already-registered Power Core model backed by this
    provider. Called when the central provider key's base URL / api_key changes, so the LiteLLM
    deployments stop pointing at the stale endpoint instead of waiting for each hosted assignment
    to be re-saved by hand. Returns a list of "<slug>: <error>" strings (empty on full success).
    Only touches assignments that were actually provisioned (have a litellm_model_id)."""
    failures: list[str] = []
    assignments = (
        db.query(SydekykHostedAssignment)
        .filter(
            SydekykHostedAssignment.hosted_provider == provider,
            SydekykHostedAssignment.litellm_model_id.isnot(None),
        )
        .all()
    )
    for assignment in assignments:
        sydekyk = db.get(Sydekyk, assignment.sydekyk_id)
        if sydekyk is None:
            continue
        ok, message = ensure_hosted_assignment_model(
            assignment, alias=f"sydekyk-{sydekyk.slug}-core", api_key=api_key, api_base=api_base
        )
        if not ok:
            failures.append(f"{sydekyk.slug}: {message}")
    return failures


def reprovision_byok_for_credential(
    db: Session, *, tenant_id, provider: str, api_key: str, api_base: str | None
) -> list[str]:
    """BYOK counterpart to reprovision_hosted_for_provider: when a tenant edits their own provider
    credential (base URL / api_key), re-push it to every model they've provisioned with that
    provider. Returns a list of "<slug>: <error>" strings (empty on full success)."""
    tenant = db.get(Tenant, tenant_id)
    if tenant is None:
        return []
    failures: list[str] = []
    configs = (
        db.query(TenantSydekykLLMConfig)
        .filter(
            TenantSydekykLLMConfig.tenant_id == tenant_id,
            TenantSydekykLLMConfig.provider == provider,
            TenantSydekykLLMConfig.litellm_model_id.isnot(None),
        )
        .all()
    )
    for config in configs:
        sydekyk = db.get(Sydekyk, config.sydekyk_id)
        if sydekyk is None or not config.model:
            continue
        alias = f"tenant-{tenant.slug}-{sydekyk.slug}-{provider}"
        ok, message = provision_byok(
            config,
            alias=alias,
            provider=provider,
            model=config.model,
            api_key=api_key,
            api_base=api_base,
        )
        if not ok:
            failures.append(f"{sydekyk.slug}: {message}")
    return failures
