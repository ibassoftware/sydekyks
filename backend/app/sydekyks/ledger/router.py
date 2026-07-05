from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.deps import require_commander, require_tenant_member
from app.db.session import get_db
from app.models.user import User

from app.sydekyks.ledger.models import LedgerTenantSettings
from app.sydekyks.ledger.schemas import LedgerSettingsOut, LedgerSettingsUpdate

router = APIRouter(prefix="/api/tenant/ledger", tags=["ledger"], dependencies=[Depends(require_tenant_member)])


def _get_or_create(db: Session, tenant_id) -> LedgerTenantSettings:
    s = db.query(LedgerTenantSettings).filter(LedgerTenantSettings.tenant_id == tenant_id).first()
    if s is None:
        s = LedgerTenantSettings(tenant_id=tenant_id)
        db.add(s)
        db.commit()
        db.refresh(s)
    return s


@router.get("/settings", response_model=LedgerSettingsOut)
def get_settings(user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    s = _get_or_create(db, user.tenant_id)
    return LedgerSettingsOut(auto_create_partner=s.auto_create_partner, auto_post_threshold=s.auto_post_threshold)


@router.put("/settings", response_model=LedgerSettingsOut)
def update_settings(
    payload: LedgerSettingsUpdate, user: User = Depends(require_commander), db: Session = Depends(get_db)
):
    s = _get_or_create(db, user.tenant_id)
    s.auto_create_partner = payload.auto_create_partner
    s.auto_post_threshold = payload.auto_post_threshold
    db.commit()
    db.refresh(s)
    return LedgerSettingsOut(auto_create_partner=s.auto_create_partner, auto_post_threshold=s.auto_post_threshold)
