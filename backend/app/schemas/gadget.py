import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class GadgetOut(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    type: str
    description: str

    class Config:
        from_attributes = True


class GadgetLinkCreate(BaseModel):
    gadget_slug: str
    name: str = Field(min_length=1, max_length=255)
    url: str = Field(min_length=1, max_length=500)
    database: str = Field(min_length=1, max_length=255)
    username: str = Field(min_length=1, max_length=255)
    secret: str = Field(min_length=1, description="Odoo password or API token")


class GadgetLinkUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    url: str = Field(min_length=1, max_length=500)
    database: str = Field(min_length=1, max_length=255)
    username: str = Field(min_length=1, max_length=255)
    secret: str | None = Field(default=None, description="Leave blank to keep the existing password/token")


class GadgetLinkOut(BaseModel):
    id: uuid.UUID
    gadget: GadgetOut
    name: str
    url: str
    database: str
    username: str
    status: str
    last_tested_at: datetime | None
    last_test_error: str | None
    created_at: datetime


class GadgetLinkTestResult(BaseModel):
    ok: bool
    message: str
    link: GadgetLinkOut
