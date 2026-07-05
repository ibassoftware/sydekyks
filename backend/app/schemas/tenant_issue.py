import uuid
from datetime import datetime

from pydantic import BaseModel


class TenantIssueOut(BaseModel):
    id: uuid.UUID
    sydekyk_id: uuid.UUID | None
    sydekyk_name: str | None
    kind: str
    title: str
    detail: str | None
    status: str
    occurrence_count: int
    first_seen_at: datetime
    last_seen_at: datetime


class MissionReviewItem(BaseModel):
    mission_id: uuid.UUID
    sydekyk_name: str | None
    document_filename: str | None
    reason: str | None
    created_at: datetime


class IssuesOut(BaseModel):
    config_issues: list[TenantIssueOut]
    missions_needing_review: list[MissionReviewItem]
