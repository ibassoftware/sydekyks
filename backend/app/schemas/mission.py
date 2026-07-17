import uuid
from datetime import datetime

from pydantic import BaseModel


class MissionStepOut(BaseModel):
    step_index: int
    step_key: str
    step_type: str
    status: str
    input: dict | None
    output: dict | None
    error_message: str | None
    started_at: datetime | None
    completed_at: datetime | None

    class Config:
        from_attributes = True


class MissionOut(BaseModel):
    id: uuid.UUID
    sydekyk_id: uuid.UUID
    sydekyk_name: str | None = None
    tenant_name: str | None = None  # only set by the admin Command Center (cross-tenant view)
    playbook_key: str
    signal_type: str
    source: str | None = None  # web_upload | email (from the document)
    initiated_by_email: str | None = None  # who uploaded it; null for email-ingested missions
    status: str
    failure_category: str | None = None
    result_summary: dict | None
    error_message: str | None
    document_filename: str | None
    last_step_key: str | None = None  # latest recorded step — for the live activity toast
    reviewed: bool = False  # human sign-off on a needs_review Mission
    odoo_bill_url: str | None = None  # only populated on the mission-detail endpoint, not list rows
    # Generic Odoo deep link to whatever record this Mission touched (bill, applicant, …) + its
    # button label. Also only populated on the mission-detail endpoint.
    odoo_record_url: str | None = None
    odoo_record_label: str | None = None
    parent_mission_id: uuid.UUID | None = None
    root_mission_id: uuid.UUID | None = None
    attempt_number: int = 1
    created_at: datetime
    completed_at: datetime | None


class MissionDetailOut(MissionOut):
    steps: list[MissionStepOut]


class MissionStartOut(BaseModel):
    mission_id: uuid.UUID
    status: str = "queued"


class MissionPage(BaseModel):
    items: list[MissionOut]
    total: int
    limit: int
    offset: int
