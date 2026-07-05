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
    playbook_key: str
    signal_type: str
    status: str
    result_summary: dict | None
    error_message: str | None
    document_filename: str | None
    created_at: datetime
    completed_at: datetime | None


class MissionDetailOut(MissionOut):
    steps: list[MissionStepOut]
