"""Postmark payload parsing + Playbook-metadata drift guard (no DB)."""

import base64

from app.services.email_ingest.providers.postmark import parse_postmark_payload
from app.sydekyks.ledger.playbook import PLAYBOOK_STEPS


def test_postmark_parses_recipient_message_id_and_attachment():
    content = base64.b64encode(b"%PDF-1.4 fake").decode()
    raw = {
        "OriginalRecipient": "acme-abcd@inbound.sydekyks.com",
        "FromFull": {"Email": "vendor@example.com"},
        "Subject": "Invoice",
        "MessageID": "msg-123",
        "Attachments": [{"Name": "bill.pdf", "ContentType": "application/pdf", "Content": content}],
    }
    email = parse_postmark_payload(raw)
    assert email.to_address == "acme-abcd@inbound.sydekyks.com"
    assert email.from_address == "vendor@example.com"
    assert email.message_id == "msg-123"
    assert len(email.attachments) == 1
    assert email.attachments[0].content_bytes == b"%PDF-1.4 fake"


def test_postmark_falls_back_to_tofull_and_skips_bad_attachment():
    raw = {
        "ToFull": [{"Email": "x@inbound.sydekyks.com"}],
        "From": "v@example.com",
        "Attachments": [{"Name": "broken", "ContentType": "application/pdf", "Content": "!!!not-base64!!!"}],
    }
    email = parse_postmark_payload(raw)
    assert email.to_address == "x@inbound.sydekyks.com"
    assert email.from_address == "v@example.com"
    assert email.attachments == []


def test_postmark_prefers_original_recipient_over_tofull():
    raw = {
        "OriginalRecipient": "real@inbound.sydekyks.com",
        "ToFull": [{"Email": "other@inbound.sydekyks.com"}],
    }
    assert parse_postmark_payload(raw).to_address == "real@inbound.sydekyks.com"


def test_postmark_parses_mailbox_hash_and_multiple_attachments():
    # Mirrors Postmark's documented inbound payload: plus-addressing hash + several attachments,
    # each with a base64 Content and an ignored ContentLength/ContentID.
    a = base64.b64encode(b"one").decode()
    b = base64.b64encode(b"two").decode()
    raw = {
        "OriginalRecipient": "acme-ledger-a1b2c3+ahoy@inbound.sydekyks.com",
        "FromFull": {"Email": "vendor@example.com"},
        "MailboxHash": "ahoy",
        "StrippedTextReply": "reply text",
        "TextBody": "full body",
        "Attachments": [
            {"Name": "a.png", "ContentType": "image/png", "Content": a, "ContentLength": 3, "ContentID": "cid"},
            {"Name": "b.pdf", "ContentType": "application/pdf", "Content": b, "ContentLength": 3},
        ],
    }
    email = parse_postmark_payload(raw)
    assert email.mailbox_hash == "ahoy"
    assert email.text_body == "reply text"  # StrippedTextReply wins over TextBody
    assert [att.filename for att in email.attachments] == ["a.png", "b.pdf"]
    assert [att.content_bytes for att in email.attachments] == [b"one", b"two"]


def test_postmark_empty_payload_is_safe():
    email = parse_postmark_payload({})
    assert email.to_address == ""
    assert email.from_address == ""
    assert email.message_id is None
    assert email.mailbox_hash is None
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
