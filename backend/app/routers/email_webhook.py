import base64
import binascii
import hashlib
import secrets

from fastapi import APIRouter, BackgroundTasks, Header, Request
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import get_db
from app.models.gadget import Gadget, TenantGadgetLink
from app.models.gadget_requirement import SydekykGadgetRequirement, TenantSydekykGadgetAssignment
from app.models.sydekyk import Sydekyk
from app.services.email_ingest.providers.postmark import parse_postmark_payload
from app.services.missions import create_mission_for_document, run_mission

router = APIRouter(prefix="/api/webhooks/email", tags=["email-webhook"])

_ALLOWED_TYPES = {"application/pdf", "image/png", "image/jpeg", "image/webp"}
_ALLOWED_EXTS = (".pdf", ".png", ".jpg", ".jpeg", ".webp")


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


@router.post("/postmark")
async def postmark_inbound(
    request: Request, background_tasks: BackgroundTasks, authorization: str | None = Header(default=None)
):
    # Public endpoint — app-wide Basic Auth proves it's our configured Postmark webhook. Always
    # returns 200 (even on rejection/no-match) so we never leak tenant existence or trigger retries.
    if not _authorized(authorization):
        return {"status": "unauthorized"}

    try:
        raw = await request.json()
    except ValueError:
        return {"status": "ignored"}

    email = parse_postmark_payload(raw)
    local_part = email.to_address.split("@")[0].strip().lower()
    if not local_part or not email.attachments:
        return {"status": "no_op"}

    db: Session = next(get_db())
    try:
        # Find the tenant's email Gadget Link by its generated inbound local-part.
        link = (
            db.query(TenantGadgetLink)
            .join(Gadget, Gadget.id == TenantGadgetLink.gadget_id)
            .filter(Gadget.category == "email", TenantGadgetLink.config["inbound_local_part"].astext == local_part)
            .first()
        )
        if link is None:
            return {"status": "no_match"}

        # Which Sydekyks did this tenant point at this inbox?
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
            return {"status": "no_sydekyk"}

        count = 0
        for sydekyk in rows:
            for att in email.attachments:
                if att.content_type not in _ALLOWED_TYPES and not att.filename.lower().endswith(_ALLOWED_EXTS):
                    continue
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
                )
                background_tasks.add_task(run_mission, mission.id)
                count += 1

        return {"status": "accepted", "missions": count}
    finally:
        db.close()
