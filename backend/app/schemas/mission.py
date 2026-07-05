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
    playbook_key: str
    signal_type: str
    source: str | None = None  # web_upload | email (from the document)
    status: str
    failure_category: str | None = None
    result_summary: dict | None
    error_message: str | None
    document_filename: str | None
    parent_mission_id: uuid.UUID | None = None
    root_mission_id: uuid.UUID | None = None
    attempt_number: int = 1
    created_at: datetime
    completed_at: datetime | None


class MissionDetailOut(MissionOut):
    steps: list[MissionStepOut]


class MissionPage(BaseModel):
    items: list[MissionOut]
    total: int
    limit: int
    offset: int
