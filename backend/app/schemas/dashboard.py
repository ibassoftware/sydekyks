import uuid

from pydantic import BaseModel


class DashboardOut(BaseModel):
    tenant_id: uuid.UUID
    tenant_name: str
    tenant_slug: str
    plan: str
    plan_display_name: str
    currency: str
    roster_sydekyk_count: int
    exclusive_sydekyk_count: int
    # AI usage vs plan caps — monthly token budget + rolling-hour GPU-second capacity.
    tokens_used_this_month: int
    monthly_token_cap: int
    token_throttled: bool
    gpu_seconds_used_last_hour: float
    gpu_seconds_per_hour_cap: float
    gpu_throttled: bool
