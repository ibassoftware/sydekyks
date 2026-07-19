import time

import httpx

from app.core.config import settings


def _client() -> httpx.Client:
    return httpx.Client(
        base_url=settings.litellm_proxy_url,
        headers={"Authorization": f"Bearer {settings.litellm_master_key}"},
        timeout=10.0,
    )


def _request(method: str, path: str, *, json: dict | None = None, params: dict | None = None) -> tuple[bool, str, dict | None]:
    last_error = ""
    for attempt in range(2):
        try:
            with _client() as client:
                resp = client.request(method, path, json=json, params=params)
            if resp.status_code >= 400:
                return False, f"LiteLLM proxy returned {resp.status_code}: {resp.text[:300]}", None
            data = resp.json() if resp.content else None
            return True, "ok", data
        except (httpx.ConnectError, httpx.TimeoutException) as exc:
            last_error = str(exc)
            if attempt == 0:
                time.sleep(1.5)
    return False, f"Could not reach the LiteLLM proxy: {last_error}", None


def register_model(
    alias: str, litellm_model: str, api_key: str | None = None, api_base: str | None = None
) -> tuple[bool, str, dict | None]:
    litellm_params: dict = {"model": litellm_model}
    if api_key:
        litellm_params["api_key"] = api_key
    if api_base:
        litellm_params["api_base"] = api_base

    return _request("POST", "/model/new", json={"model_name": alias, "litellm_params": litellm_params})


def update_model(
    model_id: str, alias: str, litellm_model: str, api_key: str | None = None, api_base: str | None = None
) -> tuple[bool, str, dict | None]:
    litellm_params: dict = {"model": litellm_model}
    if api_key:
        litellm_params["api_key"] = api_key
    if api_base:
        litellm_params["api_base"] = api_base

    return _request(
        "POST",
        "/model/update",
        json={"model_name": alias, "litellm_params": litellm_params, "model_info": {"id": model_id}},
    )


def delete_model(model_id: str) -> tuple[bool, str, None]:
    ok, message, _ = _request("POST", "/model/delete", json={"id": model_id})
    return ok, message, None


def generate_virtual_key(
    models: list[str], max_budget: float | None = None, metadata: dict | None = None
) -> tuple[bool, str, str | None]:
    body: dict = {"models": models}
    if max_budget is not None:
        body["max_budget"] = max_budget
    if metadata:
        body["metadata"] = metadata

    ok, message, data = _request("POST", "/key/generate", json=body)
    key = data.get("key") if ok and data else None
    return ok, message, key


def update_virtual_key(
    key: str, models: list[str] | None = None, max_budget: float | None = None
) -> tuple[bool, str, None]:
    body: dict = {"key": key}
    if models is not None:
        body["models"] = models
    if max_budget is not None:
        body["max_budget"] = max_budget

    ok, message, _ = _request("POST", "/key/update", json=body)
    return ok, message, None


def revoke_virtual_key(key: str) -> tuple[bool, str, None]:
    ok, message, _ = _request("POST", "/key/delete", json={"keys": [key]})
    return ok, message, None


def get_key_spend(key: str) -> tuple[bool, str, dict | None]:
    return _request("GET", "/key/info", params={"key": key})


def friendly_llm_error(status_code: int, body: str) -> str:
    """Translate a raw LiteLLM/provider error response into a plain, actionable message.

    The proxy surfaces provider errors verbatim — including HTML web pages and stack-trace-laden
    JSON — which are useless to a non-technical operator. Map the common failure shapes to a hint
    about what to fix, and only fall back to a trimmed provider message when we can't classify it.
    """
    raw = body or ""
    lowered = raw.lower()
    # An HTML page (not JSON) means the Base URL is pointing at a website, not the API endpoint —
    # e.g. https://ollama.com instead of https://ollama.com/v1.
    if "<!doctype" in lowered or "<html" in lowered or "<title>" in lowered:
        return (
            "The engine's Base URL looks misconfigured — it returned a web page instead of an API "
            "response. Check the provider's Base URL (for OpenAI-compatible providers it usually "
            "ends in /v1)."
        )
    if status_code in (401, 403) or "unauthor" in lowered or "authenticationerror" in lowered \
            or "invalid api key" in lowered or "invalid_api_key" in lowered:
        return "Authentication failed — check the API key configured for this provider."
    if status_code == 404 or "not found" in lowered or "notfounderror" in lowered:
        return (
            "The model or API path wasn't found (404). Check the model name, and that the Base URL "
            "path is correct."
        )
    if status_code == 429 or "rate limit" in lowered or "ratelimiterror" in lowered:
        return "The provider rate-limited the request. Wait a moment and try again."
    detail = _extract_error_message(raw)
    if detail:
        return f"The provider rejected the request (HTTP {status_code}): {detail}"
    return f"The provider rejected the request (HTTP {status_code}). Check the engine configuration."


def _extract_error_message(raw: str) -> str:
    """Pull a clean human message out of a JSON error envelope, ignoring HTML/nested blobs."""
    import json as _json

    try:
        data = _json.loads(raw)
    except (ValueError, TypeError):
        return ""
    msg = data.get("error", {}).get("message") if isinstance(data, dict) else None
    if isinstance(msg, str) and "<" not in msg and msg.strip():
        return msg.strip()[:200]
    return ""


def _run_completion_test(bearer: str, alias: str, timeout: float) -> tuple[bool, str]:
    try:
        with httpx.Client(base_url=settings.litellm_proxy_url, timeout=timeout) as client:
            resp = client.post(
                "/chat/completions",
                headers={"Authorization": f"Bearer {bearer}"},
                json={"model": alias, "messages": [{"role": "user", "content": "ping"}], "max_tokens": 1},
            )
    except (httpx.ConnectError, httpx.TimeoutException):
        return False, "Could not reach the LiteLLM proxy — it may be down or unreachable."

    if resp.status_code >= 400:
        return False, friendly_llm_error(resp.status_code, resp.text)
    return True, "Connected successfully."


def test_completion(virtual_key: str, alias: str, timeout: float = 15.0) -> tuple[bool, str]:
    """Round-trips a minimal real completion through the proxy using the tenant's own virtual
    key, to confirm the underlying provider credentials actually work (not just that the model
    was registered in LiteLLM)."""
    return _run_completion_test(virtual_key, alias, timeout)


def test_completion_master(alias: str, timeout: float = 15.0) -> tuple[bool, str]:
    """Round-trips a completion using the LiteLLM master key — for admin-side testing of a shared
    hosted (Power Core) model, which has no per-tenant virtual key to authenticate with."""
    return _run_completion_test(settings.litellm_master_key, alias, timeout)
