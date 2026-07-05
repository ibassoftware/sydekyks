from app.core.crypto import decrypt_secret, encrypt_secret
from app.models.llm_provider import SydekykHostedAssignment, TenantSydekykLLMConfig
from app.services import litellm_admin


def litellm_model_string(provider: str, model: str) -> str:
    if provider == "openai":
        return f"openai/{model}"
    if provider == "anthropic":
        return f"anthropic/{model}"
    if provider == "ollama_cloud":
        # NOTE: unverified — Ollama Cloud may expose an OpenAI-compatible API instead of the
        # native Ollama one. Confirm the correct prefix against a real account before relying
        # on this in production.
        return f"ollama/{model}"
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
