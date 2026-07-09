from pydantic import BaseModel, Field


class DecodeSettingsOut(BaseModel):
    auto_create_skills: bool
    processed_tag_name: str
    pooling_stage_name: str | None = None
    max_resume_pages: int
    estimated_hourly_wage: float
    estimated_minutes_per_resume: float
    cron_enabled: bool
    cron_poll_limit: int


class DecodeSettingsUpdate(BaseModel):
    auto_create_skills: bool
    processed_tag_name: str = Field(min_length=1, max_length=120)
    pooling_stage_name: str | None = None
    max_resume_pages: int = Field(default=6, ge=1, le=15)
    estimated_hourly_wage: float = Field(default=20.0, ge=0)
    estimated_minutes_per_resume: float = Field(default=10.0, ge=0)
    cron_enabled: bool
    cron_poll_limit: int = Field(default=30, ge=1, le=30)


class ReadinessItem(BaseModel):
    key: str
    label: str
    state: str
    detail: str | None = None
    action_label: str | None = None
    action_href: str | None = None


class DecodeReadiness(BaseModel):
    items: list[ReadinessItem]
    can_upload: bool
    last_inbound_email: str | None = None


class PlaybookStep(BaseModel):
    key: str
    title: str
    description: str
    likely_failures: str


class DecodePlaybook(BaseModel):
    playbook_key: str
    editable: bool
    steps: list[PlaybookStep]


class TopSkill(BaseModel):
    skill: str
    count: int


class DecodeDailyPoint(BaseModel):
    date: str
    count: int


class DecodeInsightsOut(BaseModel):
    activated: bool
    total_applicants: int
    with_job_count: int
    pooling_count: int
    needs_review_count: int
    top_skills: list[TopSkill]
    daily_trend: list[DecodeDailyPoint]
    estimated_hourly_wage: float = 0.0
    estimated_minutes_each: float = 0.0
    estimated_manual_cost: float = 0.0
    ai_cost: float = 0.0
    estimated_net_savings: float = 0.0


class DecodeJob(BaseModel):
    id: int
    name: str


class DecodeJobsOut(BaseModel):
    connected: bool
    jobs: list[DecodeJob]
    message: str | None = None


class EmailInboxCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class EmailInboxOut(BaseModel):
    link_id: str
    inbound_address: str
