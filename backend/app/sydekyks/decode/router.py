import secrets

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.config import settings as app_settings
from app.core.crypto import decrypt_secret, encrypt_secret
from app.core.deps import require_tenant_member
from app.db.session import get_db
from app.models.gadget import Gadget, TenantGadgetLink
from app.models.gadget_requirement import SydekykGadgetRequirement, TenantSydekykGadgetAssignment
from app.models.sydekyk import Sydekyk
from app.models.user import User
from app.services import gadget_links, odoo, odoo_hr, permissions

from app.sydekyks.decode import insights as insights_svc
from app.sydekyks.decode import readiness as readiness_svc
from app.sydekyks.decode.models import DecodeTenantSettings
from app.sydekyks.decode.playbook import PLAYBOOK_KEY, PLAYBOOK_STEPS
from app.sydekyks.decode.schemas import (
    DecodeInsightsOut,
    DecodeJob,
    DecodeJobsOut,
    DecodePlaybook,
    DecodeReadiness,
    DecodeSettingsOut,
    DecodeSettingsUpdate,
    EmailInboxCreate,
    EmailInboxOut,
)

router = APIRouter(prefix="/api/tenant/decode", tags=["decode"], dependencies=[Depends(require_tenant_member)])


def _decode_sydekyk(db: Session, user: User) -> Sydekyk:
    sydekyk = (
        db.query(Sydekyk)
        .filter(
            Sydekyk.slug == "decode",
            Sydekyk.is_published.is_(True),
            or_(Sydekyk.tenant_id.is_(None), Sydekyk.tenant_id == user.tenant_id),
        )
        .first()
    )
    if sydekyk is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Decode Sydekyk not found")
    return sydekyk


def _settings(db: Session, tenant_id) -> DecodeTenantSettings:
    s = db.query(DecodeTenantSettings).filter(DecodeTenantSettings.tenant_id == tenant_id).first()
    if s is None:
        s = DecodeTenantSettings(tenant_id=tenant_id)
        db.add(s)
        db.commit()
        db.refresh(s)
    return s


def _settings_out(s: DecodeTenantSettings) -> DecodeSettingsOut:
    return DecodeSettingsOut(
        auto_create_skills=s.auto_create_skills, processed_tag_name=s.processed_tag_name,
        pooling_stage_name=s.pooling_stage_name, max_resume_pages=s.max_resume_pages,
        cron_enabled=s.cron_enabled, cron_poll_limit=s.cron_poll_limit,
    )


@router.get("/settings", response_model=DecodeSettingsOut)
def get_settings(user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    return _settings_out(_settings(db, user.tenant_id))


@router.put("/settings", response_model=DecodeSettingsOut)
def update_settings(payload: DecodeSettingsUpdate, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    permissions.assert_can_configure(db, user, _decode_sydekyk(db, user).id)
    s = _settings(db, user.tenant_id)
    s.auto_create_skills = payload.auto_create_skills
    s.processed_tag_name = payload.processed_tag_name
    s.pooling_stage_name = payload.pooling_stage_name
    s.max_resume_pages = payload.max_resume_pages
    s.cron_enabled = payload.cron_enabled
    s.cron_poll_limit = payload.cron_poll_limit
    db.commit()
    db.refresh(s)
    return _settings_out(s)


@router.get("/insights", response_model=DecodeInsightsOut)
def get_insights(user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    sydekyk = _decode_sydekyk(db, user)
    activated = insights_svc.decode_activated(db, user.tenant_id, sydekyk.id)
    return DecodeInsightsOut(activated=activated, **insights_svc.compute_insights(db, user.tenant_id, sydekyk.id))


@router.get("/readiness", response_model=DecodeReadiness)
def get_readiness(user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    sydekyk = _decode_sydekyk(db, user)
    return DecodeReadiness(**readiness_svc.compute_readiness(db, user.tenant_id, sydekyk.id))


@router.get("/playbook", response_model=DecodePlaybook)
def get_playbook(user: User = Depends(require_tenant_member)):
    return DecodePlaybook(playbook_key=PLAYBOOK_KEY, editable=False, steps=PLAYBOOK_STEPS)


@router.get("/jobs", response_model=DecodeJobsOut)
def list_odoo_jobs(user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    """Open positions from the tenant's assigned Odoo (hr.job), for the upload job-picker.
    Refreshable from the UI; degrades to an empty list + message when Odoo isn't reachable."""
    sydekyk = _decode_sydekyk(db, user)
    link = gadget_links.find_assigned_link(db, tenant_id=user.tenant_id, sydekyk_id=sydekyk.id, role_key="erp")
    if link is None:
        return DecodeJobsOut(connected=False, jobs=[], message="No Odoo instance assigned to Decode.")
    ok, msg, client = odoo.connect(link.url, link.database, link.username, decrypt_secret(link.encrypted_secret))
    if not ok or client is None:
        return DecodeJobsOut(connected=False, jobs=[], message=msg)
    try:
        jobs = odoo_hr.list_jobs(client)
    except odoo.OdooError as exc:
        return DecodeJobsOut(connected=False, jobs=[], message=str(exc))
    return DecodeJobsOut(connected=True, jobs=[DecodeJob(id=j["id"], name=j["name"]) for j in jobs])


@router.post("/email-inbox", response_model=EmailInboxOut, status_code=status.HTTP_201_CREATED)
def create_email_inbox(payload: EmailInboxCreate, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    """Create an email Gadget Link and assign it to Decode's `inbox` requirement in one step."""
    sydekyk = _decode_sydekyk(db, user)
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
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Decode has no email requirement")

    tenant_slug = user.tenant.slug if user.tenant else "hq"
    link = TenantGadgetLink(
        tenant_id=user.tenant_id, gadget_id=gadget.id, name=payload.name,
        config={
            "provider": "postmark",
            "inbound_local_part": f"{tenant_slug}-{secrets.token_hex(4)}",
            "inbound_domain": app_settings.email_inbound_domain,
        },
        encrypted_secret=encrypt_secret(secrets.token_urlsafe(24)), status="connected",
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

    cfg = link.config or {}
    return EmailInboxOut(link_id=str(link.id), inbound_address=f"{cfg['inbound_local_part']}@{cfg['inbound_domain']}")
