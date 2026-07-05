import httpx

# Prefixes considered "chat-capable" — filters out embeddings/whisper/tts/moderation models
# that OpenAI's /v1/models also returns.
_OPENAI_CHAT_PREFIXES = ("gpt-", "o1", "o3", "o4", "chatgpt-")

# Maintained manually until Anthropic's own models-list endpoint reliability is verified
# (see plan §5 / §10 — this needs confirming against Anthropic's docs before relying on it further).
_ANTHROPIC_STATIC_MODELS = [
    "claude-opus-4-8",
    "claude-sonnet-5",
    "claude-haiku-4-5-20251001",
]


def fetch_openai_models(api_key: str, timeout: float = 8.0) -> tuple[bool, str, list[str]]:
    try:
        resp = httpx.get(
            "https://api.openai.com/v1/models",
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=timeout,
        )
    except (httpx.ConnectError, httpx.TimeoutException) as exc:
        return False, f"Could not reach OpenAI: {exc}", []

    if resp.status_code == 401:
        return False, "Invalid OpenAI API key.", []
    if resp.status_code >= 400:
        return False, f"OpenAI returned {resp.status_code}: {resp.text[:300]}", []

    ids = [m["id"] for m in resp.json().get("data", [])]
    chat_models = sorted(m for m in ids if m.startswith(_OPENAI_CHAT_PREFIXES))
    return True, "ok", chat_models


def anthropic_static_models() -> list[str]:
    return list(_ANTHROPIC_STATIC_MODELS)
