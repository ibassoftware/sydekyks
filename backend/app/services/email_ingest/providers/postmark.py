import base64
import binascii

from app.services.email_ingest.providers.base import ParsedAttachment, ParsedInboundEmail


def parse_postmark_payload(raw: dict) -> ParsedInboundEmail:
    """Postmark inbound webhook payload → ParsedInboundEmail.

    Postmark delivers a single recipient in `OriginalRecipient` (or the first of `ToFull`), and
    attachments inline as base64 under `Attachments` with `Name`/`ContentType`/`Content`.
    """
    to_address = raw.get("OriginalRecipient") or ""
    if not to_address:
        to_full = raw.get("ToFull") or []
        if to_full:
            to_address = to_full[0].get("Email", "")

    from_address = raw.get("FromFull", {}).get("Email") or raw.get("From") or ""

    attachments = []
    for att in raw.get("Attachments") or []:
        content = att.get("Content")
        if not content:
            continue
        try:
            content_bytes = base64.b64decode(content)
        except (binascii.Error, ValueError):
            continue
        attachments.append(
            ParsedAttachment(
                filename=att.get("Name") or "attachment",
                content_type=att.get("ContentType") or "application/octet-stream",
                content_bytes=content_bytes,
            )
        )

    return ParsedInboundEmail(
        to_address=to_address,
        from_address=from_address,
        subject=raw.get("Subject") or "",
        message_id=raw.get("MessageID") or None,
        attachments=attachments,
    )
