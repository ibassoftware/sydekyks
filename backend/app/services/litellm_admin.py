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


def test_completion(virtual_key: str, alias: str, timeout: float = 15.0) -> tuple[bool, str]:
    """Round-trips a minimal real completion through the proxy using the tenant's own virtual
    key, to confirm the underlying provider credentials actually work (not just that the model
    was registered in LiteLLM)."""
    try:
        with httpx.Client(base_url=settings.litellm_proxy_url, timeout=timeout) as client:
            resp = client.post(
                "/chat/completions",
                headers={"Authorization": f"Bearer {virtual_key}"},
                json={"model": alias, "messages": [{"role": "user", "content": "ping"}], "max_tokens": 1},
            )
    except (httpx.ConnectError, httpx.TimeoutException) as exc:
        return False, f"Could not reach the LiteLLM proxy: {exc}"

    if resp.status_code >= 400:
        return False, f"Provider rejected the request: {resp.text[:300]}"
    return True, "Connected successfully."
