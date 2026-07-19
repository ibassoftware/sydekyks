"""Signet's core orchestration - token minting, install-guard, event logging, sending invitations and
reminders, sequential advancement, and final signed-PDF assembly. Deliberately AI-free: the optional
AI email copy lives in the dispatch playbook (where a metered mission exists); everything here is
deterministic so the reminder cron and the public signing endpoints never need the model.
"""

import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.crypto import decrypt_secret, encrypt_secret
from app.models.sydekyk import Sydekyk, SydekykInstall
from app.services import mailer
from app.sydekyks.signet import emails, pdf as pdf_svc
from app.sydekyks.signet.models import SignetAsset, SignetEnvelope, SignetEvent, SignetSigner


# --- Install guard ---------------------------------------------------------------------------------

def ensure_installed(db: Session, tenant_id: uuid.UUID, slug: str) -> None:
    """Install a Sydekyk for a tenant if it isn't already (auto-install Seal on first handoff, and
    Signet itself). Idempotent - a no-op when the install row already exists."""
    sydekyk = db.query(Sydekyk).filter(Sydekyk.slug == slug).first()
    if sydekyk is None:
        return
    exists = (
        db.query(SydekykInstall)
        .filter(SydekykInstall.tenant_id == tenant_id, SydekykInstall.sydekyk_id == sydekyk.id)
        .first()
    )
    if exists is None:
        db.add(SydekykInstall(tenant_id=tenant_id, sydekyk_id=sydekyk.id))
        db.commit()


# --- Tokens ----------------------------------------------------------------------------------------

def _hash(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def mint_token() -> tuple[str, str, str]:
    """Returns (raw_token, token_hash, token_encrypted). The raw token goes only into the emailed link;
    we persist its hash (for O(1) public lookup) and a Fernet copy (to rebuild the link for reminders)."""
    raw = secrets.token_urlsafe(32)
    return raw, _hash(raw), encrypt_secret(raw)


def sign_link(raw_token: str) -> str:
    return f"{settings.public_base_url.rstrip('/')}/sign/{raw_token}"


def signer_link(signer: SignetSigner) -> str | None:
    """Rebuild a signer's signing link from the stored encrypted token (for reminders)."""
    if not signer.token_encrypted:
        return None
    try:
        return sign_link(decrypt_secret(signer.token_encrypted))
    except Exception:  # noqa: BLE001
        return None


def find_signer_by_raw_token(db: Session, raw_token: str) -> SignetSigner | None:
    if not raw_token:
        return None
    return db.query(SignetSigner).filter(SignetSigner.token_hash == _hash(raw_token)).first()


# --- Events ----------------------------------------------------------------------------------------

def log_event(db: Session, *, envelope: SignetEnvelope, event_type: str,
              signer_id: uuid.UUID | None = None, detail: str | None = None, ip: str | None = None) -> None:
    db.add(SignetEvent(
        tenant_id=envelope.tenant_id, envelope_id=envelope.id, signer_id=signer_id,
        event_type=event_type, detail=detail, ip=ip,
    ))
    db.commit()


# --- Source document -------------------------------------------------------------------------------

def source_pdf_bytes(db: Session, envelope: SignetEnvelope) -> bytes | None:
    if not envelope.source_asset_id:
        return None
    asset = db.get(SignetAsset, envelope.source_asset_id)
    return asset.content if asset is not None and asset.tenant_id == envelope.tenant_id else None


# --- Recipients / sending ---------------------------------------------------------------------------

def _pending_signers(db: Session, envelope: SignetEnvelope) -> list[SignetSigner]:
    return (
        db.query(SignetSigner)
        .filter(SignetSigner.envelope_id == envelope.id, SignetSigner.status.in_(["pending", "viewed"]))
        .order_by(SignetSigner.order.asc(), SignetSigner.created_at.asc())
        .all()
    )


def recipients_for_send(db: Session, envelope: SignetEnvelope) -> list[SignetSigner]:
    """Who should receive a link now - all pending for parallel, only the next in line for sequential."""
    pending = _pending_signers(db, envelope)
    if envelope.signing_order == "sequential":
        return pending[:1]
    return pending


def deliver_invitation(db: Session, envelope: SignetEnvelope, signer: SignetSigner, *,
                       subject: str, body_html: str) -> bool:
    """Deliver an (AI-written) invitation body - greeting is prepended deterministically so the model
    never has to render the signer's name."""
    link = signer_link(signer)
    if link is None:
        return False
    greeting = f"<p>Hi {signer.name},</p>" if signer.name else "<p>Hello,</p>"
    html = emails.wrap_body(f"{greeting}{body_html}", link)
    ok = mailer.send_email(
        db, to=signer.email, subject=subject, html=html, tag="signet-invite",
        tenant_id=envelope.tenant_id, sydekyk_id=envelope.sydekyk_id,
    )
    if ok:
        signer.last_reminded_at = datetime.now(timezone.utc)
        log_event(db, envelope=envelope, event_type="sent", signer_id=signer.id, detail=f"Invitation to {signer.email}")
    return ok


def send_template_invitation(db: Session, envelope: SignetEnvelope, signer: SignetSigner, *, sender: str) -> bool:
    subject, body = emails.invite_template(
        signer_name=signer.name, title=envelope.title, sender=sender, note=envelope.message,
    )
    link = signer_link(signer)
    if link is None:
        return False
    html = emails.wrap_body(body, link)
    ok = mailer.send_email(
        db, to=signer.email, subject=subject, html=html, tag="signet-invite",
        tenant_id=envelope.tenant_id, sydekyk_id=envelope.sydekyk_id,
    )
    if ok:
        signer.last_reminded_at = datetime.now(timezone.utc)
        log_event(db, envelope=envelope, event_type="sent", signer_id=signer.id, detail=f"Invitation to {signer.email}")
    return ok


def mark_sent(db: Session, envelope: SignetEnvelope) -> None:
    now = datetime.now(timezone.utc)
    if envelope.status == "draft":
        envelope.status = "sent"
        envelope.sent_at = now
    if envelope.expires_at is None and envelope.max_reminders is not None:
        envelope.expires_at = now + timedelta(days=envelope.reminder_interval_days * (envelope.max_reminders + 1) + 7)
    db.commit()


# --- Signature capture / advancement / completion --------------------------------------------------

def record_signature(db: Session, envelope: SignetEnvelope, signer: SignetSigner, *,
                     signature_name: str, signature_image: bytes | None, ip: str | None) -> None:
    now = datetime.now(timezone.utc)
    signer.status = "signed"
    signer.signature_name = signature_name[:200]
    signer.signature_image = signature_image
    signer.signed_at = now
    signer.ip_address = ip
    db.commit()
    log_event(db, envelope=envelope, event_type="signed", signer_id=signer.id, ip=ip,
              detail=f"{signer.name} signed")


def record_decline(db: Session, envelope: SignetEnvelope, signer: SignetSigner, *, reason: str, ip: str | None) -> None:
    signer.status = "declined"
    signer.decline_reason = reason
    signer.ip_address = ip
    envelope.status = "declined"
    envelope.hold = True  # a declined envelope is held so the cron never chases it
    db.commit()
    log_event(db, envelope=envelope, event_type="declined", signer_id=signer.id, ip=ip,
              detail=(reason or "")[:500])


def all_signed(db: Session, envelope: SignetEnvelope) -> bool:
    total = db.query(SignetSigner).filter(SignetSigner.envelope_id == envelope.id).count()
    signed = db.query(SignetSigner).filter(
        SignetSigner.envelope_id == envelope.id, SignetSigner.status == "signed"
    ).count()
    return total > 0 and signed == total


def advance_or_complete(db: Session, envelope: SignetEnvelope, *, sender: str) -> None:
    """After a signature: for sequential, invite the next signer; if all have signed, complete."""
    if all_signed(db, envelope):
        complete_envelope(db, envelope)
        return
    envelope.status = "partially_signed"
    db.commit()
    if envelope.signing_order == "sequential":
        for nxt in recipients_for_send(db, envelope):
            send_template_invitation(db, envelope, nxt, sender=sender)
        db.commit()


def complete_envelope(db: Session, envelope: SignetEnvelope) -> None:
    """Assemble the signed PDF + certificate, store it, email all parties, mark completed."""
    now = datetime.now(timezone.utc)
    source = source_pdf_bytes(db, envelope)
    signers = (
        db.query(SignetSigner)
        .filter(SignetSigner.envelope_id == envelope.id)
        .order_by(SignetSigner.order.asc())
        .all()
    )
    signer_dicts = [{
        "name": s.name, "email": s.email, "signed_at": s.signed_at, "ip": s.ip_address,
        "signature_name": s.signature_name,
        "signature_image_uri": pdf_svc.signature_image_uri(s.signature_image),
    } for s in signers]

    signed_asset_id = None
    if source:
        try:
            signed_bytes = pdf_svc.assemble_signed_pdf(
                source_pdf=source, title=envelope.title, signers=signer_dicts, completed_at=now,
            )
            asset = SignetAsset(
                tenant_id=envelope.tenant_id, envelope_id=envelope.id, kind="signed",
                filename=f"{envelope.title}-signed.pdf", content_type="application/pdf",
                size_bytes=len(signed_bytes), content=signed_bytes,
            )
            db.add(asset)
            db.flush()
            signed_asset_id = asset.id
        except RuntimeError:
            signed_asset_id = None  # WeasyPrint unavailable - complete without the assembled PDF

    envelope.status = "completed"
    envelope.completed_at = now
    envelope.signed_pdf_asset_id = signed_asset_id
    db.commit()
    log_event(db, envelope=envelope, event_type="completed", detail="All parties signed")

    # Notify every signer that it's done.
    for s in signers:
        subject = f"Completed: {envelope.title}"
        body = (
            f"<p>Hi {s.name},</p><p><strong>{envelope.title}</strong> has been signed by all parties. "
            "Thank you.</p>"
        )
        mailer.send_email(
            db, to=s.email, subject=subject, html=body, tag="signet-complete",
            tenant_id=envelope.tenant_id, sydekyk_id=envelope.sydekyk_id,
        )


# --- Reminder cron ---------------------------------------------------------------------------------

def remind_envelope(db: Session, envelope: SignetEnvelope, *, force: bool = False) -> int:
    """Send template reminders to the envelope's due signers - respecting the max-reminder cap always,
    and the per-signer interval unless `force` (a manual "remind now"). Returns how many were sent.
    Skips a held envelope; expires an overdue one. Deterministic (no AI, no mission)."""
    now = datetime.now(timezone.utc)
    if envelope.hold or envelope.status not in ("sent", "partially_signed"):
        return 0
    if envelope.expires_at is not None and envelope.expires_at <= now:
        envelope.status = "expired"
        db.commit()
        log_event(db, envelope=envelope, event_type="expired", detail="Signing window elapsed")
        return 0
    interval = timedelta(days=max(1, envelope.reminder_interval_days))
    sent = 0
    for signer in recipients_for_send(db, envelope):
        if signer.reminder_count >= envelope.max_reminders:
            continue
        last = signer.last_reminded_at
        if not force and last is not None and (now - last) < interval:
            continue
        subject, body = emails.reminder_template(
            signer_name=signer.name, title=envelope.title,
            sender=(envelope.created_by or settings.email_from_name),
            reminder_number=signer.reminder_count + 1,
        )
        link = signer_link(signer)
        if link is None:
            continue
        html = emails.wrap_body(body, link)
        ok = mailer.send_email(
            db, to=signer.email, subject=subject, html=html, tag="signet-reminder",
            tenant_id=envelope.tenant_id, sydekyk_id=envelope.sydekyk_id,
        )
        if ok:
            signer.reminder_count += 1
            signer.last_reminded_at = now
            db.commit()
            log_event(db, envelope=envelope, event_type="reminded", signer_id=signer.id,
                      detail=f"Reminder #{signer.reminder_count} to {signer.email}")
            sent += 1
    return sent


def process_due_reminders(db: Session) -> int:
    """Cron entry: scan sent/partially-signed envelopes and send due reminders. Returns the total sent.

    Only HQs that currently have Signet installed are processed — uninstalling Signet must stop all
    outbound signing reminders, not just hide the UI."""
    signet = db.query(Sydekyk).filter(Sydekyk.slug == "signet").first()
    if signet is None:
        return 0
    installed_tenant_ids = {
        row[0] for row in db.query(SydekykInstall.tenant_id).filter(SydekykInstall.sydekyk_id == signet.id).all()
    }
    if not installed_tenant_ids:
        return 0

    total = 0
    envelopes = (
        db.query(SignetEnvelope)
        .filter(
            SignetEnvelope.tenant_id.in_(installed_tenant_ids),
            SignetEnvelope.status.in_(["sent", "partially_signed"]),
            SignetEnvelope.hold.is_(False),
        )
        .all()
    )
    for envelope in envelopes:
        total += remind_envelope(db, envelope, force=False)
    return total
