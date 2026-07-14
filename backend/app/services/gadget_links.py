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


def odoo_form_url(base_url: str, model: str, res_id: int) -> str:
    """The classic Odoo web-client form-view route — stable across Odoo versions for direct linking.
    Pure string builder so callers that already hold the instance URL (e.g. a cached list render)
    don't re-query the gadget assignment per row."""
    return f"{base_url.rstrip('/')}/web#id={res_id}&model={model}&view_type=form"


def assigned_odoo_base_url(db: Session, *, tenant_id: uuid.UUID, sydekyk_id: uuid.UUID | None) -> str | None:
    """The URL of the Odoo instance assigned to this Sydekyk's 'erp' role, or None."""
    link = find_assigned_link(db, tenant_id=tenant_id, sydekyk_id=sydekyk_id, role_key="erp")
    return link.url if (link and link.url) else None


def build_odoo_record_url(
    db: Session, *, tenant_id: uuid.UUID, sydekyk_id: uuid.UUID | None, model: str, res_id: int
) -> str | None:
    """A deep link straight to any Odoo record's form view, if the tenant has an Odoo instance
    assigned to this Sydekyk's 'erp' role. Generic across models (account.move for Ledger's bills,
    hr.applicant for Decode/Scout applicants) — every surface builds the same link the same way."""
    base = assigned_odoo_base_url(db, tenant_id=tenant_id, sydekyk_id=sydekyk_id)
    return odoo_form_url(base, model, res_id) if base else None


def build_odoo_bill_url(
    db: Session, *, tenant_id: uuid.UUID, sydekyk_id: uuid.UUID | None, move_id: int
) -> str | None:
    """A deep link straight to an Odoo vendor bill (account.move). Thin wrapper over
    build_odoo_record_url kept for the Ledger/Issues call sites."""
    return build_odoo_record_url(
        db, tenant_id=tenant_id, sydekyk_id=sydekyk_id, model="account.move", res_id=move_id
    )


def mission_generic_record(summary: dict | None) -> tuple[str, int, str] | None:
    """The (model, res_id, button label) for whatever Odoo record a Mission touched BEYOND a bill —
    the Decode/Scout applicant or the Nudge opportunity. Bills keep their own dedicated `odoo_bill_url`
    (with bill-specific review copy), so this deliberately ignores odoo_move_id. Single source of truth
    reused by both the mission-detail endpoints and the list-row link attachment."""
    summary = summary or {}
    applicant_id = summary.get("applicant_id")
    if applicant_id:
        return "hr.applicant", int(applicant_id), "Open applicant in Odoo"
    lead_id = summary.get("odoo_lead_id")
    if lead_id:
        return "crm.lead", int(lead_id), "Open opportunity in Odoo"
    order_id = summary.get("odoo_sale_order_id")
    if order_id:
        return "sale.order", int(order_id), "Open quotation in Odoo"
    return None


def build_mission_record_link(
    db: Session, *, tenant_id: uuid.UUID, sydekyk_id: uuid.UUID | None, summary: dict | None
) -> tuple[str | None, str | None]:
    """The generic "open in Odoo" deep link + button label for a Mission's non-bill record."""
    ref = mission_generic_record(summary)
    if ref is None:
        return None, None
    model, res_id, label = ref
    url = build_odoo_record_url(db, tenant_id=tenant_id, sydekyk_id=sydekyk_id, model=model, res_id=res_id)
    return (url, label) if url else (None, None)
