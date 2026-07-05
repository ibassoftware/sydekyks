from pydantic import BaseModel, Field


class LedgerSettingsOut(BaseModel):
    auto_create_partner: bool
    auto_post_threshold: int


class LedgerSettingsUpdate(BaseModel):
    auto_create_partner: bool
    auto_post_threshold: int = Field(ge=0, le=100)
