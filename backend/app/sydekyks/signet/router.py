import uuid

from fastapi import APIRouter, Depends, HTTPException, Response, UploadFile, status
from sqlalchemy.orm import Session

from app.core.deps import require_tenant_member
from app.db.session import get_db
from app.models.sydekyk import Sydekyk
from app.models.user import User
from app.schemas.mission import MissionStartOut
from app.services import permissions
from app.services.missions import create_mission
from app.services.queue import enqueue_mission

from app.sydekyks.seal.export import render_contract_pdf
from app.sydekyks.seal.models import SealContract
from app.sydekyks.signet import insights as insights_svc
from app.sydekyks.signet import readiness as readiness_svc
from app.sydekyks.signet import service
from app.sydekyks.signet.models import (
    SignetAsset,
    SignetEnvelope,
    SignetEvent,
    SignetSigner,
    SignetTenantSettings,
)
from app.sydekyks.signet.playbook import PLAYBOOK_KEY, PLAYBOOK_KEY_REMIND, PLAYBOOK_STEPS
from app.sydekyks.signet.schemas import (
    EnvelopeCreate,
    EnvelopeOut,
    EnvelopePage,
    EnvelopeSummary,
    EventOut,
    HoldIn,
    SignetInsightsOut,
    SignetPlaybook,
    SignetReadiness,
    SignetSettingsOut,
    SignetSettingsUpdate,
    SignerOut,
)

router = APIRouter(prefix="/api/tenant/signet", tags=["signet"], dependencies=[Depends(require_tenant_member)])

_MAX_PDF_BYTES = 20 * 1024 * 1024


def _signet(db: Session, user: User) -> Sydekyk:
    from sqlalchemy import or_

    sydekyk = (
        db.query(Sydekyk)
        .filter(Sydekyk.slug == "signet", Sydekyk.is_published.is_(True),
                or_(Sydekyk.tenant_id.is_(None), Sydekyk.tenant_id == user.tenant_id))
        .first()
    )
    if sydekyk is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Signet Sydekyk not found")
    return sydekyk


def _settings(db: Session, tenant_id) -> SignetTenantSettings:
    s = db.query(SignetTenantSettings).filter(SignetTenantSettings.tenant_id == tenant_id).first()
    if s is None:
        s = SignetTenantSettings(tenant_id=tenant_id)
        db.add(s)
        db.commit()
        db.refresh(s)
    return s


def _sees_all(db: Session, user: User, sydekyk_id: uuid.UUID) -> bool:
    return permissions.can_configure(db, user, sydekyk_id)


def _envelope_or_404(db: Session, user: User, sydekyk_id: uuid.UUID, envelope_id: uuid.UUID) -> SignetEnvelope:
    row = db.get(SignetEnvelope, envelope_id)
    if row is None or row.tenant_id != user.tenant_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Envelope not found")
    if not _sees_all(db, user, sydekyk_id) and row.created_by != user.email:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Envelope not found")
    return row


def _signers(db: Session, envelope: SignetEnvelope) -> list[SignetSigner]:
    return (
        db.query(SignetSigner)
        .filter(SignetSigner.envelope_id == envelope.id)
        .order_by(SignetSigner.order.asc(), SignetSigner.created_at.asc())
        .all()
    )


def _envelope_out(db: Session, envelope: SignetEnvelope) -> EnvelopeOut:
    signers = _signers(db, envelope)
    events = (
        db.query(SignetEvent)
        .filter(SignetEvent.envelope_id == envelope.id)
        .order_by(SignetEvent.created_at.asc())
        .all()
    )
    return EnvelopeOut(
        id=envelope.id, title=envelope.title, message=envelope.message, status=envelope.status,
        signing_order=envelope.signing_order, reminder_interval_days=envelope.reminder_interval_days,
        max_reminders=envelope.max_reminders, email_copy_mode=envelope.email_copy_mode,
        email_prompt=envelope.email_prompt, hold=envelope.hold, expires_at=envelope.expires_at,
        seal_contract_id=envelope.seal_contract_id, has_signed_pdf=bool(envelope.signed_pdf_asset_id),
        signers=[SignerOut(
            id=s.id, name=s.name, email=s.email, order=s.order, status=s.status,
            signed_at=s.signed_at, viewed_at=s.viewed_at, reminder_count=s.reminder_count,
            decline_reason=s.decline_reason,
        ) for s in signers],
        events=[EventOut(id=e.id, event_type=e.event_type, detail=e.detail, created_at=e.created_at) for e in events],
        created_by=envelope.created_by, sent_at=envelope.sent_at, completed_at=envelope.completed_at,
        updated_at=envelope.updated_at,
    )


# --- Settings / readiness / playbook / insights ----------------------------------------------------

@router.get("/settings", response_model=SignetSettingsOut)
def get_settings(user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    s = _settings(db, user.tenant_id)
    return SignetSettingsOut(
        sender_name=s.sender_name, reminder_interval_days=s.reminder_interval_days,
        max_reminders=s.max_reminders, expiry_days=s.expiry_days, email_copy_mode=s.email_copy_mode,
        email_prompt=s.email_prompt, estimated_hourly_wage=s.estimated_hourly_wage,
        estimated_minutes_per_signature=s.estimated_minutes_per_signature,
    )


@router.put("/settings", response_model=SignetSettingsOut)
def update_settings(payload: SignetSettingsUpdate, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    permissions.assert_can_configure(db, user, _signet(db, user).id)
    s = _settings(db, user.tenant_id)
    s.sender_name = payload.sender_name
    s.reminder_interval_days = payload.reminder_interval_days
    s.max_reminders = payload.max_reminders
    s.expiry_days = payload.expiry_days
    s.email_copy_mode = payload.email_copy_mode
    s.email_prompt = payload.email_prompt
    s.estimated_hourly_wage = payload.estimated_hourly_wage
    s.estimated_minutes_per_signature = payload.estimated_minutes_per_signature
    db.commit()
    return get_settings(user, db)


@router.get("/readiness", response_model=SignetReadiness)
def get_readiness(user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    return SignetReadiness(**readiness_svc.compute_readiness(db, user.tenant_id, _signet(db, user).id))


@router.get("/playbook", response_model=SignetPlaybook)
def get_playbook(user: User = Depends(require_tenant_member)):
    return SignetPlaybook(playbook_key=PLAYBOOK_KEY, editable=False, steps=PLAYBOOK_STEPS)


@router.get("/insights", response_model=SignetInsightsOut)
def get_insights(user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    sydekyk = _signet(db, user)
    activated = insights_svc.signet_activated(db, user.tenant_id, sydekyk.id)
    return SignetInsightsOut(activated=activated, **insights_svc.compute_insights(db, user.tenant_id, sydekyk.id))


# --- Envelopes -------------------------------------------------------------------------------------

@router.get("/envelopes", response_model=EnvelopePage)
def list_envelopes(limit: int = 20, offset: int = 0, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    limit = max(1, min(limit, 100))
    offset = max(0, offset)
    sydekyk = _signet(db, user)
    sees_all = _sees_all(db, user, sydekyk.id)
    base = db.query(SignetEnvelope).filter(SignetEnvelope.tenant_id == user.tenant_id,
                                           SignetEnvelope.sydekyk_id == sydekyk.id)
    if not sees_all:
        base = base.filter(SignetEnvelope.created_by == user.email)
    total = base.count()
    rows = base.order_by(SignetEnvelope.updated_at.desc()).limit(limit).offset(offset).all()
    items = []
    for r in rows:
        signers = _signers(db, r)
        items.append(EnvelopeSummary(
            id=r.id, title=r.title, status=r.status,
            signed_count=sum(1 for s in signers if s.status == "signed"), signer_count=len(signers),
            hold=r.hold, owned_by=r.created_by, updated_at=r.updated_at,
        ))
    return EnvelopePage(items=items, total=total, limit=limit, offset=offset, sees_all=sees_all)


@router.post("/envelopes", response_model=EnvelopeOut, status_code=status.HTTP_201_CREATED)
def create_envelope(payload: EnvelopeCreate, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    sydekyk = _signet(db, user)
    permissions.assert_can_use(db, user, sydekyk.id)
    # Requires Seal installed (Signet consumes its contracts); auto-install both.
    service.ensure_installed(db, user.tenant_id, "seal")
    service.ensure_installed(db, user.tenant_id, "signet")

    settings = _settings(db, user.tenant_id)
    title = payload.title.strip()
    source_asset_id = None
    seal_contract_id = payload.seal_contract_id

    if seal_contract_id is not None:
        contract = db.get(SealContract, seal_contract_id)
        if contract is None or contract.tenant_id != user.tenant_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contract not found")
        if not title:
            title = contract.title
        try:
            pdf_bytes = render_contract_pdf(db, user.tenant_id, contract)
        except RuntimeError as exc:
            raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail=str(exc))
        asset = SignetAsset(tenant_id=user.tenant_id, kind="source", filename=f"{title or 'contract'}.pdf",
                            content_type="application/pdf", size_bytes=len(pdf_bytes), content=pdf_bytes)
        db.add(asset)
        db.flush()
        source_asset_id = asset.id

    envelope = SignetEnvelope(
        tenant_id=user.tenant_id, sydekyk_id=sydekyk.id, seal_contract_id=seal_contract_id,
        title=title or "Untitled document", message=payload.message, source_asset_id=source_asset_id,
        signing_order=payload.signing_order,
        reminder_interval_days=payload.reminder_interval_days or settings.reminder_interval_days,
        max_reminders=payload.max_reminders if payload.max_reminders is not None else settings.max_reminders,
        email_copy_mode=payload.email_copy_mode or settings.email_copy_mode,
        email_prompt=payload.email_prompt or settings.email_prompt,
        created_by=user.email,
    )
    db.add(envelope)
    db.flush()
    if source_asset_id is not None:
        db.get(SignetAsset, source_asset_id).envelope_id = envelope.id
    for i, signer in enumerate(payload.signers):
        raw, token_hash, token_enc = service.mint_token()
        db.add(SignetSigner(
            tenant_id=user.tenant_id, envelope_id=envelope.id, name=signer.name, email=str(signer.email),
            order=i, token_hash=token_hash, token_encrypted=token_enc,
        ))
    db.commit()
    db.refresh(envelope)
    service.log_event(db, envelope=envelope, event_type="created", detail=f"{len(payload.signers)} signer(s)")
    return _envelope_out(db, envelope)


@router.post("/envelopes/{envelope_id}/source", response_model=EnvelopeOut)
async def upload_source(envelope_id: uuid.UUID, file: UploadFile, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    """Attach an uploaded PDF as the envelope's source document (for envelopes not sourced from Seal)."""
    permissions.assert_can_use(db, user, _signet(db, user).id)
    envelope = _envelope_or_404(db, user, _signet(db, user).id, envelope_id)
    if envelope.status != "draft":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="The envelope has already been sent")
    data = await file.read()
    if (file.content_type or "") != "application/pdf":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Upload a PDF document")
    if len(data) > _MAX_PDF_BYTES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="PDF exceeds the 20MB limit")
    asset = SignetAsset(tenant_id=user.tenant_id, envelope_id=envelope.id, kind="source",
                        filename=(file.filename or "document.pdf"), content_type="application/pdf",
                        size_bytes=len(data), content=data)
    db.add(asset)
    db.flush()
    envelope.source_asset_id = asset.id
    db.commit()
    db.refresh(envelope)
    return _envelope_out(db, envelope)


@router.get("/envelopes/{envelope_id}", response_model=EnvelopeOut)
def get_envelope(envelope_id: uuid.UUID, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    return _envelope_out(db, _envelope_or_404(db, user, _signet(db, user).id, envelope_id))


@router.post(
    "/envelopes/{envelope_id}/send",
    response_model=MissionStartOut,
    status_code=status.HTTP_202_ACCEPTED,
)
async def send_envelope(envelope_id: uuid.UUID, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    sydekyk = _signet(db, user)
    permissions.assert_can_use(db, user, sydekyk.id)
    envelope = _envelope_or_404(db, user, sydekyk.id, envelope_id)
    if envelope.status != "draft":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This envelope has already been sent")
    if not envelope.source_asset_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Attach a source document before sending")
    mission = create_mission(
        db, tenant_id=user.tenant_id, sydekyk=sydekyk, user_id=user.id,
        source="manual", signal_type="manual", trigger_context={"envelope_id": str(envelope.id)},
        playbook_key=PLAYBOOK_KEY,
    )
    await enqueue_mission(mission.id)
    return MissionStartOut(mission_id=mission.id)


@router.post(
    "/envelopes/{envelope_id}/remind",
    response_model=MissionStartOut,
    status_code=status.HTTP_202_ACCEPTED,
)
async def remind_envelope(envelope_id: uuid.UUID, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    sydekyk = _signet(db, user)
    permissions.assert_can_use(db, user, sydekyk.id)
    envelope = _envelope_or_404(db, user, sydekyk.id, envelope_id)
    mission = create_mission(
        db, tenant_id=user.tenant_id, sydekyk=sydekyk, user_id=user.id,
        source="manual", signal_type="manual", trigger_context={"envelope_id": str(envelope.id)},
        playbook_key=PLAYBOOK_KEY_REMIND,
    )
    await enqueue_mission(mission.id)
    return MissionStartOut(mission_id=mission.id)


@router.post("/envelopes/{envelope_id}/hold", response_model=EnvelopeOut)
def set_hold(envelope_id: uuid.UUID, payload: HoldIn, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    permissions.assert_can_use(db, user, _signet(db, user).id)
    envelope = _envelope_or_404(db, user, _signet(db, user).id, envelope_id)
    envelope.hold = payload.hold
    db.commit()
    service.log_event(db, envelope=envelope, event_type="held",
                      detail=("Placed on hold" if payload.hold else "Hold released"))
    db.refresh(envelope)
    return _envelope_out(db, envelope)


@router.post("/envelopes/{envelope_id}/void", response_model=EnvelopeOut)
def void_envelope(envelope_id: uuid.UUID, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    permissions.assert_can_use(db, user, _signet(db, user).id)
    envelope = _envelope_or_404(db, user, _signet(db, user).id, envelope_id)
    if envelope.status == "completed":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A completed envelope can't be voided")
    envelope.status = "voided"
    envelope.hold = True
    db.commit()
    service.log_event(db, envelope=envelope, event_type="voided", detail="Voided by sender")
    db.refresh(envelope)
    return _envelope_out(db, envelope)


@router.delete("/envelopes/{envelope_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_envelope(envelope_id: uuid.UUID, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    permissions.assert_can_use(db, user, _signet(db, user).id)
    envelope = _envelope_or_404(db, user, _signet(db, user).id, envelope_id)
    db.delete(envelope)
    db.commit()


@router.get("/envelopes/{envelope_id}/signed-pdf")
def download_signed_pdf(envelope_id: uuid.UUID, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    envelope = _envelope_or_404(db, user, _signet(db, user).id, envelope_id)
    if not envelope.signed_pdf_asset_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No signed PDF yet")
    asset = db.get(SignetAsset, envelope.signed_pdf_asset_id)
    if asset is None or asset.tenant_id != user.tenant_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No signed PDF yet")
    filename = (envelope.title or "contract").strip().replace('"', "") + "-signed.pdf"
    return Response(content=asset.content, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})
