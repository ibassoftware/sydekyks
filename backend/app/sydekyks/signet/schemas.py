import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field


# --- Settings --------------------------------------------------------------------------------------

class SignetSettingsOut(BaseModel):
    sender_name: str | None = None
    reminder_interval_days: int
    max_reminders: int
    expiry_days: int
    email_copy_mode: str
    email_prompt: str
    estimated_hourly_wage: float
    estimated_minutes_per_signature: float


class SignetSettingsUpdate(BaseModel):
    sender_name: str | None = Field(default=None, max_length=120)
    reminder_interval_days: int = Field(default=3, ge=1, le=60)
    max_reminders: int = Field(default=3, ge=0, le=20)
    expiry_days: int = Field(default=30, ge=1, le=365)
    email_copy_mode: str = Field(default="template", pattern="^(template|ai)$")
    email_prompt: str = Field(default="", max_length=2000)
    estimated_hourly_wage: float = Field(default=45.0, ge=0)
    estimated_minutes_per_signature: float = Field(default=25.0, ge=0)


# --- Readiness / playbook --------------------------------------------------------------------------

class ReadinessItem(BaseModel):
    key: str
    label: str
    state: str
    detail: str | None = None
    action_label: str | None = None
    action_href: str | None = None


class SignetReadiness(BaseModel):
    items: list[ReadinessItem]
    can_send: bool


class PlaybookStep(BaseModel):
    key: str
    title: str
    description: str
    likely_failures: str


class SignetPlaybook(BaseModel):
    playbook_key: str
    editable: bool
    steps: list[PlaybookStep]


# --- Envelopes -------------------------------------------------------------------------------------

class SignerIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    email: EmailStr


class EnvelopeCreate(BaseModel):
    title: str = Field(default="", max_length=255)
    message: str = Field(default="", max_length=2000)
    seal_contract_id: uuid.UUID | None = None  # source a Seal contract's PDF, or None to upload one
    signers: list[SignerIn] = Field(min_length=1)
    signing_order: str = Field(default="parallel", pattern="^(parallel|sequential)$")
    reminder_interval_days: int | None = Field(default=None, ge=1, le=60)
    max_reminders: int | None = Field(default=None, ge=0, le=20)
    email_copy_mode: str | None = Field(default=None, pattern="^(template|ai)$")
    email_prompt: str = Field(default="", max_length=2000)


class SignerOut(BaseModel):
    id: uuid.UUID
    name: str
    email: str
    order: int
    status: str
    signed_at: datetime | None = None
    viewed_at: datetime | None = None
    reminder_count: int = 0
    decline_reason: str | None = None


class EventOut(BaseModel):
    id: uuid.UUID
    event_type: str
    detail: str | None = None
    created_at: datetime


class EnvelopeSummary(BaseModel):
    id: uuid.UUID
    title: str
    status: str
    signed_count: int = 0
    signer_count: int = 0
    hold: bool = False
    owned_by: str | None = None
    updated_at: datetime


class EnvelopeOut(BaseModel):
    id: uuid.UUID
    title: str
    message: str
    status: str
    signing_order: str
    reminder_interval_days: int
    max_reminders: int
    email_copy_mode: str
    email_prompt: str
    hold: bool
    expires_at: datetime | None = None
    seal_contract_id: uuid.UUID | None = None
    has_signed_pdf: bool = False
    signers: list[SignerOut] = []
    events: list[EventOut] = []
    created_by: str | None = None
    sent_at: datetime | None = None
    completed_at: datetime | None = None
    updated_at: datetime


class EnvelopePage(BaseModel):
    items: list[EnvelopeSummary]
    total: int
    limit: int
    offset: int
    sees_all: bool = False


class HoldIn(BaseModel):
    hold: bool


class SendOut(BaseModel):
    envelope: EnvelopeOut
    sent: int


# --- Public signing (no auth) ----------------------------------------------------------------------

class PublicEnvelopeOut(BaseModel):
    title: str
    message: str
    signer_name: str
    status: str  # the signer's own status: pending | viewed | signed | declined, or "unavailable"
    already_signed: bool = False
    document_data_uri: str | None = None  # the source PDF as a data URI for inline preview


class SignIn(BaseModel):
    signature_name: str = Field(min_length=1, max_length=200)
    agree: bool
    signature_image_data_uri: str | None = None  # optional drawn signature (PNG data URI)


class DeclineIn(BaseModel):
    reason: str = Field(default="", max_length=1000)


class PublicResultOut(BaseModel):
    status: str
    message: str


# --- Insights --------------------------------------------------------------------------------------

class SignetInsightsOut(BaseModel):
    activated: bool
    envelopes_sent: int
    completed: int
    completion_rate: float
    pending: int
    at_risk: int
    reminders_sent: int
    median_hours_to_sign: float | None = None
    estimated_hourly_wage: float = 0.0
    estimated_minutes_each: float = 0.0
    estimated_manual_cost: float = 0.0
    estimated_net_savings: float = 0.0
    processing_seconds: float = 0.0
