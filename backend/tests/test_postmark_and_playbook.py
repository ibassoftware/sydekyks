"""Postmark payload parsing + Playbook-metadata drift guard (no DB)."""

import base64

from app.services.email_ingest.providers.postmark import parse_postmark_payload
from app.sydekyks.ledger.playbook import PLAYBOOK_STEPS


def test_postmark_parses_recipient_message_id_and_attachment():
    content = base64.b64encode(b"%PDF-1.4 fake").decode()
    raw = {
        "OriginalRecipient": "acme-abcd@inbound.sydekyks.app",
        "FromFull": {"Email": "vendor@example.com"},
        "Subject": "Invoice",
        "MessageID": "msg-123",
        "Attachments": [{"Name": "bill.pdf", "ContentType": "application/pdf", "Content": content}],
    }
    email = parse_postmark_payload(raw)
    assert email.to_address == "acme-abcd@inbound.sydekyks.app"
    assert email.from_address == "vendor@example.com"
    assert email.message_id == "msg-123"
    assert len(email.attachments) == 1
    assert email.attachments[0].content_bytes == b"%PDF-1.4 fake"


def test_postmark_falls_back_to_tofull_and_skips_bad_attachment():
    raw = {
        "ToFull": [{"Email": "x@inbound.sydekyks.app"}],
        "From": "v@example.com",
        "Attachments": [{"Name": "broken", "ContentType": "application/pdf", "Content": "!!!not-base64!!!"}],
    }
    email = parse_postmark_payload(raw)
    assert email.to_address == "x@inbound.sydekyks.app"
    assert email.from_address == "v@example.com"
    assert email.attachments == []


def test_playbook_steps_metadata_matches_expected_keys():
    """Guards against the read-only Playbook panel (VS-5) drifting from what run() records."""
    keys = [s["key"] for s in PLAYBOOK_STEPS]
    assert keys == [
        "classify_document",
        "extract_bill_data",
        "connect_odoo",
        "lookup_vendor",
        "duplicate_check",
        "infer_account",
        "resolve_currency",
        "resolve_tax",
        "create_bill",
        "attach_document",
        "post_bill",
    ]
    for step in PLAYBOOK_STEPS:
        assert step["title"] and step["description"] and step["likely_failures"]
