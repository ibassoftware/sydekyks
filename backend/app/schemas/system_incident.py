import uuid
from datetime import datetime

from pydantic import BaseModel


class SystemIncidentOut(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID | None = None
    mission_id: uuid.UUID | None = None
    tenant_name: str | None = None
    source: str
    severity: str
    method: str | None = None
    path: str | None = None
    status_code: int
    error_type: str
    message: str
    traceback: str | None = None
    resolved: bool
    resolved_at: datetime | None = None
    created_at: datetime


class SystemIncidentPage(BaseModel):
    items: list[SystemIncidentOut]
    open_count: int
    memory_fallback_count: int = 0
