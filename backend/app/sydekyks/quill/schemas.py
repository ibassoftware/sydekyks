import uuid
from datetime import datetime

from pydantic import BaseModel, Field


# --- Settings --------------------------------------------------------------------------------------

class QuillSettingsOut(BaseModel):
    default_template_id: uuid.UUID | None = None
    page_size: str
    accent_color: str | None = None
    header_text: str | None = None
    footer_text: str | None = None
    estimated_hourly_wage: float
    estimated_minutes_per_proposal: float


class QuillSettingsUpdate(BaseModel):
    default_template_id: uuid.UUID | None = None
    page_size: str = Field(default="A4", pattern="^(A4|Letter)$")
    accent_color: str | None = Field(default=None, max_length=12)
    header_text: str | None = Field(default=None, max_length=300)
    footer_text: str | None = Field(default=None, max_length=300)
    estimated_hourly_wage: float = Field(default=45.0, ge=0)
    estimated_minutes_per_proposal: float = Field(default=45.0, ge=0)


# --- Readiness / playbook --------------------------------------------------------------------------

class ReadinessItem(BaseModel):
    key: str
    label: str
    state: str
    detail: str | None = None
    action_label: str | None = None
    action_href: str | None = None


class QuillReadiness(BaseModel):
    items: list[ReadinessItem]
    can_upload: bool


class PlaybookStep(BaseModel):
    key: str
    title: str
    description: str
    likely_failures: str


class QuillPlaybook(BaseModel):
    playbook_key: str
    editable: bool
    steps: list[PlaybookStep]


# --- Templates -------------------------------------------------------------------------------------

class TemplateOut(BaseModel):
    id: uuid.UUID
    name: str
    format: str
    body: str
    is_builtin: bool
    created_by: str | None = None
    updated_at: datetime | None = None


class TemplateSummary(BaseModel):
    id: uuid.UUID
    name: str
    format: str
    is_builtin: bool


class TemplateCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    format: str = Field(default="html", pattern="^(html|md)$")
    body: str = ""


class TemplateUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    body: str | None = None


# --- Proposals -------------------------------------------------------------------------------------

class ProposalSummary(BaseModel):
    id: uuid.UUID
    title: str
    status: str
    customer_name: str | None = None
    owned_by: str | None = None  # shown to managers so they can tell whose proposal it is
    odoo_sale_order_name: str | None = None
    updated_at: datetime


class ProposalOut(BaseModel):
    id: uuid.UUID
    title: str
    status: str
    content_html: str
    customer_name: str | None = None
    template_id: uuid.UUID | None = None
    odoo_lead_id: int | None = None
    odoo_sale_order_id: int | None = None
    odoo_sale_order_name: str | None = None
    token_total: int = 0
    cost_usd: float = 0.0
    updated_at: datetime


class ProposalPage(BaseModel):
    items: list[ProposalSummary]
    total: int
    limit: int
    offset: int
    sees_all: bool = False  # true when the viewer is a manager seeing every proposal in the HQ


class ProposalCreate(BaseModel):
    title: str = Field(default="Untitled proposal", max_length=255)
    from_template_id: uuid.UUID | None = None


class ProposalUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=255)
    content_html: str | None = None
    status: str | None = Field(default=None, pattern="^(draft|final)$")


class GenerateIn(BaseModel):
    template_id: uuid.UUID | None = None
    notes: str = ""
    odoo_lead_id: int | None = None


class ChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=4000)


class TurnTokens(BaseModel):
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    cost_usd: float = 0.0


class ChatMessageOut(BaseModel):
    id: uuid.UUID
    seq: int
    role: str
    content: str
    total_tokens: int = 0
    created_at: datetime


class ChatOut(BaseModel):
    reply: str
    changed_summary: str
    proposal: ProposalOut
    turn_tokens: TurnTokens
    proposal_token_total: int
    proposal_cost_usd: float


class ChatHistoryOut(BaseModel):
    messages: list[ChatMessageOut]
    proposal_token_total: int
    proposal_cost_usd: float


# --- Odoo (optional) -------------------------------------------------------------------------------

class OpportunityOut(BaseModel):
    id: int
    name: str | None = None
    partner_name: str | None = None
    stage_name: str | None = None
    expected_revenue: float | None = None


class QuotationLineIn(BaseModel):
    name: str = Field(min_length=1, max_length=500)
    quantity: float = Field(default=1.0, ge=0)
    price_unit: float = Field(default=0.0, ge=0)


class QuotationCreateIn(BaseModel):
    partner_id: int | None = None
    lines: list[QuotationLineIn] = []


class QuotationOut(BaseModel):
    odoo_sale_order_id: int
    odoo_sale_order_name: str | None = None
    amount_total: float | None = None
    currency: str | None = None
    odoo_url: str | None = None


class AssetOut(BaseModel):
    id: uuid.UUID
    url: str
    data_uri: str  # embedded directly in the editor (an <img> can't send the bearer token to /assets/{id})
    filename: str


# --- Insights --------------------------------------------------------------------------------------

class TopCustomer(BaseModel):
    label: str
    count: int


class QuillInsightsOut(BaseModel):
    activated: bool
    proposals_created: int
    proposals_final: int
    revisions: int
    total_tokens: int
    ai_cost: float
    top_customers: list[TopCustomer] = []
    estimated_hourly_wage: float = 0.0
    estimated_minutes_each: float = 0.0
    estimated_manual_cost: float = 0.0
    estimated_net_savings: float = 0.0
    processing_seconds: float = 0.0
