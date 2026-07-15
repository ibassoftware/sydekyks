import base64
import re
import uuid

from fastapi import APIRouter, Depends, HTTPException, Response, UploadFile, status
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.core.crypto import decrypt_secret
from app.core.deps import require_tenant_member
from app.db.session import get_db
from app.models.sydekyk import Sydekyk
from app.models.usage_record import UsageRecord
from app.models.user import User
from app.services import gadget_links, odoo, odoo_crm, odoo_sign, permissions, vision_ai
from app.services.missions import create_mission, run_mission

from app.sydekyks.seal import export
from app.sydekyks.seal import insights as insights_svc
from app.sydekyks.seal import readiness as readiness_svc
from app.sydekyks.seal.models import (
    SealAsset,
    SealChatMessage,
    SealContract,
    SealReviewFinding,
    SealTemplate,
    SealTenantSettings,
)
from app.sydekyks.seal.playbook import (
    PLAYBOOK_KEY,
    PLAYBOOK_KEY_REFINE,
    PLAYBOOK_KEY_REVIEW,
    PLAYBOOK_STEPS,
    html_to_text,
)
from app.sydekyks.seal.schemas import (
    AssetOut,
    ChatHistoryOut,
    ChatIn,
    ChatMessageOut,
    ChatOut,
    ContractCreate,
    ContractOut,
    ContractPage,
    ContractSummary,
    ContractUpdate,
    FindingDecisionIn,
    FindingDecisionOut,
    FindingOut,
    GenerateIn,
    ImportOut,
    OpportunityOut,
    ReviewOut,
    SealInsightsOut,
    SealPlaybook,
    SealReadiness,
    SealSettingsOut,
    SealSettingsUpdate,
    SignRequestOut,
    TemplateCreate,
    TemplateOut,
    TemplateSummary,
    TemplateUpdate,
    TurnTokens,
)

router = APIRouter(prefix="/api/tenant/seal", tags=["seal"], dependencies=[Depends(require_tenant_member)])

_MAX_IMAGE_BYTES = 8 * 1024 * 1024
_ALLOWED_IMAGE_TYPES = {"image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"}
_MAX_IMPORT_BYTES = 15 * 1024 * 1024
_SEVERITY_RANK = {"high": 0, "medium": 1, "low": 2}


def _seal(db: Session, user: User) -> Sydekyk:
    sydekyk = (
        db.query(Sydekyk)
        .filter(Sydekyk.slug == "seal", Sydekyk.is_published.is_(True),
                or_(Sydekyk.tenant_id.is_(None), Sydekyk.tenant_id == user.tenant_id))
        .first()
    )
    if sydekyk is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Seal Sydekyk not found")
    return sydekyk


def _settings(db: Session, tenant_id) -> SealTenantSettings:
    s = db.query(SealTenantSettings).filter(SealTenantSettings.tenant_id == tenant_id).first()
    if s is None:
        s = SealTenantSettings(tenant_id=tenant_id)
        db.add(s)
        db.commit()
        db.refresh(s)
    return s


def _connect(db: Session, tenant_id, sydekyk_id):
    link = gadget_links.find_assigned_link(db, tenant_id=tenant_id, sydekyk_id=sydekyk_id, role_key="erp")
    if link is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="No Odoo instance assigned to Seal")
    ok, msg, client = odoo.connect(link.url, link.database, link.username, decrypt_secret(link.encrypted_secret))
    if not ok or client is None:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=msg or "Odoo connection failed")
    return client


def _sees_all(db: Session, user: User, sydekyk_id: uuid.UUID) -> bool:
    """A manager (Commander, or a hero granted 'configure') sees/edits every contract in the HQ; a
    plain 'use' drafter is scoped to the contracts they created."""
    return permissions.can_configure(db, user, sydekyk_id)


def _contract_or_404(db: Session, user: User, sydekyk_id: uuid.UUID, contract_id: uuid.UUID) -> SealContract:
    row = db.get(SealContract, contract_id)
    if row is None or row.tenant_id != user.tenant_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contract not found")
    if not _sees_all(db, user, sydekyk_id) and row.created_by != user.email:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contract not found")
    return row


def _contract_tokens(db: Session, contract: SealContract) -> tuple[int, float]:
    """Total tokens + AI cost spent on this contract — its draft mission + every refine/review mission."""
    mission_ids = set()
    if contract.mission_id:
        mission_ids.add(contract.mission_id)
    for (mid,) in (
        db.query(SealChatMessage.mission_id)
        .filter(SealChatMessage.contract_id == contract.id, SealChatMessage.mission_id.isnot(None))
        .distinct().all()
    ):
        mission_ids.add(mid)
    for (mid,) in (
        db.query(SealReviewFinding.mission_id)
        .filter(SealReviewFinding.contract_id == contract.id, SealReviewFinding.mission_id.isnot(None))
        .distinct().all()
    ):
        mission_ids.add(mid)
    if not mission_ids:
        return 0, 0.0
    row = (
        db.query(
            func.coalesce(func.sum(UsageRecord.total_tokens), 0),
            func.coalesce(func.sum(UsageRecord.cost_usd), 0.0),
        )
        .filter(UsageRecord.mission_id.in_(mission_ids))
        .first()
    )
    return (int(row[0]), round(float(row[1]), 4)) if row else (0, 0.0)


def _open_findings_count(db: Session, contract: SealContract) -> int:
    if not contract.review_seq:
        return 0
    return (
        db.query(func.count(SealReviewFinding.id))
        .filter(SealReviewFinding.contract_id == contract.id,
                SealReviewFinding.review_seq == contract.review_seq,
                SealReviewFinding.status == "open")
        .scalar()
    ) or 0


def _contract_out(db: Session, contract: SealContract) -> ContractOut:
    tokens, cost = _contract_tokens(db, contract)
    return ContractOut(
        id=contract.id, title=contract.title, status=contract.status, content_html=contract.content_html,
        counterparty_name=contract.counterparty_name, template_id=contract.template_id,
        review_seq=contract.review_seq, odoo_lead_id=contract.odoo_lead_id,
        odoo_partner_id=contract.odoo_partner_id, odoo_sign_request_id=contract.odoo_sign_request_id,
        token_total=tokens, cost_usd=cost, updated_at=contract.updated_at,
    )


def _run_inline(db: Session, sydekyk: Sydekyk, user: User, playbook_key: str, ctx: dict) -> uuid.UUID:
    """Create a Mission and run it synchronously (generation/chat/review must return a result to the
    editor). Returns the mission id; the caller re-reads the mutated contract from a fresh query."""
    mission = create_mission(
        db, tenant_id=user.tenant_id, sydekyk=sydekyk, user_id=user.id,
        source="manual", signal_type="manual", trigger_context=ctx,
    )
    if mission.playbook_key != playbook_key:
        mission.playbook_key = playbook_key
        db.commit()
    mid = mission.id
    run_mission(mid)
    db.expire_all()
    return mid


def _mission_summary(db: Session, mission_id: uuid.UUID) -> dict | None:
    from app.models.mission import Mission

    m = db.get(Mission, mission_id)
    return (m.result_summary or {}) if m else None


def _raise_if_mission_failed(db: Session, mission_id: uuid.UUID) -> None:
    from app.models.mission import Mission

    m = db.get(Mission, mission_id)
    if m is None:
        return
    if m.status == "failed":
        code = status.HTTP_429_TOO_MANY_REQUESTS if m.failure_category == "quota" else status.HTTP_400_BAD_REQUEST
        raise HTTPException(status_code=code, detail=m.error_message or "The AI step failed")


# --- Settings / readiness / playbook / insights ----------------------------------------------------

@router.get("/settings", response_model=SealSettingsOut)
def get_settings(user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    s = _settings(db, user.tenant_id)
    return SealSettingsOut(
        default_template_id=s.default_template_id, review_guidelines=s.review_guidelines,
        page_size=s.page_size, accent_color=s.accent_color, header_text=s.header_text,
        footer_text=s.footer_text, estimated_hourly_wage=s.estimated_hourly_wage,
        estimated_minutes_per_contract=s.estimated_minutes_per_contract,
    )


@router.put("/settings", response_model=SealSettingsOut)
def update_settings(payload: SealSettingsUpdate, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    permissions.assert_can_configure(db, user, _seal(db, user).id)
    s = _settings(db, user.tenant_id)
    s.default_template_id = payload.default_template_id
    s.review_guidelines = payload.review_guidelines
    s.page_size = payload.page_size
    s.accent_color = payload.accent_color
    s.header_text = payload.header_text
    s.footer_text = payload.footer_text
    s.estimated_hourly_wage = payload.estimated_hourly_wage
    s.estimated_minutes_per_contract = payload.estimated_minutes_per_contract
    db.commit()
    return get_settings(user, db)


@router.get("/readiness", response_model=SealReadiness)
def get_readiness(user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    sydekyk = _seal(db, user)
    return SealReadiness(**readiness_svc.compute_readiness(db, user.tenant_id, sydekyk.id))


@router.get("/playbook", response_model=SealPlaybook)
def get_playbook(user: User = Depends(require_tenant_member)):
    return SealPlaybook(playbook_key=PLAYBOOK_KEY, editable=False, steps=PLAYBOOK_STEPS)


@router.get("/insights", response_model=SealInsightsOut)
def get_insights(user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    sydekyk = _seal(db, user)
    activated = insights_svc.seal_activated(db, user.tenant_id, sydekyk.id)
    return SealInsightsOut(activated=activated, **insights_svc.compute_insights(db, user.tenant_id, sydekyk.id))


# --- Templates -------------------------------------------------------------------------------------

@router.get("/templates", response_model=list[TemplateSummary])
def list_templates(user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    rows = (
        db.query(SealTemplate)
        .filter(or_(SealTemplate.tenant_id.is_(None), SealTemplate.tenant_id == user.tenant_id))
        .order_by(SealTemplate.is_builtin.desc(), SealTemplate.name.asc())
        .all()
    )
    return [TemplateSummary(id=r.id, name=r.name, format=r.format, is_builtin=r.is_builtin) for r in rows]


@router.get("/templates/{template_id}", response_model=TemplateOut)
def get_template(template_id: uuid.UUID, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    r = db.get(SealTemplate, template_id)
    if r is None or (r.tenant_id is not None and r.tenant_id != user.tenant_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")
    return TemplateOut(id=r.id, name=r.name, format=r.format, body=r.body, is_builtin=r.is_builtin,
                       created_by=r.created_by, updated_at=r.updated_at)


@router.post("/templates", response_model=TemplateOut, status_code=status.HTTP_201_CREATED)
def create_template(payload: TemplateCreate, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    permissions.assert_can_use(db, user, _seal(db, user).id)
    r = SealTemplate(tenant_id=user.tenant_id, name=payload.name, format=payload.format,
                     body=payload.body, is_builtin=False, created_by=user.email)
    db.add(r)
    db.commit()
    db.refresh(r)
    return TemplateOut(id=r.id, name=r.name, format=r.format, body=r.body, is_builtin=r.is_builtin,
                       created_by=r.created_by, updated_at=r.updated_at)


@router.put("/templates/{template_id}", response_model=TemplateOut)
def update_template(template_id: uuid.UUID, payload: TemplateUpdate, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    permissions.assert_can_use(db, user, _seal(db, user).id)
    r = db.get(SealTemplate, template_id)
    if r is None or r.tenant_id != user.tenant_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found or read-only")
    if payload.name is not None:
        r.name = payload.name
    if payload.body is not None:
        r.body = payload.body
    db.commit()
    db.refresh(r)
    return TemplateOut(id=r.id, name=r.name, format=r.format, body=r.body, is_builtin=r.is_builtin,
                       created_by=r.created_by, updated_at=r.updated_at)


@router.delete("/templates/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_template(template_id: uuid.UUID, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    permissions.assert_can_use(db, user, _seal(db, user).id)
    r = db.get(SealTemplate, template_id)
    if r is None or r.tenant_id != user.tenant_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found or read-only")
    db.delete(r)
    db.commit()


# --- Contracts -------------------------------------------------------------------------------------

@router.get("/contracts", response_model=ContractPage)
def list_contracts(limit: int = 20, offset: int = 0, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    limit = max(1, min(limit, 100))
    offset = max(0, offset)
    sees_all = _sees_all(db, user, _seal(db, user).id)
    base = db.query(SealContract).filter(SealContract.tenant_id == user.tenant_id)
    if not sees_all:
        base = base.filter(SealContract.created_by == user.email)
    total = base.count()
    rows = base.order_by(SealContract.updated_at.desc()).limit(limit).offset(offset).all()
    return ContractPage(
        items=[ContractSummary(id=r.id, title=r.title, status=r.status, counterparty_name=r.counterparty_name,
                               owned_by=r.created_by, open_findings=_open_findings_count(db, r),
                               updated_at=r.updated_at) for r in rows],
        total=total, limit=limit, offset=offset, sees_all=sees_all,
    )


@router.post("/contracts", response_model=ContractOut, status_code=status.HTTP_201_CREATED)
def create_contract(payload: ContractCreate, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    sydekyk = _seal(db, user)
    permissions.assert_can_use(db, user, sydekyk.id)
    content = ""
    template_id = None
    if payload.from_template_id:
        tpl = db.get(SealTemplate, payload.from_template_id)
        if tpl is not None and (tpl.tenant_id is None or tpl.tenant_id == user.tenant_id):
            template_id = tpl.id
            if tpl.format == "html":
                content = tpl.body  # md templates are best fed through Generate (converted client-side)
    r = SealContract(tenant_id=user.tenant_id, sydekyk_id=sydekyk.id, title=payload.title,
                     content_html=content, template_id=template_id, created_by=user.email)
    db.add(r)
    db.commit()
    db.refresh(r)
    return _contract_out(db, r)


@router.get("/contracts/{contract_id}", response_model=ContractOut)
def get_contract(contract_id: uuid.UUID, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    return _contract_out(db, _contract_or_404(db, user, _seal(db, user).id, contract_id))


@router.put("/contracts/{contract_id}", response_model=ContractOut)
def update_contract(contract_id: uuid.UUID, payload: ContractUpdate, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    permissions.assert_can_use(db, user, _seal(db, user).id)
    r = _contract_or_404(db, user, _seal(db, user).id, contract_id)
    if payload.title is not None:
        r.title = payload.title
    if payload.content_html is not None:
        r.content_html = payload.content_html
    if payload.status is not None:
        r.status = payload.status
    db.commit()
    db.refresh(r)
    return _contract_out(db, r)


@router.delete("/contracts/{contract_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_contract(contract_id: uuid.UUID, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    permissions.assert_can_use(db, user, _seal(db, user).id)
    r = _contract_or_404(db, user, _seal(db, user).id, contract_id)
    db.delete(r)
    db.commit()


# --- AI: generate + chat + review (metered inline missions) ----------------------------------------

@router.post("/contracts/{contract_id}/generate", response_model=ContractOut)
def generate_contract(contract_id: uuid.UUID, payload: GenerateIn, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    sydekyk = _seal(db, user)
    permissions.assert_can_use(db, user, sydekyk.id)
    contract = _contract_or_404(db, user, sydekyk.id, contract_id)
    ctx = {"contract_id": str(contract.id), "notes": payload.notes}
    if payload.template_id:
        ctx["template_id"] = str(payload.template_id)
    if payload.odoo_lead_id:
        ctx["odoo_lead_id"] = payload.odoo_lead_id
    mid = _run_inline(db, sydekyk, user, PLAYBOOK_KEY, ctx)
    _raise_if_mission_failed(db, mid)
    contract = _contract_or_404(db, user, sydekyk.id, contract_id)
    return _contract_out(db, contract)


@router.post("/contracts/{contract_id}/chat", response_model=ChatOut)
def chat(contract_id: uuid.UUID, payload: ChatIn, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    sydekyk = _seal(db, user)
    permissions.assert_can_use(db, user, sydekyk.id)
    contract = _contract_or_404(db, user, sydekyk.id, contract_id)
    ctx = {"contract_id": str(contract.id), "message": payload.message}
    mid = _run_inline(db, sydekyk, user, PLAYBOOK_KEY_REFINE, ctx)
    _raise_if_mission_failed(db, mid)
    contract = _contract_or_404(db, user, sydekyk.id, contract_id)

    assistant = (
        db.query(SealChatMessage)
        .filter(SealChatMessage.contract_id == contract.id, SealChatMessage.mission_id == mid,
                SealChatMessage.role == "assistant")
        .order_by(SealChatMessage.seq.desc())
        .first()
    )
    mission_summary = _mission_summary(db, mid)
    tokens, cost = _contract_tokens(db, contract)
    return ChatOut(
        reply=(assistant.content if assistant else "Done."),
        changed_summary=(mission_summary.get("changed") if mission_summary else "Revised the contract"),
        contract=_contract_out(db, contract),
        turn_tokens=TurnTokens(
            prompt_tokens=(assistant.prompt_tokens if assistant else 0),
            completion_tokens=(assistant.completion_tokens if assistant else 0),
            total_tokens=(assistant.total_tokens if assistant else 0),
            cost_usd=(assistant.cost_usd if assistant else 0.0),
        ),
        contract_token_total=tokens,
        contract_cost_usd=cost,
    )


@router.get("/contracts/{contract_id}/chat", response_model=ChatHistoryOut)
def get_chat(contract_id: uuid.UUID, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    contract = _contract_or_404(db, user, _seal(db, user).id, contract_id)
    rows = (
        db.query(SealChatMessage)
        .filter(SealChatMessage.contract_id == contract.id)
        .order_by(SealChatMessage.seq.asc())
        .all()
    )
    tokens, cost = _contract_tokens(db, contract)
    return ChatHistoryOut(
        messages=[ChatMessageOut(id=r.id, seq=r.seq, role=r.role, content=r.content,
                                 total_tokens=r.total_tokens, created_at=r.created_at) for r in rows],
        contract_token_total=tokens, contract_cost_usd=cost,
    )


def _review_out(db: Session, contract: SealContract) -> ReviewOut:
    rows = (
        db.query(SealReviewFinding)
        .filter(SealReviewFinding.contract_id == contract.id, SealReviewFinding.review_seq == contract.review_seq)
        .all()
    )
    rows.sort(key=lambda r: (_SEVERITY_RANK.get(r.severity, 3), r.created_at))
    findings = [FindingOut(
        id=r.id, clause_label=r.clause_label, category=r.category, severity=r.severity,
        issue=r.issue, rationale=r.rationale, clause_anchor=r.clause_anchor,
        suggested_redline=r.suggested_redline, status=r.status, created_at=r.created_at,
    ) for r in rows]
    return ReviewOut(
        review_seq=contract.review_seq, findings=findings,
        high=sum(1 for r in rows if r.severity == "high"),
        open_count=sum(1 for r in rows if r.status == "open"),
    )


@router.post("/contracts/{contract_id}/review", response_model=ReviewOut)
def review_contract(contract_id: uuid.UUID, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    sydekyk = _seal(db, user)
    permissions.assert_can_use(db, user, sydekyk.id)
    contract = _contract_or_404(db, user, sydekyk.id, contract_id)
    ctx = {"contract_id": str(contract.id)}
    mid = _run_inline(db, sydekyk, user, PLAYBOOK_KEY_REVIEW, ctx)
    _raise_if_mission_failed(db, mid)
    contract = _contract_or_404(db, user, sydekyk.id, contract_id)
    return _review_out(db, contract)


@router.get("/contracts/{contract_id}/findings", response_model=ReviewOut)
def get_findings(contract_id: uuid.UUID, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    contract = _contract_or_404(db, user, _seal(db, user).id, contract_id)
    return _review_out(db, contract)


@router.post("/contracts/{contract_id}/findings/{finding_id}/decision", response_model=FindingDecisionOut)
def decide_finding(contract_id: uuid.UUID, finding_id: uuid.UUID, payload: FindingDecisionIn,
                   user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    permissions.assert_can_use(db, user, _seal(db, user).id)
    contract = _contract_or_404(db, user, _seal(db, user).id, contract_id)
    finding = db.get(SealReviewFinding, finding_id)
    if finding is None or finding.contract_id != contract.id or finding.tenant_id != user.tenant_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Finding not found")

    applied = False
    if payload.decision == "accept":
        # Deterministic apply: swap the quoted clause text for the suggested redline in the contract HTML.
        anchor = (finding.clause_anchor or "").strip()
        redline = finding.suggested_redline or ""
        if anchor and redline and anchor in contract.content_html:
            contract.content_html = contract.content_html.replace(anchor, redline)
            applied = True
        finding.status = "accepted"
    else:
        finding.status = "dismissed"
    db.commit()
    db.refresh(finding)
    db.refresh(contract)
    return FindingDecisionOut(
        finding=FindingOut(
            id=finding.id, clause_label=finding.clause_label, category=finding.category,
            severity=finding.severity, issue=finding.issue, rationale=finding.rationale,
            clause_anchor=finding.clause_anchor, suggested_redline=finding.suggested_redline,
            status=finding.status, created_at=finding.created_at,
        ),
        applied=applied, contract=_contract_out(db, contract),
    )


# --- Import a counterparty contract for review -----------------------------------------------------

@router.post("/contracts/{contract_id}/import", response_model=ImportOut)
async def import_contract(contract_id: uuid.UUID, file: UploadFile, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    """Extract text from an uploaded contract (PDF/DOCX/text) into the contract's HTML so Seal can
    review it. Text-first; a scanned/image-only PDF is rejected with guidance to paste the text."""
    permissions.assert_can_use(db, user, _seal(db, user).id)
    contract = _contract_or_404(db, user, _seal(db, user).id, contract_id)
    data = await file.read()
    if len(data) > _MAX_IMPORT_BYTES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File exceeds the 15MB limit")
    ctype = file.content_type or "application/octet-stream"
    mode, value, err = vision_ai.document_to_llm_input(data, ctype)
    if mode != "text" or not value:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=err or "Could not read text from this file — paste the contract text into the editor instead.",
        )
    # Wrap the extracted plaintext as simple HTML paragraphs.
    import html as _html

    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", str(value)) if p.strip()]
    html_body = "".join(f"<p>{_html.escape(p)}</p>" for p in paragraphs)
    contract.content_html = html_body
    contract.review_seq = 0  # a fresh import invalidates any prior review
    db.commit()
    db.refresh(contract)
    return ImportOut(contract=_contract_out(db, contract), chars=len(str(value)))


# --- Image assets ----------------------------------------------------------------------------------

@router.post("/contracts/{contract_id}/assets", response_model=AssetOut, status_code=status.HTTP_201_CREATED)
async def upload_asset(contract_id: uuid.UUID, file: UploadFile, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    permissions.assert_can_use(db, user, _seal(db, user).id)
    contract = _contract_or_404(db, user, _seal(db, user).id, contract_id)
    data = await file.read()
    ctype = file.content_type or "application/octet-stream"
    if ctype not in _ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Unsupported image type: {ctype}")
    if len(data) > _MAX_IMAGE_BYTES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Image exceeds the 8MB limit")
    asset = SealAsset(tenant_id=user.tenant_id, contract_id=contract.id, filename=(file.filename or "image"),
                      content_type=ctype, size_bytes=len(data), content=data, created_by=user.email)
    db.add(asset)
    db.commit()
    db.refresh(asset)
    data_uri = f"data:{ctype};base64,{base64.b64encode(data).decode('ascii')}"
    return AssetOut(id=asset.id, url=f"/api/tenant/seal/assets/{asset.id}", data_uri=data_uri, filename=asset.filename)


@router.get("/assets/{asset_id}")
def get_asset(asset_id: uuid.UUID, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    asset = db.get(SealAsset, asset_id)
    if asset is None or asset.tenant_id != user.tenant_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")
    return Response(content=asset.content, media_type=asset.content_type,
                    headers={"Cache-Control": "private, max-age=3600"})


# --- PDF export ------------------------------------------------------------------------------------

def _render_pdf(db: Session, user: User, contract: SealContract) -> bytes:
    try:
        return export.render_contract_pdf(db, user.tenant_id, contract)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail=str(exc))


@router.post("/contracts/{contract_id}/pdf")
def export_pdf(contract_id: uuid.UUID, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    permissions.assert_can_use(db, user, _seal(db, user).id)
    contract = _contract_or_404(db, user, _seal(db, user).id, contract_id)
    out = _render_pdf(db, user, contract)
    filename = (contract.title or "contract").strip().replace('"', "") + ".pdf"
    return Response(content=out, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})


# --- Odoo (all optional) ---------------------------------------------------------------------------

@router.get("/odoo/opportunities", response_model=list[OpportunityOut])
def search_opportunities(q: str = "", user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    client = _connect(db, user.tenant_id, _seal(db, user).id)

    def _rel(v):
        return v[1] if isinstance(v, list) and len(v) > 1 else None

    try:
        rows = odoo_crm.search_opportunities(client, query=q.strip() or None, won_ids=odoo_crm.won_stage_ids(client))
    except odoo.OdooError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))
    return [
        OpportunityOut(id=r["id"], name=r.get("name"), partner_name=_rel(r.get("partner_id")),
                       stage_name=_rel(r.get("stage_id")), expected_revenue=r.get("expected_revenue"))
        for r in rows
    ]


@router.post("/contracts/{contract_id}/sign-request", response_model=SignRequestOut)
def sign_request(contract_id: uuid.UUID, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    """Hand off the final contract to Odoo Sign (Enterprise). If Odoo isn't assigned or the Sign app
    isn't available, respond with path='signet' so the client uses the native e-signature agent."""
    permissions.assert_can_use(db, user, _seal(db, user).id)
    contract = _contract_or_404(db, user, _seal(db, user).id, contract_id)
    try:
        client = _connect(db, user.tenant_id, _seal(db, user).id)
    except HTTPException:
        return SignRequestOut(path="signet", detail="No Odoo Sign available — use Signet to send for signature.")
    if not odoo_sign.sign_available(client):
        return SignRequestOut(path="signet", detail="Odoo Sign is not installed — use Signet to send for signature.")

    pdf_bytes = _render_pdf(db, user, contract)
    template_id = odoo_sign.create_sign_template(client, name=(contract.title or "Contract"), pdf_bytes=pdf_bytes)
    if template_id is None:
        return SignRequestOut(path="signet", detail="Odoo Sign template creation failed — use Signet instead.")
    signers = [contract.odoo_partner_id] if contract.odoo_partner_id else []
    request_id = odoo_sign.request_signature(client, template_id=template_id, signer_partner_ids=signers)
    if request_id is None:
        return SignRequestOut(path="signet", detail="Odoo Sign request creation failed — use Signet instead.")
    contract.odoo_sign_request_id = request_id
    db.commit()
    base_url = gadget_links.assigned_odoo_base_url(db, tenant_id=user.tenant_id, sydekyk_id=_seal(db, user).id)
    return SignRequestOut(
        path="odoo_sign", odoo_sign_request_id=request_id,
        odoo_url=gadget_links.odoo_form_url(base_url, "sign.request", request_id) if base_url else None,
        detail="Sent to Odoo Sign.",
    )
