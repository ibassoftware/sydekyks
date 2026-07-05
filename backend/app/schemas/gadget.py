import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class GadgetOut(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    type: str
    category: str
    description: str

    class Config:
        from_attributes = True


class GadgetLinkCreate(BaseModel):
    gadget_slug: str
    name: str = Field(min_length=1, max_length=255)
    # ERP (Odoo) fields — optional at the schema layer; the router validates per gadget category.
    url: str | None = Field(default=None, max_length=500)
    database: str | None = Field(default=None, max_length=255)
    username: str | None = Field(default=None, max_length=255)
    secret: str | None = Field(default=None, description="Odoo password or API token")


class GadgetLinkUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    url: str | None = Field(default=None, max_length=500)
    database: str | None = Field(default=None, max_length=255)
    username: str | None = Field(default=None, max_length=255)
    secret: str | None = Field(default=None, description="Leave blank to keep the existing password/token")


class GadgetLinkOut(BaseModel):
    id: uuid.UUID
    gadget: GadgetOut
    name: str
    category: str
    url: str | None
    database: str | None
    username: str | None
    inbound_address: str | None
    status: str
    last_tested_at: datetime | None
    last_test_error: str | None
    created_at: datetime


class GadgetLinkTestResult(BaseModel):
    ok: bool
    message: str
    link: GadgetLinkOut
