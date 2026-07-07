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
    resolved_at: datetime | None = None
    odoo_bill_url: str | None = None


class MissionReviewItem(BaseModel):
    mission_id: uuid.UUID
    sydekyk_name: str | None
    document_filename: str | None
    reason: str | None
    created_at: datetime
    # Richer context for the expandable row (all from the Mission's result_summary).
    odoo_bill_url: str | None = None
    vendor_name: str | None = None
    invoice_number: str | None = None
    total: float | None = None
    currency: str | None = None
    posted: bool | None = None
    duplicate: bool | None = None
    # Human sign-off state + audit.
    reviewed: bool = False
    reviewed_at: datetime | None = None
    reviewed_by_email: str | None = None


class IssuesOut(BaseModel):
    config_issues: list[TenantIssueOut]
    resolved_issues: list[TenantIssueOut]
    missions_needing_review: list[MissionReviewItem]


class IssuesCountOut(BaseModel):
    config_issues: int
    missions_needing_review: int
    total: int


class MissionReviewStatusOut(BaseModel):
    mission_id: uuid.UUID
    reviewed: bool
    reviewed_at: datetime | None = None
    reviewed_by_email: str | None = None
