from pydantic import BaseModel, Field


class ScoutSettingsOut(BaseModel):
    processed_tag_name: str
    estimated_hourly_wage: float
    estimated_minutes_per_candidate: float
    cron_enabled: bool
    cron_poll_limit: int


class ScoutSettingsUpdate(BaseModel):
    processed_tag_name: str = Field(min_length=1, max_length=120)
    estimated_hourly_wage: float = Field(default=25.0, ge=0)
    estimated_minutes_per_candidate: float = Field(default=15.0, ge=0)
    cron_enabled: bool
    cron_poll_limit: int = Field(default=30, ge=1, le=30)


class ReadinessItem(BaseModel):
    key: str
    label: str
    state: str
    detail: str | None = None
    action_label: str | None = None
    action_href: str | None = None


class ScoutReadiness(BaseModel):
    items: list[ReadinessItem]
    can_upload: bool


class PlaybookStep(BaseModel):
    key: str
    title: str
    description: str
    likely_failures: str


class ScoutPlaybook(BaseModel):
    playbook_key: str
    editable: bool
    steps: list[PlaybookStep]


class ScoreBand(BaseModel):
    band: str
    count: int


class ShortlistCandidate(BaseModel):
    applicant_name: str | None
    score: int
    summary: str | None = None
    odoo_url: str | None = None


class RoleHealth(BaseModel):
    job_name: str
    scored: int
    strong: int
    avg_score: float
    top_score: int
    top_candidates: list[ShortlistCandidate] = []


class ThemeCount(BaseModel):
    label: str
    count: int


class ScoutDailyPoint(BaseModel):
    date: str
    count: int


class ScoutInsightsOut(BaseModel):
    activated: bool
    total_scored: int
    average_score: float
    strong_count: int = 0
    distribution: list[ScoreBand]
    role_health: list[RoleHealth] = []
    common_strengths: list[ThemeCount] = []
    common_weaknesses: list[ThemeCount] = []
    daily_trend: list[ScoutDailyPoint]
    estimated_hourly_wage: float = 0.0
    estimated_minutes_each: float = 0.0
    estimated_manual_cost: float = 0.0
    ai_cost: float = 0.0
    estimated_net_savings: float = 0.0
    processing_seconds: float = 0.0


class RunNowOut(BaseModel):
    queued: int
