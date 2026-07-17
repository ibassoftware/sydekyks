import uuid
from datetime import datetime

from pydantic import BaseModel, Field


# --- Settings --------------------------------------------------------------------------------------

class SealSettingsOut(BaseModel):
    default_template_id: uuid.UUID | None = None
    review_guidelines: str = ""
    page_size: str
    accent_color: str | None = None
    header_text: str | None = None
    footer_text: str | None = None
    estimated_hourly_wage: float
    estimated_minutes_per_contract: float


class SealSettingsUpdate(BaseModel):
    default_template_id: uuid.UUID | None = None
    review_guidelines: str = Field(default="", max_length=20000)
    page_size: str = Field(default="A4", pattern="^(A4|Letter)$")
    accent_color: str | None = Field(default=None, max_length=12)
    header_text: str | None = Field(default=None, max_length=300)
    footer_text: str | None = Field(default=None, max_length=300)
    estimated_hourly_wage: float = Field(default=60.0, ge=0)
    estimated_minutes_per_contract: float = Field(default=90.0, ge=0)


# --- Readiness / playbook --------------------------------------------------------------------------

class ReadinessItem(BaseModel):
    key: str
    label: str
    state: str
    detail: str | None = None
    action_label: str | None = None
    action_href: str | None = None


class SealReadiness(BaseModel):
    items: list[ReadinessItem]
    can_upload: bool


class PlaybookStep(BaseModel):
    key: str
    title: str
    description: str
    likely_failures: str


class SealPlaybook(BaseModel):
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


# --- Contracts -------------------------------------------------------------------------------------

class ContractSummary(BaseModel):
    id: uuid.UUID
    title: str
    status: str
    counterparty_name: str | None = None
    owned_by: str | None = None  # shown to managers so they can tell whose contract it is
    open_findings: int = 0
    updated_at: datetime


class ContractOut(BaseModel):
    id: uuid.UUID
    title: str
    status: str
    content_html: str
    counterparty_name: str | None = None
    template_id: uuid.UUID | None = None
    review_seq: int = 0
    odoo_lead_id: int | None = None
    odoo_partner_id: int | None = None
    odoo_sign_request_id: int | None = None
    token_total: int = 0
    cost_usd: float = 0.0
    updated_at: datetime


class ContractPage(BaseModel):
    items: list[ContractSummary]
    total: int
    limit: int
    offset: int
    sees_all: bool = False  # true when the viewer is a manager seeing every contract in the HQ


class ContractCreate(BaseModel):
    title: str = Field(default="Untitled contract", max_length=255)
    from_template_id: uuid.UUID | None = None


class ContractUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=255)
    content_html: str | None = None
    status: str | None = Field(default=None, pattern="^(draft|final)$")


class GenerateIn(BaseModel):
    template_id: uuid.UUID | None = None
    notes: str = ""
    odoo_lead_id: int | None = None


class ChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=4000)


class ChatMessageOut(BaseModel):
    id: uuid.UUID
    seq: int
    role: str
    content: str
    total_tokens: int = 0
    created_at: datetime


class ChatHistoryOut(BaseModel):
    messages: list[ChatMessageOut]
    contract_token_total: int
    contract_cost_usd: float


# --- Review findings -------------------------------------------------------------------------------

class FindingOut(BaseModel):
    id: uuid.UUID
    clause_label: str
    category: str
    severity: str
    issue: str
    rationale: str
    clause_anchor: str
    suggested_redline: str
    status: str
    created_at: datetime


class ReviewOut(BaseModel):
    review_seq: int
    findings: list[FindingOut]
    high: int = 0
    open_count: int = 0


class FindingDecisionIn(BaseModel):
    decision: str = Field(pattern="^(accept|dismiss)$")


class FindingDecisionOut(BaseModel):
    finding: FindingOut
    applied: bool  # true when accepting swapped the clause text into the contract HTML
    contract: ContractOut


# --- Import (counterparty contract for review) -----------------------------------------------------

class ImportOut(BaseModel):
    contract: ContractOut
    chars: int


# --- Odoo (optional) -------------------------------------------------------------------------------

class OpportunityOut(BaseModel):
    id: int
    name: str | None = None
    partner_name: str | None = None
    stage_name: str | None = None
    expected_revenue: float | None = None


class SignRequestOut(BaseModel):
    path: str  # "odoo_sign" | "signet"
    odoo_sign_request_id: int | None = None
    odoo_url: str | None = None
    signet_envelope_id: uuid.UUID | None = None
    detail: str | None = None


class AssetOut(BaseModel):
    id: uuid.UUID
    url: str
    data_uri: str  # embedded directly in the editor (an <img> can't send the bearer token to /assets/{id})
    filename: str


# --- Insights --------------------------------------------------------------------------------------

class TopCounterparty(BaseModel):
    label: str
    count: int


class SealInsightsOut(BaseModel):
    activated: bool
    contracts_created: int
    contracts_final: int
    revisions: int
    contracts_reviewed: int
    high_severity_caught: int
    redlines_accepted: int
    total_tokens: int
    ai_cost: float
    top_counterparties: list[TopCounterparty] = []
    estimated_hourly_wage: float = 0.0
    estimated_minutes_each: float = 0.0
    estimated_manual_cost: float = 0.0
    estimated_net_savings: float = 0.0
    processing_seconds: float = 0.0
