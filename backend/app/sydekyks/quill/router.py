import base64
import uuid

from fastapi import APIRouter, Depends, HTTPException, Response, UploadFile, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.crypto import decrypt_secret
from app.core.deps import require_tenant_member
from app.db.session import get_db
from app.models.sydekyk import Sydekyk
from app.models.usage_record import UsageRecord
from app.models.user import User
from app.schemas.mission import MissionStartOut
from app.services import gadget_links, odoo, odoo_crm, odoo_sales, permissions
from app.services.missions import create_mission
from app.services.queue import enqueue_mission

from app.sydekyks.quill import insights as insights_svc
from app.sydekyks.quill import pdf as pdf_svc
from app.sydekyks.quill import readiness as readiness_svc
from app.sydekyks.quill.models import (
    QuillAsset,
    QuillChatMessage,
    QuillProposal,
    QuillTemplate,
    QuillTenantSettings,
)
from app.sydekyks.quill.playbook import PLAYBOOK_KEY, PLAYBOOK_KEY_REFINE, PLAYBOOK_STEPS
from app.sydekyks.quill.schemas import (
    AssetOut,
    ChatHistoryOut,
    ChatIn,
    ChatMessageOut,
    GenerateIn,
    OpportunityOut,
    ProposalCreate,
    ProposalOut,
    ProposalPage,
    ProposalSummary,
    ProposalUpdate,
    QuillInsightsOut,
    QuillPlaybook,
    QuillReadiness,
    QuillSettingsOut,
    QuillSettingsUpdate,
    QuotationCreateIn,
    QuotationOut,
    TemplateCreate,
    TemplateOut,
    TemplateSummary,
    TemplateUpdate,
)

router = APIRouter(prefix="/api/tenant/quill", tags=["quill"], dependencies=[Depends(require_tenant_member)])

_MAX_IMAGE_BYTES = 8 * 1024 * 1024
_ALLOWED_IMAGE_TYPES = {"image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"}


def _quill(db: Session, user: User) -> Sydekyk:
    sydekyk = (
        db.query(Sydekyk)
        .filter(Sydekyk.slug == "quill", Sydekyk.is_published.is_(True),
                or_(Sydekyk.tenant_id.is_(None), Sydekyk.tenant_id == user.tenant_id))
        .first()
    )
    if sydekyk is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Quill Sydekyk not found")
    return sydekyk


def _settings(db: Session, tenant_id) -> QuillTenantSettings:
    s = db.query(QuillTenantSettings).filter(QuillTenantSettings.tenant_id == tenant_id).first()
    if s is None:
        s = QuillTenantSettings(tenant_id=tenant_id)
        db.add(s)
        db.commit()
        db.refresh(s)
    return s


def _connect(db: Session, tenant_id, sydekyk_id):
    link = gadget_links.find_assigned_link(db, tenant_id=tenant_id, sydekyk_id=sydekyk_id, role_key="erp")
    if link is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="No Odoo instance assigned to Quill")
    ok, msg, client = odoo.connect(link.url, link.database, link.username, decrypt_secret(link.encrypted_secret))
    if not ok or client is None:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=msg or "Odoo connection failed")
    return client


def _sees_all_proposals(db: Session, user: User, sydekyk_id: uuid.UUID) -> bool:
    """A manager (Commander, or a hero granted 'configure') sees/edits every proposal in the HQ; a
    plain 'use' salesperson is scoped to the proposals they created."""
    return permissions.can_configure(db, user, sydekyk_id)


def _proposal_or_404(db: Session, user: User, sydekyk_id: uuid.UUID, proposal_id: uuid.UUID) -> QuillProposal:
    row = db.get(QuillProposal, proposal_id)
    if row is None or row.tenant_id != user.tenant_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Proposal not found")
    # Ownership scoping: a salesperson can only touch their own proposals.
    if not _sees_all_proposals(db, user, sydekyk_id) and row.created_by != user.email:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Proposal not found")
    return row


def _proposal_tokens(db: Session, proposal: QuillProposal) -> tuple[int, float]:
    """Total tokens + AI cost spent on this proposal — its draft mission + every refine mission."""
    mission_ids = set()
    if proposal.mission_id:
        mission_ids.add(proposal.mission_id)
    for (mid,) in (
        db.query(QuillChatMessage.mission_id)
        .filter(QuillChatMessage.proposal_id == proposal.id, QuillChatMessage.mission_id.isnot(None))
        .distinct()
        .all()
    ):
        mission_ids.add(mid)
    if not mission_ids:
        return 0, 0.0
    from sqlalchemy import func

    row = (
        db.query(
            func.coalesce(func.sum(UsageRecord.total_tokens), 0),
            func.coalesce(func.sum(UsageRecord.cost_usd), 0.0),
        )
        .filter(UsageRecord.mission_id.in_(mission_ids))
        .first()
    )
    return (int(row[0]), round(float(row[1]), 4)) if row else (0, 0.0)


def _proposal_out(db: Session, proposal: QuillProposal) -> ProposalOut:
    tokens, cost = _proposal_tokens(db, proposal)
    return ProposalOut(
        id=proposal.id, title=proposal.title, status=proposal.status, content_html=proposal.content_html,
        customer_name=proposal.customer_name, template_id=proposal.template_id,
        odoo_lead_id=proposal.odoo_lead_id, odoo_sale_order_id=proposal.odoo_sale_order_id,
        odoo_sale_order_name=proposal.odoo_sale_order_name, token_total=tokens, cost_usd=cost,
        updated_at=proposal.updated_at,
    )


# --- Settings / readiness / playbook / insights ----------------------------------------------------

@router.get("/settings", response_model=QuillSettingsOut)
def get_settings(user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    s = _settings(db, user.tenant_id)
    return QuillSettingsOut(
        default_template_id=s.default_template_id, page_size=s.page_size, accent_color=s.accent_color,
        header_text=s.header_text, footer_text=s.footer_text, estimated_hourly_wage=s.estimated_hourly_wage,
        estimated_minutes_per_proposal=s.estimated_minutes_per_proposal,
    )


@router.put("/settings", response_model=QuillSettingsOut)
def update_settings(payload: QuillSettingsUpdate, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    permissions.assert_can_configure(db, user, _quill(db, user).id)
    s = _settings(db, user.tenant_id)
    s.default_template_id = payload.default_template_id
    s.page_size = payload.page_size
    s.accent_color = payload.accent_color
    s.header_text = payload.header_text
    s.footer_text = payload.footer_text
    s.estimated_hourly_wage = payload.estimated_hourly_wage
    s.estimated_minutes_per_proposal = payload.estimated_minutes_per_proposal
    db.commit()
    db.refresh(s)
    return get_settings(user, db)


@router.get("/readiness", response_model=QuillReadiness)
def get_readiness(user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    sydekyk = _quill(db, user)
    return QuillReadiness(**readiness_svc.compute_readiness(db, user.tenant_id, sydekyk.id))


@router.get("/playbook", response_model=QuillPlaybook)
def get_playbook(user: User = Depends(require_tenant_member)):
    return QuillPlaybook(playbook_key=PLAYBOOK_KEY, editable=False, steps=PLAYBOOK_STEPS)


@router.get("/insights", response_model=QuillInsightsOut)
def get_insights(user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    sydekyk = _quill(db, user)
    activated = insights_svc.quill_activated(db, user.tenant_id, sydekyk.id)
    return QuillInsightsOut(activated=activated, **insights_svc.compute_insights(db, user.tenant_id, sydekyk.id))


# --- Templates -------------------------------------------------------------------------------------

@router.get("/templates", response_model=list[TemplateSummary])
def list_templates(user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    rows = (
        db.query(QuillTemplate)
        .filter(or_(QuillTemplate.tenant_id.is_(None), QuillTemplate.tenant_id == user.tenant_id))
        .order_by(QuillTemplate.is_builtin.desc(), QuillTemplate.name.asc())
        .all()
    )
    return [TemplateSummary(id=r.id, name=r.name, format=r.format, is_builtin=r.is_builtin) for r in rows]


@router.get("/templates/{template_id}", response_model=TemplateOut)
def get_template(template_id: uuid.UUID, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    r = db.get(QuillTemplate, template_id)
    if r is None or (r.tenant_id is not None and r.tenant_id != user.tenant_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")
    return TemplateOut(id=r.id, name=r.name, format=r.format, body=r.body, is_builtin=r.is_builtin,
                       created_by=r.created_by, updated_at=r.updated_at)


@router.post("/templates", response_model=TemplateOut, status_code=status.HTTP_201_CREATED)
def create_template(payload: TemplateCreate, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    permissions.assert_can_use(db, user, _quill(db, user).id)
    r = QuillTemplate(tenant_id=user.tenant_id, name=payload.name, format=payload.format,
                      body=payload.body, is_builtin=False, created_by=user.email)
    db.add(r)
    db.commit()
    db.refresh(r)
    return TemplateOut(id=r.id, name=r.name, format=r.format, body=r.body, is_builtin=r.is_builtin,
                       created_by=r.created_by, updated_at=r.updated_at)


@router.put("/templates/{template_id}", response_model=TemplateOut)
def update_template(template_id: uuid.UUID, payload: TemplateUpdate, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    permissions.assert_can_use(db, user, _quill(db, user).id)
    r = db.get(QuillTemplate, template_id)
    if r is None or r.tenant_id != user.tenant_id:
        # Built-ins (tenant_id NULL) are read-only; a 404 here also covers "not yours".
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
    permissions.assert_can_use(db, user, _quill(db, user).id)
    r = db.get(QuillTemplate, template_id)
    if r is None or r.tenant_id != user.tenant_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found or read-only")
    db.delete(r)
    db.commit()


# --- Proposals -------------------------------------------------------------------------------------

@router.get("/proposals", response_model=ProposalPage)
def list_proposals(limit: int = 20, offset: int = 0, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    limit = max(1, min(limit, 100))
    offset = max(0, offset)
    sees_all = _sees_all_proposals(db, user, _quill(db, user).id)
    base = db.query(QuillProposal).filter(QuillProposal.tenant_id == user.tenant_id)
    if not sees_all:
        base = base.filter(QuillProposal.created_by == user.email)  # a salesperson sees only their own
    total = base.count()
    rows = base.order_by(QuillProposal.updated_at.desc()).limit(limit).offset(offset).all()
    return ProposalPage(
        items=[ProposalSummary(id=r.id, title=r.title, status=r.status, customer_name=r.customer_name,
                               owned_by=r.created_by, odoo_sale_order_name=r.odoo_sale_order_name,
                               updated_at=r.updated_at) for r in rows],
        total=total, limit=limit, offset=offset, sees_all=sees_all,
    )


@router.post("/proposals", response_model=ProposalOut, status_code=status.HTTP_201_CREATED)
def create_proposal(payload: ProposalCreate, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    sydekyk = _quill(db, user)
    permissions.assert_can_use(db, user, sydekyk.id)
    content = ""
    template_id = None
    if payload.from_template_id:
        tpl = db.get(QuillTemplate, payload.from_template_id)
        if tpl is not None and (tpl.tenant_id is None or tpl.tenant_id == user.tenant_id):
            template_id = tpl.id
            if tpl.format == "html":
                content = tpl.body  # md templates are best fed through Generate (converted client-side)
    r = QuillProposal(tenant_id=user.tenant_id, sydekyk_id=sydekyk.id, title=payload.title,
                      content_html=content, template_id=template_id, created_by=user.email)
    db.add(r)
    db.commit()
    db.refresh(r)
    return _proposal_out(db, r)


@router.get("/proposals/{proposal_id}", response_model=ProposalOut)
def get_proposal(proposal_id: uuid.UUID, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    return _proposal_out(db, _proposal_or_404(db, user, _quill(db, user).id, proposal_id))


@router.put("/proposals/{proposal_id}", response_model=ProposalOut)
def update_proposal(proposal_id: uuid.UUID, payload: ProposalUpdate, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    permissions.assert_can_use(db, user, _quill(db, user).id)
    r = _proposal_or_404(db, user, _quill(db, user).id, proposal_id)
    if payload.title is not None:
        r.title = payload.title
    if payload.content_html is not None:
        r.content_html = payload.content_html
    if payload.status is not None:
        r.status = payload.status
    db.commit()
    db.refresh(r)
    return _proposal_out(db, r)


@router.delete("/proposals/{proposal_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_proposal(proposal_id: uuid.UUID, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    permissions.assert_can_use(db, user, _quill(db, user).id)
    r = _proposal_or_404(db, user, _quill(db, user).id, proposal_id)
    db.delete(r)
    db.commit()


# --- AI: generate + chat (metered queued Missions) -------------------------------------------------

@router.post(
    "/proposals/{proposal_id}/generate",
    response_model=MissionStartOut,
    status_code=status.HTTP_202_ACCEPTED,
)
async def generate_proposal(proposal_id: uuid.UUID, payload: GenerateIn, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    """Validate the domain command, enqueue a Mission, and return its observation identity."""
    sydekyk = _quill(db, user)
    permissions.assert_can_use(db, user, sydekyk.id)
    proposal = _proposal_or_404(db, user, _quill(db, user).id, proposal_id)
    ctx = {"proposal_id": str(proposal.id), "notes": payload.notes}
    if payload.template_id:
        ctx["template_id"] = str(payload.template_id)
    if payload.odoo_lead_id:
        ctx["odoo_lead_id"] = payload.odoo_lead_id
    mission = create_mission(
        db, tenant_id=user.tenant_id, sydekyk=sydekyk, user_id=user.id,
        source="manual", signal_type="manual", trigger_context=ctx, playbook_key=PLAYBOOK_KEY,
    )
    await enqueue_mission(mission.id)
    return MissionStartOut(mission_id=mission.id)


@router.post(
    "/proposals/{proposal_id}/chat",
    response_model=MissionStartOut,
    status_code=status.HTTP_202_ACCEPTED,
)
async def chat(proposal_id: uuid.UUID, payload: ChatIn, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    sydekyk = _quill(db, user)
    permissions.assert_can_use(db, user, sydekyk.id)
    proposal = _proposal_or_404(db, user, _quill(db, user).id, proposal_id)
    ctx = {"proposal_id": str(proposal.id), "message": payload.message}
    mission = create_mission(
        db, tenant_id=user.tenant_id, sydekyk=sydekyk, user_id=user.id,
        source="manual", signal_type="manual", trigger_context=ctx, playbook_key=PLAYBOOK_KEY_REFINE,
    )
    await enqueue_mission(mission.id)
    return MissionStartOut(mission_id=mission.id)


@router.get("/proposals/{proposal_id}/chat", response_model=ChatHistoryOut)
def get_chat(proposal_id: uuid.UUID, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    proposal = _proposal_or_404(db, user, _quill(db, user).id, proposal_id)
    rows = (
        db.query(QuillChatMessage)
        .filter(QuillChatMessage.proposal_id == proposal.id)
        .order_by(QuillChatMessage.seq.asc())
        .all()
    )
    tokens, cost = _proposal_tokens(db, proposal)
    return ChatHistoryOut(
        messages=[ChatMessageOut(id=r.id, seq=r.seq, role=r.role, content=r.content,
                                 total_tokens=r.total_tokens, created_at=r.created_at) for r in rows],
        proposal_token_total=tokens, proposal_cost_usd=cost,
    )


# --- Image assets ----------------------------------------------------------------------------------

@router.post("/proposals/{proposal_id}/assets", response_model=AssetOut, status_code=status.HTTP_201_CREATED)
async def upload_asset(proposal_id: uuid.UUID, file: UploadFile, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    permissions.assert_can_use(db, user, _quill(db, user).id)
    proposal = _proposal_or_404(db, user, _quill(db, user).id, proposal_id)
    data = await file.read()
    ctype = file.content_type or "application/octet-stream"
    if ctype not in _ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Unsupported image type: {ctype}")
    if len(data) > _MAX_IMAGE_BYTES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Image exceeds the 8MB limit")
    asset = QuillAsset(tenant_id=user.tenant_id, proposal_id=proposal.id, filename=(file.filename or "image"),
                       content_type=ctype, size_bytes=len(data), content=data, created_by=user.email)
    db.add(asset)
    db.commit()
    db.refresh(asset)
    data_uri = f"data:{ctype};base64,{base64.b64encode(data).decode('ascii')}"
    return AssetOut(id=asset.id, url=f"/api/tenant/quill/assets/{asset.id}", data_uri=data_uri, filename=asset.filename)


@router.get("/assets/{asset_id}")
def get_asset(asset_id: uuid.UUID, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    asset = db.get(QuillAsset, asset_id)
    if asset is None or asset.tenant_id != user.tenant_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")
    return Response(content=asset.content, media_type=asset.content_type,
                    headers={"Cache-Control": "private, max-age=3600"})


# --- PDF export ------------------------------------------------------------------------------------

@router.post("/proposals/{proposal_id}/pdf")
def export_pdf(proposal_id: uuid.UUID, merge_quotation: bool = False, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    permissions.assert_can_use(db, user, _quill(db, user).id)
    proposal = _proposal_or_404(db, user, _quill(db, user).id, proposal_id)
    s = _settings(db, user.tenant_id)

    logo_uri = None
    if s.logo_asset_id:
        logo = db.get(QuillAsset, s.logo_asset_id)
        if logo is not None and logo.tenant_id == user.tenant_id:
            logo_uri = f"data:{logo.content_type};base64,{base64.b64encode(logo.content).decode('ascii')}"

    html_doc = pdf_svc.build_document(
        _inline_asset_images(db, user.tenant_id, proposal.content_html),
        title=proposal.title, page_size=s.page_size, accent=s.accent_color, logo_data_uri=logo_uri,
        header_text=s.header_text, footer_text=s.footer_text,
    )
    try:
        proposal_pdf = pdf_svc.render_html_to_pdf(html_doc)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail=str(exc))

    out = proposal_pdf
    if merge_quotation and proposal.odoo_sale_order_id:
        try:
            client = _connect(db, user.tenant_id, _quill(db, user).id)
            quote_pdf = odoo_sales.fetch_quotation_pdf(client, proposal.odoo_sale_order_id)
            if quote_pdf:
                out = pdf_svc.merge_pdfs([proposal_pdf, quote_pdf])
        except HTTPException:
            pass  # Odoo unreachable — return the proposal-only PDF rather than failing the export

    filename = (proposal.title or "proposal").strip().replace('"', "") + ".pdf"
    return Response(content=out, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})


def _inline_asset_images(db: Session, tenant_id, html: str) -> str:
    """Replace /api/tenant/quill/assets/<id> image srcs with data URIs so WeasyPrint (which has no auth
    context) can render them."""
    import re

    if not html:
        return html or ""

    # Match src="...assets/<uuid>" capturing the id, so we can swap the URL for an inline data URI.
    pattern = re.compile(r'src="(?:[^"]*?/api/tenant/quill/assets/([0-9a-fA-F-]{36}))"')

    def repl2(m: "re.Match") -> str:
        aid = m.group(1)
        try:
            asset = db.get(QuillAsset, uuid.UUID(aid))
        except (ValueError, TypeError):
            return m.group(0)
        if asset is None or asset.tenant_id != tenant_id:
            return m.group(0)
        uri = f"data:{asset.content_type};base64,{base64.b64encode(asset.content).decode('ascii')}"
        return f'src="{uri}"'

    return pattern.sub(repl2, html)


# --- Odoo (all optional) ---------------------------------------------------------------------------

@router.get("/odoo/opportunities", response_model=list[OpportunityOut])
def search_opportunities(q: str = "", user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    client = _connect(db, user.tenant_id, _quill(db, user).id)

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


@router.post("/proposals/{proposal_id}/quotation", response_model=QuotationOut)
def create_quotation(proposal_id: uuid.UUID, payload: QuotationCreateIn, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    permissions.assert_can_use(db, user, _quill(db, user).id)
    proposal = _proposal_or_404(db, user, _quill(db, user).id, proposal_id)
    client = _connect(db, user.tenant_id, _quill(db, user).id)

    partner_id = payload.partner_id
    if partner_id is None and proposal.odoo_lead_id:
        partner_id = odoo_sales.partner_id_for_lead(client, proposal.odoo_lead_id)
    if partner_id is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="Pick a customer (or link an opportunity with a customer) for the quotation.")
    try:
        order_id = odoo_sales.create_quotation(
            client, partner_id=partner_id, lines=[line.model_dump() for line in payload.lines],
        )
        order = odoo_sales.read_order(client, order_id)
    except odoo.OdooError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))

    proposal.odoo_sale_order_id = order_id
    proposal.odoo_sale_order_name = (order or {}).get("name")
    db.commit()
    base_url = gadget_links.assigned_odoo_base_url(db, tenant_id=user.tenant_id, sydekyk_id=_quill(db, user).id)
    return QuotationOut(
        odoo_sale_order_id=order_id, odoo_sale_order_name=(order or {}).get("name"),
        amount_total=(order or {}).get("amount_total"), currency=(order or {}).get("currency"),
        odoo_url=gadget_links.odoo_form_url(base_url, "sale.order", order_id) if base_url else None,
    )


@router.post("/proposals/{proposal_id}/attach-to-quotation", status_code=status.HTTP_204_NO_CONTENT)
def attach_to_quotation(proposal_id: uuid.UUID, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    """Render the (merged) proposal PDF and attach it to the linked Odoo quotation."""
    permissions.assert_can_use(db, user, _quill(db, user).id)
    proposal = _proposal_or_404(db, user, _quill(db, user).id, proposal_id)
    if not proposal.odoo_sale_order_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No quotation linked to this proposal")
    s = _settings(db, user.tenant_id)
    html_doc = pdf_svc.build_document(
        _inline_asset_images(db, user.tenant_id, proposal.content_html),
        title=proposal.title, page_size=s.page_size, accent=s.accent_color,
        header_text=s.header_text, footer_text=s.footer_text,
    )
    try:
        proposal_pdf = pdf_svc.render_html_to_pdf(html_doc)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail=str(exc))
    client = _connect(db, user.tenant_id, _quill(db, user).id)
    ok, msg = odoo.attach_document(
        client, res_model="sale.order", res_id=proposal.odoo_sale_order_id,
        filename=(proposal.title or "proposal") + ".pdf", content_bytes=proposal_pdf, mimetype="application/pdf",
    )
    if not ok:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=msg)
