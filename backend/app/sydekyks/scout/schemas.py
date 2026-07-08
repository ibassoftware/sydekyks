from pydantic import BaseModel, Field


class ScoutSettingsOut(BaseModel):
    processed_tag_name: str
    min_score_threshold: int
    scoring_rubric: str | None = None
    cron_enabled: bool
    cron_poll_limit: int


class ScoutSettingsUpdate(BaseModel):
    processed_tag_name: str = Field(min_length=1, max_length=120)
    min_score_threshold: int = Field(ge=0, le=100)
    scoring_rubric: str | None = None
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


class TopCandidate(BaseModel):
    applicant_name: str | None
    job_name: str | None
    score: int


class ScoutDailyPoint(BaseModel):
    date: str
    count: int


class ScoutInsightsOut(BaseModel):
    activated: bool
    total_scored: int
    average_score: float
    needs_review_count: int
    distribution: list[ScoreBand]
    top_candidates: list[TopCandidate]
    daily_trend: list[ScoutDailyPoint]


class RunNowOut(BaseModel):
    queued: int
