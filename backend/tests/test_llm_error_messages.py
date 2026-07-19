"""friendly_llm_error turns raw proxy/provider errors into actionable, non-technical text."""

from app.services.litellm_admin import friendly_llm_error


def test_html_body_maps_to_base_url_hint():
    body = '<!doctype html>\n<html><head><title>Ollama</title></head><body>...</body></html>'
    msg = friendly_llm_error(404, body)
    assert "Base URL" in msg
    assert "<" not in msg  # no raw HTML leaks through


def test_404_path_not_found_maps_to_model_path_hint():
    body = '{"error":{"message":"litellm.NotFoundError: path \\"/api/chat/completions\\" not found"}}'
    msg = friendly_llm_error(404, body)
    assert "404" in msg and "path" in msg.lower()


def test_401_maps_to_auth_hint():
    assert "Authentication failed" in friendly_llm_error(401, '{"error":{"message":"Unauthorized"}}')


def test_clean_json_message_is_surfaced_trimmed():
    msg = friendly_llm_error(400, '{"error":{"message":"model gemma4:31b is not available"}}')
    assert "gemma4:31b" in msg and "400" in msg


def test_unclassified_falls_back_without_leaking_html():
    assert friendly_llm_error(500, "boom") == (
        "The provider rejected the request (HTTP 500). Check the engine configuration."
    )
