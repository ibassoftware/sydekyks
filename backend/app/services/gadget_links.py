"""Generic Gadget-assignment lookup — reusable by any Sydekyk, not tied to Odoo or Ledger."""

import uuid

from sqlalchemy.orm import Session

from app.models.gadget import TenantGadgetLink
from app.models.gadget_requirement import SydekykGadgetRequirement, TenantSydekykGadgetAssignment


def find_assigned_link(
    db: Session, *, tenant_id: uuid.UUID, sydekyk_id: uuid.UUID | None, role_key: str
) -> TenantGadgetLink | None:
    """The tenant's Gadget Link assigned to a Sydekyk's named requirement (e.g. Ledger's 'erp'
    role). Re-verifies tenant ownership since callers may cross a request/background boundary."""
    if sydekyk_id is None:
        return None
    req = (
        db.query(SydekykGadgetRequirement)
        .filter(SydekykGadgetRequirement.sydekyk_id == sydekyk_id, SydekykGadgetRequirement.role_key == role_key)
        .first()
    )
    if req is None:
        return None
    assignment = (
        db.query(TenantSydekykGadgetAssignment)
        .filter(
            TenantSydekykGadgetAssignment.tenant_id == tenant_id,
            TenantSydekykGadgetAssignment.requirement_id == req.id,
        )
        .first()
    )
    if assignment is None:
        return None
    link = db.get(TenantGadgetLink, assignment.gadget_link_id)
    if link is None or link.tenant_id != tenant_id:
        return None
    return link
