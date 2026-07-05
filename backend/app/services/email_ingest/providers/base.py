from dataclasses import dataclass, field


@dataclass
class ParsedAttachment:
    filename: str
    content_type: str
    content_bytes: bytes


@dataclass
class ParsedInboundEmail:
    """Provider-agnostic inbound email. Keeps provider-specific payload shapes isolated behind
    the parser so swapping Postmark for another provider only touches one file."""

    to_address: str
    from_address: str
    subject: str
    message_id: str | None = None  # provider message id — the idempotency key (VS-8)
    attachments: list[ParsedAttachment] = field(default_factory=list)
