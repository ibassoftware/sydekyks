import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field

# Roles a commander may assign within their own HQ. (super_admin is platform-level, never set here.)
TENANT_ROLES = ("commander", "hero")


class TeamUserOut(BaseModel):
    id: uuid.UUID
    email: str
    role: str
    created_at: datetime
    is_self: bool = False


class TeamUserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    role: str = Field(default="hero")


class TeamUserRoleUpdate(BaseModel):
    role: str


class TeamUserPasswordReset(BaseModel):
    password: str = Field(min_length=8)


class SydekykPermissionOut(BaseModel):
    sydekyk_id: uuid.UUID
    sydekyk_name: str
    is_exclusive: bool
    can_use: bool
    can_configure: bool


class SydekykPermissionUpdate(BaseModel):
    can_use: bool
    can_configure: bool
