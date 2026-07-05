import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class SydekykLLMConfigOut(BaseModel):
    sydekyk_id: uuid.UUID
    provider: str  # power_core | openai | anthropic | ollama_cloud
    model: str | None
    status: str
    last_tested_at: datetime | None
    last_test_error: str | None


class SydekykLLMConfigUpdate(BaseModel):
    provider: str = Field(pattern="^(power_core|openai|anthropic|ollama_cloud)$")
    model: str | None = None


class SydekykLLMConfigTestResult(BaseModel):
    ok: bool
    message: str
    config: SydekykLLMConfigOut


class SydekykUsageOut(BaseModel):
    spend_used: float
    stale: bool


class TenantUsageBreakdownItem(BaseModel):
    sydekyk_id: uuid.UUID
    sydekyk_name: str
    spend_used: float
    stale: bool
