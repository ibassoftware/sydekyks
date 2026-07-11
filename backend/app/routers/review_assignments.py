"""Shared review-assignment endpoints (DRY) — keyed by sydekyk_id, so every agent uses the same tool:
list the tenant's Odoo users for the picker, and get/set which of them get an activity when the agent
flags something."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.crypto import decrypt_secret
from app.core.deps import require_tenant_member
from app.db.session import get_db
from app.models.sydekyk import Sydekyk
from app.models.user import User
from app.services import gadget_links, odoo, odoo_activity, permissions, review_assignment

router = APIRouter(prefix="/api/tenant", tags=["review-assignments"], dependencies=[Depends(require_tenant_member)])


class OdooUser(BaseModel):
    id: int
    name: str
    login: str | None = None


class ReviewerConfigOut(BaseModel):
    create_activity: bool
    odoo_user_ids: list[int]
    activity_days: int


class ReviewerConfigUpdate(BaseModel):
    create_activity: bool
    odoo_user_ids: list[int] = []
    activity_days: int = Field(default=3, ge=0, le=60)


def _sydekyk(db: Session, user: User, sydekyk_id: uuid.UUID) -> Sydekyk:
    sydekyk = (
        db.query(Sydekyk)
        .filter(Sydekyk.id == sydekyk_id, Sydekyk.is_published.is_(True),
                or_(Sydekyk.tenant_id.is_(None), Sydekyk.tenant_id == user.tenant_id))
        .first()
    )
    if sydekyk is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sydekyk not found")
    return sydekyk


@router.get("/sydekyks/{sydekyk_id}/odoo-users", response_model=list[OdooUser])
def list_odoo_users(sydekyk_id: uuid.UUID, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    """The tenant's internal Odoo users (for the reviewer picker). Empty if no Odoo is assigned."""
    _sydekyk(db, user, sydekyk_id)
    link = gadget_links.find_assigned_link(db, tenant_id=user.tenant_id, sydekyk_id=sydekyk_id, role_key="erp")
    if link is None:
        return []
    ok, _msg, client = odoo.connect(link.url, link.database, link.username, decrypt_secret(link.encrypted_secret))
    if not ok or client is None:
        return []
    return [OdooUser(**u) for u in odoo_activity.list_internal_users(client)]


@router.get("/sydekyks/{sydekyk_id}/reviewers", response_model=ReviewerConfigOut)
def get_reviewers(sydekyk_id: uuid.UUID, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    _sydekyk(db, user, sydekyk_id)
    ra = review_assignment.get(db, user.tenant_id, sydekyk_id)
    if ra is None:
        return ReviewerConfigOut(create_activity=False, odoo_user_ids=[], activity_days=3)
    return ReviewerConfigOut(
        create_activity=ra.create_activity, odoo_user_ids=[int(u) for u in (ra.odoo_user_ids or [])],
        activity_days=ra.activity_days,
    )


@router.put("/sydekyks/{sydekyk_id}/reviewers", response_model=ReviewerConfigOut)
def set_reviewers(sydekyk_id: uuid.UUID, payload: ReviewerConfigUpdate, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    sydekyk = _sydekyk(db, user, sydekyk_id)
    permissions.assert_can_configure(db, user, sydekyk.id)
    ra = review_assignment.get_or_create(db, user.tenant_id, sydekyk_id)
    ra.create_activity = payload.create_activity
    ra.odoo_user_ids = [int(u) for u in payload.odoo_user_ids]
    ra.activity_days = payload.activity_days
    db.commit()
    db.refresh(ra)
    return ReviewerConfigOut(
        create_activity=ra.create_activity, odoo_user_ids=[int(u) for u in (ra.odoo_user_ids or [])],
        activity_days=ra.activity_days,
    )
