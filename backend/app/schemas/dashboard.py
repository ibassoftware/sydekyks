import uuid

from pydantic import BaseModel


class DashboardOut(BaseModel):
    tenant_id: uuid.UUID
    tenant_name: str
    tenant_slug: str
    plan: str
    roster_sydekyk_count: int
    exclusive_sydekyk_count: int
    power_meter_used: float
    power_meter_quota: float | None
    power_meter_stale: bool
