from app.services.error_display import friendly_message


def test_strips_trailing_json_blob():
    raw = (
        "The AI engine rejected the document. Its assigned model may not support image/PDF "
        'understanding — assign a vision-capable model in AI Engine settings. ({"error":{"message":'
        '"litellm.BadRequestError: OpenAIException - invalid image input."}})'
    )
    cleaned = friendly_message(raw)
    assert cleaned == (
        "The AI engine rejected the document. Its assigned model may not support image/PDF "
        "understanding — assign a vision-capable model in AI Engine settings."
    )
    assert "{" not in cleaned


def test_passes_through_plain_friendly_messages():
    assert friendly_message("No AI engine configured for Ledger.") == "No AI engine configured for Ledger."


def test_cuts_at_first_newline():
    assert friendly_message("Something failed\nTraceback (most recent call last):\n  ...") == "Something failed"


def test_none_stays_none():
    assert friendly_message(None) is None


def test_falls_back_when_message_is_only_a_blob():
    assert friendly_message('({"error": "opaque"})') == "An unexpected error occurred while running this step."
