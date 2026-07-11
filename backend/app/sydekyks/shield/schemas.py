import uuid

from pydantic import BaseModel, Field


class ShieldSettingsOut(BaseModel):
    recent_change_days: int
    high_amount_threshold: float
    flag_threshold: int
    estimated_hourly_wage: float
    estimated_minutes_per_review: float
    cron_enabled: bool
    cron_poll_limit: int
    cron_days_back: int


class ShieldSettingsUpdate(BaseModel):
    recent_change_days: int = Field(default=14, ge=1, le=90)
    high_amount_threshold: float = Field(default=5000.0, ge=0)
    flag_threshold: int = Field(default=45, ge=0, le=100)
    estimated_hourly_wage: float = Field(default=45.0, ge=0)
    estimated_minutes_per_review: float = Field(default=10.0, ge=0)
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


class ShieldReadiness(BaseModel):
    items: list[ReadinessItem]
    can_upload: bool


class PlaybookStep(BaseModel):
    key: str
    title: str
    description: str
    likely_failures: str


class ShieldPlaybook(BaseModel):
    playbook_key: str
    editable: bool
    steps: list[PlaybookStep]


class RuleFlag(BaseModel):
    code: str
    label: str
    weight: int = 0
    evidence: str | None = None


class ShieldAlert(BaseModel):
    odoo_move_id: int
    vendor_name: str | None
    ref: str | None
    amount: float | None
    currency: str | None
    risk_score: int
    hold: bool
    flags: list[RuleFlag] = []
    summary: str | None = None
    odoo_url: str | None = None
    human_decision: str | None = None
    finding_id: uuid.UUID


class ShieldQueuePage(BaseModel):
    items: list[ShieldAlert]
    total: int
    limit: int
    offset: int


class TopRule(BaseModel):
    label: str
    count: int


class ShieldDailyPoint(BaseModel):
    date: str
    count: int


class ShieldInsightsOut(BaseModel):
    activated: bool
    total_assessed: int
    flagged_count: int
    holds_count: int
    exposure_amount: float
    top_rules: list[TopRule]
    daily_trend: list[ShieldDailyPoint]
    estimated_hourly_wage: float = 0.0
    estimated_minutes_each: float = 0.0
    estimated_manual_cost: float = 0.0
    ai_cost: float = 0.0
    estimated_net_savings: float = 0.0
    processing_seconds: float = 0.0


class RunNowOut(BaseModel):
    queued: int


class AlertDecisionIn(BaseModel):
    decision: str = Field(pattern="^(confirmed|cleared)$")
    rule_code: str | None = None  # on 'cleared', optionally suppress this rule for the vendor
