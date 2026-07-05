import uuid
from datetime import datetime

from pydantic import BaseModel


class SydekykOut(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    tagline: str
    description: str
    avatar_url: str
    model: str
    is_exclusive: bool
    chat_enabled: bool
    workflow_enabled: bool
    installed: bool
    created_at: datetime

    class Config:
        from_attributes = True


class SydekykAdminOut(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID | None
    name: str
    slug: str
    tagline: str
    description: str
    avatar_url: str
    model: str
    is_exclusive: bool
    is_published: bool
    chat_enabled: bool
    workflow_enabled: bool
    created_at: datetime

    class Config:
        from_attributes = True
