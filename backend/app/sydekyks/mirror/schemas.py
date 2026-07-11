import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class MirrorSettingsOut(BaseModel):
    date_window_days: int
    include_drafts: bool
    flag_threshold: int
    estimated_hourly_wage: float
    estimated_minutes_per_review: float
    cron_enabled: bool
    cron_poll_limit: int
    cron_days_back: int


class MirrorSettingsUpdate(BaseModel):
    date_window_days: int = Field(default=30, ge=0, le=120)
    include_drafts: bool = True
    flag_threshold: int = Field(default=70, ge=0, le=100)
    estimated_hourly_wage: float = Field(default=30.0, ge=0)
    estimated_minutes_per_review: float = Field(default=8.0, ge=0)
    cron_enabled: bool
    cron_poll_limit: int = Field(default=30, ge=1, le=30)
    cron_days_back: int = Field(default=5, ge=1, le=5)


class ReadinessItem(BaseModel):
    key: str
    label: str
    state: str
    detail: str | None = None
    action_label: str | None = None
    action_href: str | None = None


class MirrorReadiness(BaseModel):
    items: list[ReadinessItem]
    can_upload: bool


class PlaybookStep(BaseModel):
    key: str
    title: str
    description: str
    likely_failures: str


class MirrorPlaybook(BaseModel):
    playbook_key: str
    editable: bool
    steps: list[PlaybookStep]


class TierCount(BaseModel):
    tier: str
    count: int


class MirrorFlag(BaseModel):
    odoo_move_id: int
    vendor_name: str | None
    ref: str | None
    amount: float | None
    currency: str | None
    confidence: int
    tier: str | None
    reasons: list[str] = []
    odoo_url: str | None = None
    human_decision: str | None = None
    finding_id: uuid.UUID


class MirrorFlagPage(BaseModel):
    items: list[MirrorFlag]
    total: int
    limit: int
    offset: int


class MirrorDailyPoint(BaseModel):
    date: str
    count: int


class MirrorInsightsOut(BaseModel):
    activated: bool
    total_checked: int
    duplicates_found: int
    suppressed_count: int
    prevented_amount: float
    currency: str | None = None
    by_tier: list[TierCount]
    daily_trend: list[MirrorDailyPoint]
    estimated_hourly_wage: float = 0.0
    estimated_minutes_each: float = 0.0
    estimated_manual_cost: float = 0.0
    ai_cost: float = 0.0
    estimated_net_savings: float = 0.0
    processing_seconds: float = 0.0


class RunNowOut(BaseModel):
    queued: int


class FindingDecisionIn(BaseModel):
    decision: str = Field(pattern="^(confirmed_duplicate|not_duplicate|recurring)$")


class RecurringPatternOut(BaseModel):
    id: uuid.UUID
    partner_id: int
    vendor_name: str | None
    amount: float | None
    note: str | None
    created_by: str | None
    created_at: datetime


class RecurringPatternIn(BaseModel):
    partner_id: int
    vendor_name: str | None = None
    amount: float | None = None
    note: str | None = None
