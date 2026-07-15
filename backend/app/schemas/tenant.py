import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field


class TenantCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    slug: str = Field(min_length=1, max_length=255, pattern=r"^[a-z0-9-]+$")
    commander_email: EmailStr
    commander_password: str = Field(min_length=8)


class TenantOut(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    plan: str
    commander_email: str | None = None  # the tenant's (earliest) commander login, for the Command Center
    created_at: datetime

    class Config:
        from_attributes = True


class TenantCommanderUpdate(BaseModel):
    """Fix/reset an HQ's commander login from the Command Center. Provide either (or both)."""

    email: EmailStr | None = None
    password: str | None = Field(default=None, min_length=8)
