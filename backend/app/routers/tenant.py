from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.deps import require_tenant_member
from app.db.session import get_db
from app.models.tenant import Tenant
from app.models.user import User
from app.schemas.dashboard import DashboardOut

router = APIRouter(prefix="/api/tenant", tags=["tenant"], dependencies=[Depends(require_tenant_member)])


@router.get("/dashboard", response_model=DashboardOut)
def dashboard(user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    tenant = db.get(Tenant, user.tenant_id)
    if tenant is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found")

    # Sydekyk roster / Power Meter data pipelines land in a later milestone;
    # placeholders keep the dashboard contract stable for the frontend.
    return DashboardOut(
        tenant_id=tenant.id,
        tenant_name=tenant.name,
        tenant_slug=tenant.slug,
        plan=tenant.plan,
        roster_sydekyk_count=0,
        exclusive_sydekyk_count=0,
        power_meter_used=0,
        power_meter_quota=100000,
    )
