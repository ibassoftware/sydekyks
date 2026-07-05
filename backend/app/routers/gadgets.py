import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.crypto import decrypt_secret, encrypt_secret
from app.core.deps import require_commander, require_tenant_member
from app.db.session import get_db
from app.models.gadget import Gadget, TenantGadgetLink
from app.models.user import User
from app.schemas.gadget import GadgetLinkCreate, GadgetLinkOut, GadgetLinkTestResult, GadgetLinkUpdate, GadgetOut
from app.services import odoo

router = APIRouter(prefix="/api/tenant", tags=["gadgets"], dependencies=[Depends(require_tenant_member)])


def _to_link_out(link: TenantGadgetLink) -> GadgetLinkOut:
    return GadgetLinkOut(
        id=link.id,
        gadget=GadgetOut.model_validate(link.gadget, from_attributes=True),
        name=link.name,
        url=link.url,
        database=link.database,
        username=link.username,
        status=link.status,
        last_tested_at=link.last_tested_at,
        last_test_error=link.last_test_error,
        created_at=link.created_at,
    )


@router.get("/gadgets", response_model=list[GadgetOut])
def list_gadgets(db: Session = Depends(get_db)):
    return db.query(Gadget).order_by(Gadget.name.asc()).all()


@router.get("/gadget-links", response_model=list[GadgetLinkOut])
def list_gadget_links(user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    links = (
        db.query(TenantGadgetLink)
        .filter(TenantGadgetLink.tenant_id == user.tenant_id)
        .order_by(TenantGadgetLink.created_at.desc())
        .all()
    )
    return [_to_link_out(link) for link in links]


@router.post("/gadget-links", response_model=GadgetLinkOut, status_code=status.HTTP_201_CREATED)
def create_gadget_link(
    payload: GadgetLinkCreate, user: User = Depends(require_commander), db: Session = Depends(get_db)
):
    gadget = db.query(Gadget).filter(Gadget.slug == payload.gadget_slug).first()
    if gadget is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown integration")

    link = TenantGadgetLink(
        tenant_id=user.tenant_id,
        gadget_id=gadget.id,
        name=payload.name,
        url=payload.url,
        database=payload.database,
        username=payload.username,
        encrypted_secret=encrypt_secret(payload.secret),
        status="untested",
    )
    db.add(link)
    db.commit()
    db.refresh(link)
    return _to_link_out(link)


def _get_link(db: Session, tenant_id: uuid.UUID, link_id: uuid.UUID) -> TenantGadgetLink:
    link = (
        db.query(TenantGadgetLink)
        .filter(TenantGadgetLink.id == link_id, TenantGadgetLink.tenant_id == tenant_id)
        .first()
    )
    if link is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Integration not found")
    return link


@router.patch("/gadget-links/{link_id}", response_model=GadgetLinkOut)
def update_gadget_link(
    link_id: uuid.UUID,
    payload: GadgetLinkUpdate,
    user: User = Depends(require_commander),
    db: Session = Depends(get_db),
):
    link = _get_link(db, user.tenant_id, link_id)

    link.name = payload.name
    link.url = payload.url
    link.database = payload.database
    link.username = payload.username
    if payload.secret:
        link.encrypted_secret = encrypt_secret(payload.secret)
    link.status = "untested"
    link.last_tested_at = None
    link.last_test_error = None

    db.commit()
    db.refresh(link)
    return _to_link_out(link)


@router.post("/gadget-links/{link_id}/test", response_model=GadgetLinkTestResult)
def test_gadget_link(link_id: uuid.UUID, user: User = Depends(require_commander), db: Session = Depends(get_db)):
    link = _get_link(db, user.tenant_id, link_id)
    secret = decrypt_secret(link.encrypted_secret)

    ok, message = odoo.test_connection(link.url, link.database, link.username, secret)

    link.status = "connected" if ok else "error"
    link.last_tested_at = datetime.now(timezone.utc)
    link.last_test_error = None if ok else message
    db.commit()
    db.refresh(link)

    return GadgetLinkTestResult(ok=ok, message=message, link=_to_link_out(link))


@router.delete("/gadget-links/{link_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_gadget_link(link_id: uuid.UUID, user: User = Depends(require_commander), db: Session = Depends(get_db)):
    link = _get_link(db, user.tenant_id, link_id)
    db.delete(link)
    db.commit()
