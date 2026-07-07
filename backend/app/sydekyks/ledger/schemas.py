from pydantic import BaseModel, Field


class LedgerSettingsOut(BaseModel):
    auto_create_partner: bool
    auto_post_enabled: bool
    auto_post_threshold: int
    ledger_vision_ok: bool | None = None
    ledger_vision_tested_at: str | None = None
    estimated_hourly_wage: float = 15.0
    estimated_minutes_per_bill: float = 5.0


class LedgerSettingsUpdate(BaseModel):
    auto_create_partner: bool
    auto_post_enabled: bool
    auto_post_threshold: int = Field(ge=0, le=100)
    estimated_hourly_wage: float = Field(default=15.0, ge=0)
    estimated_minutes_per_bill: float = Field(default=5.0, ge=0)


class ReadinessItem(BaseModel):
    key: str
    label: str
    state: str  # ok | warn | blocked
    detail: str | None = None
    action_label: str | None = None
    action_href: str | None = None


class LedgerReadiness(BaseModel):
    items: list[ReadinessItem]
    can_upload: bool
    last_inbound_email: str | None = None


class PlaybookStep(BaseModel):
    key: str
    title: str
    description: str
    likely_failures: str


class LedgerPlaybook(BaseModel):
    playbook_key: str
    editable: bool = False
    steps: list[PlaybookStep]


class VisionTestResult(BaseModel):
    ok: bool
    message: str


class EmailInboxCreate(BaseModel):
    name: str = "Ledger Inbox"


class EmailInboxOut(BaseModel):
    link_id: str
    inbound_address: str


class LedgerDailyTrend(BaseModel):
    date: str
    succeeded: int
    failed: int


class LedgerInsightsOut(BaseModel):
    activated: bool
    total_missions: int
    succeeded_missions: int
    failed_missions: int
    needs_review_missions: int
    posted_count: int
    daily_trend: list[LedgerDailyTrend]
    estimated_hourly_wage: float
    estimated_minutes_per_bill: float
    estimated_manual_cost: float
    ai_cost: float
    estimated_net_savings: float
