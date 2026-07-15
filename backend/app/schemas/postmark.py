from datetime import datetime

from pydantic import BaseModel, Field


class PostmarkConfigOut(BaseModel):
    inbound_domain: str
    has_server_token: bool
    webhook_url: str
    webhook_basic_auth_user: str
    webhook_basic_auth_pass: str
    updated_at: datetime | None


class PostmarkConfigUpdate(BaseModel):
    inbound_domain: str = Field(min_length=3)
    # Empty/omitted leaves the stored token unchanged; use the DELETE endpoint to clear it.
    server_token: str | None = None
    # Webhook Basic Auth. Empty/omitted leaves each stored value unchanged.
    webhook_basic_auth_user: str | None = None
    webhook_basic_auth_pass: str | None = None
