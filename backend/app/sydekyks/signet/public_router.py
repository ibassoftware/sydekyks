"""Public, unauthenticated signing endpoints — a signer opens the emailed link, views the document, and
signs, with no login. Modeled on the inbound email webhook (app/routers/email_webhook.py): the router
declares NO auth dependency and self-authenticates by validating the opaque per-signer token in
constant time, with a per-process IP rate limiter to blunt floods. Errors are deliberately generic so
the endpoint never leaks whether a given token/tenant exists.
"""

import base64
import time
from collections import deque

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import get_db
from app.sydekyks.signet import service
from app.sydekyks.signet.models import SignetEnvelope
from app.sydekyks.signet.schemas import DeclineIn, PublicEnvelopeOut, PublicResultOut, SignIn

router = APIRouter(prefix="/api/sign", tags=["signet-public"])

_ACTIVE_STATUSES = {"sent", "partially_signed"}
_MAX_SIG_IMAGE_BYTES = 2 * 1024 * 1024

_RATE_WINDOW = 60.0
_recent_hits: dict[str, deque] = {}


def _rate_limited(key: str) -> bool:
    now = time.monotonic()
    hits = _recent_hits.setdefault(key, deque())
    while hits and now - hits[0] > _RATE_WINDOW:
        hits.popleft()
    if len(hits) >= settings.sign_rate_limit_per_minute:
        return True
    hits.append(now)
    return False


def _guard(request: Request):
    client_ip = request.client.host if request.client else "unknown"
    if _rate_limited(client_ip):
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Too many requests")
    return client_ip


def _lookup(db: Session, token: str):
    """(signer, envelope) or a 404 — generic message so we never disclose token/tenant existence."""
    signer = service.find_signer_by_raw_token(db, token)
    if signer is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="This signing link is not valid.")
    envelope = db.get(SignetEnvelope, signer.envelope_id)
    if envelope is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="This signing link is not valid.")
    return signer, envelope


def _decode_signature_image(data_uri: str | None) -> bytes | None:
    if not data_uri or not data_uri.startswith("data:image/"):
        return None
    try:
        _, b64 = data_uri.split(",", 1)
        raw = base64.b64decode(b64)
    except (ValueError, TypeError):
        return None
    if len(raw) > _MAX_SIG_IMAGE_BYTES:
        return None
    return raw


@router.get("/{token}", response_model=PublicEnvelopeOut)
def view(token: str, request: Request, db: Session = Depends(get_db)):
    ip = _guard(request)
    signer, envelope = _lookup(db, token)

    if envelope.status not in _ACTIVE_STATUSES or envelope.hold:
        return PublicEnvelopeOut(
            title=envelope.title, message=envelope.message, signer_name=signer.name,
            status="unavailable", already_signed=(signer.status == "signed"),
        )
    # Record the first view.
    if signer.status == "pending":
        from datetime import datetime, timezone

        signer.status = "viewed"
        signer.viewed_at = datetime.now(timezone.utc)
        db.commit()
        service.log_event(db, envelope=envelope, event_type="viewed", signer_id=signer.id,
                          ip=ip, detail=f"{signer.name} opened the document")

    doc_uri = None
    source = service.source_pdf_bytes(db, envelope)
    if source:
        doc_uri = f"data:application/pdf;base64,{base64.b64encode(source).decode('ascii')}"
    return PublicEnvelopeOut(
        title=envelope.title, message=envelope.message, signer_name=signer.name,
        status=signer.status, already_signed=(signer.status == "signed"), document_data_uri=doc_uri,
    )


@router.post("/{token}", response_model=PublicResultOut)
def sign(token: str, payload: SignIn, request: Request, db: Session = Depends(get_db)):
    ip = _guard(request)
    signer, envelope = _lookup(db, token)

    if signer.status == "signed":
        return PublicResultOut(status="signed", message="You've already signed this document.")
    if envelope.status not in _ACTIVE_STATUSES or envelope.hold:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This document is no longer available for signing.")
    if not payload.agree:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You must agree to sign electronically.")
    # Sequential order: block a later signer until it's their turn.
    if envelope.signing_order == "sequential":
        active = service.recipients_for_send(db, envelope)
        if active and active[0].id != signer.id:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                                detail="It isn't your turn to sign yet — you'll be emailed when it is.")

    image = _decode_signature_image(payload.signature_image_data_uri)
    service.record_signature(db, envelope, signer, signature_name=payload.signature_name, signature_image=image, ip=ip)
    sender = envelope.created_by or "the sender"
    service.advance_or_complete(db, envelope, sender=sender)
    db.refresh(envelope)
    if envelope.status == "completed":
        return PublicResultOut(status="completed", message="Thank you — the document is now fully signed.")
    return PublicResultOut(status="signed", message="Thank you — your signature has been recorded.")


@router.post("/{token}/decline", response_model=PublicResultOut)
def decline(token: str, payload: DeclineIn, request: Request, db: Session = Depends(get_db)):
    ip = _guard(request)
    signer, envelope = _lookup(db, token)
    if signer.status == "signed":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="You've already signed this document.")
    if envelope.status not in _ACTIVE_STATUSES or envelope.hold:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This document is no longer available.")
    service.record_decline(db, envelope, signer, reason=payload.reason, ip=ip)
    return PublicResultOut(status="declined", message="You've declined to sign. The sender has been notified.")
