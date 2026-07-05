from datetime import datetime

from pydantic import BaseModel, Field


class ProviderKeyOut(BaseModel):
    provider: str
    has_api_key: bool
    api_base: str | None
    updated_at: datetime | None


class ProviderKeyUpdate(BaseModel):
    api_key: str = Field(min_length=1)
    api_base: str | None = None
