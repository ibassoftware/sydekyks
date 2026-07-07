import uuid

from pydantic import BaseModel, Field


class MeteringConfigOut(BaseModel):
    prompt_rate: float
    generation_rate: float


class MeteringConfigUpdate(BaseModel):
    prompt_rate: float = Field(gt=0)
    generation_rate: float = Field(gt=0)


class ModelRateOut(BaseModel):
    model: str
    multiplier: float


class ModelRateUpsert(BaseModel):
    model: str = Field(min_length=1, max_length=150)
    multiplier: float = Field(ge=0)


class PlanTierOut(BaseModel):
    key: str
    display_name: str
    monthly_token_cap: int
    gpu_seconds_per_hour_cap: float
    sort_order: int


class PlanTierUpdate(BaseModel):
    display_name: str = Field(min_length=1, max_length=80)
    monthly_token_cap: int = Field(ge=0)
    gpu_seconds_per_hour_cap: float = Field(ge=0)


class TenantUsageLimitOut(BaseModel):
    tenant_id: uuid.UUID
    tenant_name: str
    plan: str
    plan_display_name: str
    monthly_token_cap: int
    tokens_used_this_month: int
    token_throttled: bool
    gpu_seconds_per_hour_cap: float
    gpu_seconds_used_last_hour: float
    gpu_throttled: bool
    # Per-tenant overrides (null = inheriting the plan default), so the editor can show/clear them.
    monthly_token_cap_override: int | None = None
    gpu_seconds_per_hour_cap_override: float | None = None


class TenantPlanUpdate(BaseModel):
    """Full replace of a tenant's plan config. An override of null means 'inherit the plan default'."""

    plan: str = Field(min_length=1, max_length=50)
    monthly_token_cap_override: int | None = Field(default=None, ge=0)
    gpu_seconds_per_hour_cap_override: float | None = Field(default=None, ge=0)
