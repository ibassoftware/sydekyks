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
    created_at: datetime

    class Config:
        from_attributes = True
