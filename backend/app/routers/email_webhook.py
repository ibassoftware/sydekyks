import base64
import binascii
import hashlib
import secrets
import time
from collections import deque

from fastapi import APIRouter, Header, Request
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import get_db
from app.models.email_event import EmailIngestEvent
from app.models.gadget import Gadget, TenantGadgetLink
from app.models.gadget_requirement import SydekykGadgetRequirement, TenantSydekykGadgetAssignment
from app.models.sydekyk import Sydekyk
from app.services.email_ingest.providers.base import ParsedInboundEmail
from app.services.email_ingest.providers.postmark import parse_postmark_payload
from app.services.missions import create_mission_for_document
from app.services.queue import enqueue_mission

router = APIRouter(prefix="/api/webhooks/email", tags=["email-webhook"])

_ALLOWED_TYPES = {"application/pdf", "image/png", "image/jpeg", "image/webp"}
_ALLOWED_EXTS = (".pdf", ".png", ".jpg", ".jpeg", ".webp")

# Simple in-memory sliding-window rate limiter (VS-11). Per-process; good enough to blunt floods on
# a single public endpoint. A distributed limiter (Redis) is the next step if we scale out.
_RATE_WINDOW = 60.0
_recent_hits: dict[str, deque] = {}


def _rate_limited(key: str) -> bool:
    now = time.monotonic()
    hits = _recent_hits.setdefault(key, deque())
    while hits and now - hits[0] > _RATE_WINDOW:
        hits.popleft()
    if len(hits) >= settings.email_webhook_rate_limit_per_minute:
        return True
    hits.append(now)
    return False


def _authorized(authorization: str | None) -> bool:
    if not authorization or not authorization.startswith("Basic "):
        return False
    try:
        decoded = base64.b64decode(authorization[6:]).decode("utf-8")
        user, _, pwd = decoded.partition(":")
    except (binascii.Error, ValueError):
        return False
    return secrets.compare_digest(user, settings.email_webhook_basic_auth_user) and secrets.compare_digest(
        pwd, settings.email_webhook_basic_auth_pass
    )


def _record(
    db: Session,
    email: ParsedInboundEmail | None,
    outcome: str,
    *,
    reason: str | None = None,
    tenant_id=None,
    matched_link_id=None,
    matched_sydekyk_id=None,
    missions_created: int = 0,
) -> None:
    db.add(
        EmailIngestEvent(
            tenant_id=tenant_id,
            provider="postmark",
            message_id=email.message_id if email else None,
            to_address=email.to_address if email else "",
            from_address=email.from_address if email else "",
            attachment_count=len(email.attachments) if email else 0,
            matched_link_id=matched_link_id,
            matched_sydekyk_id=matched_sydekyk_id,
            missions_created=missions_created,
            outcome=outcome,
            reason=reason,
        )
    )
    db.commit()


@router.post("/postmark")
async def postmark_inbound(request: Request, authorization: str | None = Header(default=None)):
    # Public endpoint — app-wide Basic Auth proves it's our configured Postmark webhook. Always
    # returns 200 (even on rejection/no-match) so we never leak tenant existence or trigger retries.
    client_ip = request.client.host if request.client else "unknown"
    # Deliberately NOT recorded: rate-limited requests are the over-limit ones, so writing a row per
    # rejection would be unbounded under a flood and defeat the limiter. Every branch BELOW the limit
    # is recorded (and thus itself capped at the per-minute limit).
    if _rate_limited(client_ip):
        return {"status": "rate_limited"}

    if not _authorized(authorization):
        db: Session = next(get_db())
        try:
            _record(db, None, "unauthorized", reason=f"bad/absent auth from {client_ip}")
        finally:
            db.close()
        return {"status": "unauthorized"}

    try:
        raw = await request.json()
    except ValueError:
        db = next(get_db())
        try:
            _record(db, None, "ignored", reason="invalid JSON body")
        finally:
            db.close()
        return {"status": "ignored"}

    email = parse_postmark_payload(raw)
    local_part = email.to_address.split("@")[0].strip().lower()

    db: Session = next(get_db())
    try:
        # Idempotency: a repeated provider message id never re-creates Missions.
        if email.message_id:
            existing = (
                db.query(EmailIngestEvent)
                .filter(
                    EmailIngestEvent.provider == "postmark",
                    EmailIngestEvent.message_id == email.message_id,
                    EmailIngestEvent.outcome.in_(["accepted", "ambiguous_inbox"]),
                )
                .first()
            )
            if existing is not None:
                _record(db, email, "duplicate", reason="already processed this message id")
                return {"status": "duplicate"}

        if not local_part or not email.attachments:
            _record(db, email, "no_op", reason="no recipient local-part or no attachments")
            return {"status": "no_op"}

        link = (
            db.query(TenantGadgetLink)
            .join(Gadget, Gadget.id == TenantGadgetLink.gadget_id)
            .filter(Gadget.category == "email", TenantGadgetLink.config["inbound_local_part"].astext == local_part)
            .first()
        )
        if link is None:
            _record(db, email, "no_match", reason=f"no email Gadget Link for local-part '{local_part}'")
            return {"status": "no_match"}

        rows = (
            db.query(Sydekyk)
            .join(SydekykGadgetRequirement, SydekykGadgetRequirement.sydekyk_id == Sydekyk.id)
            .join(
                TenantSydekykGadgetAssignment,
                TenantSydekykGadgetAssignment.requirement_id == SydekykGadgetRequirement.id,
            )
            .filter(
                TenantSydekykGadgetAssignment.tenant_id == link.tenant_id,
                TenantSydekykGadgetAssignment.gadget_link_id == link.id,
                Sydekyk.accepts_document_uploads.is_(True),
                Sydekyk.playbook_key.isnot(None),
            )
            .all()
        )
        if not rows:
            _record(db, email, "no_sydekyk", reason="inbox not assigned to any upload-capable Sydekyk",
                    tenant_id=link.tenant_id, matched_link_id=link.id)
            return {"status": "no_sydekyk"}

        # Decision locked: one inbox → one Sydekyk. Take the single match; if more are somehow
        # assigned, use the first and flag it rather than fanning out into duplicate bills.
        sydekyk = rows[0]
        ambiguous = len(rows) > 1

        count = 0
        for att in email.attachments:
            if att.content_type not in _ALLOWED_TYPES and not att.filename.lower().endswith(_ALLOWED_EXTS):
                continue
            if len(att.content_bytes) > settings.max_document_bytes:
                _record(db, email, "rejected_size", reason=f"attachment '{att.filename}' exceeds size limit",
                        tenant_id=link.tenant_id, matched_link_id=link.id, matched_sydekyk_id=sydekyk.id)
                return {"status": "rejected_size"}
            mission = create_mission_for_document(
                db,
                tenant_id=link.tenant_id,
                sydekyk=sydekyk,
                user_id=None,
                document_bytes=att.content_bytes,
                filename=att.filename,
                content_type=att.content_type,
                sha256_hash=hashlib.sha256(att.content_bytes).hexdigest(),
                source="email",
                signal_type="email",
                trigger_context={
                    "source": "email",
                    "subject": email.subject,
                    "from_address": email.from_address,
                    "text_body": (email.text_body or "")[:4000],
                },
            )
            await enqueue_mission(mission.id)
            count += 1

        if count == 0:
            # Attachments were present but none passed the type filter — not an accepted bill.
            _record(db, email, "no_supported_attachment", reason="no attachment matched allowed types",
                    tenant_id=link.tenant_id, matched_link_id=link.id, matched_sydekyk_id=sydekyk.id)
            return {"status": "no_supported_attachment"}

        outcome = "ambiguous_inbox" if ambiguous else "accepted"
        reason = "more than one Sydekyk on this inbox; used the first" if ambiguous else None
        _record(db, email, outcome, reason=reason, tenant_id=link.tenant_id,
                matched_link_id=link.id, matched_sydekyk_id=sydekyk.id, missions_created=count)
        return {"status": outcome, "missions": count}
    finally:
        db.close()
