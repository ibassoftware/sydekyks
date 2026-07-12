import uuid
from datetime import date

from pydantic import BaseModel, Field


class StageThreshold(BaseModel):
    stage_id: int
    stage_name: str | None = None
    days: int = Field(ge=1, le=180)


class NudgeSettingsOut(BaseModel):
    default_stale_days: int
    stage_thresholds: list[StageThreshold] = []
    cadence_days: int
    activity_days: int
    estimated_hourly_wage: float
    estimated_minutes_per_followup: float
    cron_enabled: bool
    cron_poll_limit: int


class NudgeSettingsUpdate(BaseModel):
    default_stale_days: int = Field(default=14, ge=1, le=180)
    stage_thresholds: list[StageThreshold] = []
    cadence_days: int = Field(default=7, ge=1, le=90)
    activity_days: int = Field(default=2, ge=0, le=30)
    estimated_hourly_wage: float = Field(default=35.0, ge=0)
    estimated_minutes_per_followup: float = Field(default=6.0, ge=0)
    cron_enabled: bool
    cron_poll_limit: int = Field(default=30, ge=1, le=30)


class StageOut(BaseModel):
    id: int
    name: str | None = None
    is_won: bool = False


class ReadinessItem(BaseModel):
    key: str
    label: str
    state: str
    detail: str | None = None
    action_label: str | None = None
    action_href: str | None = None


class NudgeReadiness(BaseModel):
    items: list[ReadinessItem]
    can_upload: bool


class PlaybookStep(BaseModel):
    key: str
    title: str
    description: str
    likely_failures: str


class NudgePlaybook(BaseModel):
    playbook_key: str
    editable: bool
    steps: list[PlaybookStep]


class NudgeItem(BaseModel):
    finding_id: uuid.UUID
    odoo_lead_id: int
    opp_name: str | None
    partner_name: str | None
    salesperson: str | None
    stage_name: str | None
    expected_revenue: float | None
    currency: str | None
    days_stale: int
    silence_score: int
    value_at_risk: float | None
    overdue: bool
    activity_created: bool
    draft_body: str | None
    odoo_url: str | None = None
    human_decision: str | None = None


class NudgeQueuePage(BaseModel):
    items: list[NudgeItem]
    total: int
    limit: int
    offset: int


class TopStage(BaseModel):
    label: str
    count: int


class NudgeDailyPoint(BaseModel):
    date: str
    count: int


class NudgeInsightsOut(BaseModel):
    activated: bool
    open_total: int  # open opportunities currently tracked (denominator for "never missed")
    stale_caught: int  # stale opps Nudge acted on
    coverage_pct: float  # stale_caught / open_total — "follow-ups never missed"
    followups_drafted: int
    value_at_risk_total: float
    currency: str | None = None
    top_stages: list[TopStage]
    daily_trend: list[NudgeDailyPoint]
    estimated_hourly_wage: float = 0.0
    estimated_minutes_each: float = 0.0
    estimated_manual_cost: float = 0.0
    ai_cost: float = 0.0
    estimated_net_savings: float = 0.0
    processing_seconds: float = 0.0


class RunNowOut(BaseModel):
    queued: int


class NudgeDecisionIn(BaseModel):
    decision: str = Field(pattern="^(sent|dismissed)$")


class SnoozeIn(BaseModel):
    odoo_lead_id: int
    snooze_until: date | None = None  # None = never nudge (whitelist)
    note: str | None = None


class SnoozeOut(BaseModel):
    id: uuid.UUID
    odoo_lead_id: int
    opp_name: str | None
    snooze_until: date | None
    note: str | None
    created_by: str | None
