import secrets
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.crypto import decrypt_secret, encrypt_secret
from app.core.deps import require_tenant_member
from app.db.session import get_db
from app.services import permissions, postmark_config
from app.services.email_ingest.addressing import build_inbound_local_part
from app.models.gadget import Gadget, TenantGadgetLink
from app.models.gadget_requirement import SydekykGadgetRequirement, TenantSydekykGadgetAssignment
from app.models.llm_provider import TenantSydekykLLMConfig
from app.models.sydekyk import Sydekyk
from app.models.user import User

from app.sydekyks.ledger import insights as insights_svc
from app.sydekyks.ledger import readiness as readiness_svc
from app.sydekyks.ledger.models import LedgerTenantSettings
from app.sydekyks.ledger.playbook import PLAYBOOK_KEY, PLAYBOOK_STEPS
from app.sydekyks.ledger.schemas import (
    EmailInboxCreate,
    EmailInboxOut,
    LedgerInsightsOut,
    LedgerPlaybook,
    LedgerReadiness,
    LedgerSettingsOut,
    LedgerSettingsUpdate,
    VisionTestResult,
)

router = APIRouter(prefix="/api/tenant/ledger", tags=["ledger"], dependencies=[Depends(require_tenant_member)])


def _ledger_sydekyk(db: Session, user: User) -> Sydekyk:
    sydekyk = (
        db.query(Sydekyk)
        .filter(
            Sydekyk.slug == "ledger",
            Sydekyk.is_published.is_(True),
            or_(Sydekyk.tenant_id.is_(None), Sydekyk.tenant_id == user.tenant_id),
        )
        .first()
    )
    if sydekyk is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ledger Sydekyk not found")
    return sydekyk


def _settings(db: Session, tenant_id) -> LedgerTenantSettings:
    s = db.query(LedgerTenantSettings).filter(LedgerTenantSettings.tenant_id == tenant_id).first()
    if s is None:
        s = LedgerTenantSettings(tenant_id=tenant_id)
        db.add(s)
        db.commit()
        db.refresh(s)
    return s


def _settings_out(s: LedgerTenantSettings) -> LedgerSettingsOut:
    return LedgerSettingsOut(
        auto_create_partner=s.auto_create_partner,
        auto_post_enabled=s.auto_post_enabled,
        auto_post_threshold=s.auto_post_threshold,
        purchase_order_match_enabled=s.purchase_order_match_enabled,
        ledger_vision_ok=s.ledger_vision_ok,
        ledger_vision_tested_at=s.ledger_vision_tested_at.isoformat() if s.ledger_vision_tested_at else None,
        estimated_hourly_wage=s.estimated_hourly_wage,
        estimated_minutes_per_bill=s.estimated_minutes_per_bill,
    )


@router.get("/settings", response_model=LedgerSettingsOut)
def get_settings(user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    return _settings_out(_settings(db, user.tenant_id))


@router.put("/settings", response_model=LedgerSettingsOut)
def update_settings(
    payload: LedgerSettingsUpdate, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)
):
    permissions.assert_can_configure(db, user, _ledger_sydekyk(db, user).id)
    s = _settings(db, user.tenant_id)
    s.auto_create_partner = payload.auto_create_partner
    s.auto_post_enabled = payload.auto_post_enabled
    s.auto_post_threshold = payload.auto_post_threshold
    s.purchase_order_match_enabled = payload.purchase_order_match_enabled
    s.estimated_hourly_wage = payload.estimated_hourly_wage
    s.estimated_minutes_per_bill = payload.estimated_minutes_per_bill
    db.commit()
    db.refresh(s)
    return _settings_out(s)


@router.get("/insights", response_model=LedgerInsightsOut)
def get_insights(user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    """Dashboard trend + estimated-$-saved data (VS wow-dashboard)."""
    sydekyk = _ledger_sydekyk(db, user)
    activated = insights_svc.ledger_activated(db, user.tenant_id, sydekyk.id)
    data = insights_svc.compute_insights(db, user.tenant_id, sydekyk.id)
    return LedgerInsightsOut(activated=activated, **data)


@router.get("/readiness", response_model=LedgerReadiness)
def get_readiness(user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    sydekyk = _ledger_sydekyk(db, user)
    return LedgerReadiness(**readiness_svc.compute_readiness(db, user.tenant_id, sydekyk.id))


@router.get("/playbook", response_model=LedgerPlaybook)
def get_playbook(user: User = Depends(require_tenant_member)):
    return LedgerPlaybook(playbook_key=PLAYBOOK_KEY, editable=False, steps=PLAYBOOK_STEPS)


def _sample_invoice_png() -> bytes | None:
    """Render a small but real invoice image the vision model can actually read (VS-12)."""
    try:
        import io

        from PIL import Image, ImageDraw
    except ImportError:
        return None
    img = Image.new("RGB", (500, 320), "white")
    d = ImageDraw.Draw(img)
    lines = [
        "ACME SUPPLIES LLC",
        "INVOICE",
        "Invoice #: INV-2026-0042",
        "Date: 2026-07-01",
        "Bill To: Sydekyks HQ",
        "",
        "Widget A    2 x 25.00    50.00",
        "Widget B    1 x 30.00    30.00",
        "",
        "Subtotal: 80.00",
        "Tax:      8.00",
        "TOTAL:   88.00 USD",
    ]
    y = 12
    for line in lines:
        d.text((16, y), line, fill="black")
        y += 24
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


@router.post("/vision-test", response_model=VisionTestResult)
def vision_test(user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    """Validate that the configured engine can actually read a bill, against a bundled sample (VS-12).
    Persists the result on Ledger settings so readiness can gate on it."""
    sydekyk = _ledger_sydekyk(db, user)
    permissions.assert_can_configure(db, user, sydekyk.id)
    llm = (
        db.query(TenantSydekykLLMConfig)
        .filter(TenantSydekykLLMConfig.tenant_id == user.tenant_id, TenantSydekykLLMConfig.sydekyk_id == sydekyk.id)
        .first()
    )
    if llm is None or not llm.litellm_virtual_key_encrypted or not llm.litellm_model_alias:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Configure an AI engine for Ledger first")

    sample = _sample_invoice_png()
    if sample is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail="Sample invoice generator unavailable (Pillow not installed)")

    from app.sydekyks.ledger import extraction

    virtual_key = decrypt_secret(llm.litellm_virtual_key_encrypted)
    image_uris, img_err = extraction.document_to_image_uris(sample, "image/png")
    if img_err:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=img_err)
    ok, msg, bill, _meta = extraction.extract_bill_data(virtual_key, llm.litellm_model_alias, image_uris)
    passed = bool(ok and bill is not None)

    s = _settings(db, user.tenant_id)
    s.ledger_vision_ok = passed
    s.ledger_vision_tested_at = datetime.now(timezone.utc)
    db.commit()

    if passed:
        return VisionTestResult(ok=True, message=f"Read the sample invoice (vendor: {bill.vendor_name}). Ready.")
    return VisionTestResult(ok=False, message=f"This engine couldn't read the sample invoice. {msg}")


@router.post("/email-inbox", response_model=EmailInboxOut, status_code=status.HTTP_201_CREATED)
def create_email_inbox(
    payload: EmailInboxCreate, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)
):
    """Composed create-and-assign (VS-2): create an email Gadget Link and assign it to Ledger's
    `inbox` requirement in one transaction, so the tenant never lands in a half-configured state."""
    sydekyk = _ledger_sydekyk(db, user)
    permissions.assert_can_configure(db, user, sydekyk.id)
    gadget = db.query(Gadget).filter(Gadget.slug == "email").first()
    if gadget is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Email Gadget not available")

    req = (
        db.query(SydekykGadgetRequirement)
        .filter(SydekykGadgetRequirement.sydekyk_id == sydekyk.id, SydekykGadgetRequirement.role_key == "inbox")
        .first()
    )
    if req is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Ledger has no email requirement")

    tenant_slug = user.tenant.slug if user.tenant else "hq"
    link = TenantGadgetLink(
        tenant_id=user.tenant_id,
        gadget_id=gadget.id,
        name=payload.name,
        config={
            "provider": "postmark",
            "inbound_local_part": build_inbound_local_part(tenant_slug, "ledger"),
            "inbound_domain": postmark_config.get_inbound_domain(db),
        },
        encrypted_secret=encrypt_secret(secrets.token_urlsafe(24)),
        status="connected",
    )
    db.add(link)
    db.flush()

    assignment = (
        db.query(TenantSydekykGadgetAssignment)
        .filter(
            TenantSydekykGadgetAssignment.tenant_id == user.tenant_id,
            TenantSydekykGadgetAssignment.requirement_id == req.id,
        )
        .first()
    )
    if assignment is None:
        db.add(TenantSydekykGadgetAssignment(tenant_id=user.tenant_id, requirement_id=req.id, gadget_link_id=link.id))
    else:
        assignment.gadget_link_id = link.id
    db.commit()
    db.refresh(link)

    addr = f"{link.config['inbound_local_part']}@{link.config['inbound_domain']}"
    return EmailInboxOut(link_id=str(link.id), inbound_address=addr)
