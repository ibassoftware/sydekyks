"""Ledger readiness checklist (VS-1) - Ledger-owned, deliberately NOT a generic framework.

Computes, from existing tables, whether a tenant has everything Ledger needs before a bill can be
processed, and the exact next action for each gap. Mirrors the checks the playbook performs at
runtime (AI engine, Odoo assignment/connection) so failures surface *before* an upload, not after.
"""

import uuid

from sqlalchemy.orm import Session

from app.models.email_event import EmailIngestEvent
from app.models.gadget import TenantGadgetLink
from app.models.gadget_requirement import SydekykGadgetRequirement, TenantSydekykGadgetAssignment
from app.models.llm_provider import TenantSydekykLLMConfig
from app.models.mission import Mission
from app.sydekyks.ledger.models import LedgerTenantSettings


def _item(key, label, state, detail, action_label=None, action_href=None):
    return {"key": key, "label": label, "state": state, "detail": detail,
            "action_label": action_label, "action_href": action_href}


def _assigned_link(db: Session, tenant_id, sydekyk_id, role_key) -> TenantGadgetLink | None:
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
    return link if link and link.tenant_id == tenant_id else None


def compute_readiness(db: Session, tenant_id: uuid.UUID, sydekyk_id: uuid.UUID) -> dict:
    items = []

    # --- AI engine -----------------------------------------------------------------------------
    llm = (
        db.query(TenantSydekykLLMConfig)
        .filter(
            TenantSydekykLLMConfig.tenant_id == tenant_id,
            TenantSydekykLLMConfig.sydekyk_id == sydekyk_id,
        )
        .first()
    )
    settings_row = db.query(LedgerTenantSettings).filter(LedgerTenantSettings.tenant_id == tenant_id).first()
    vision_ok = bool(settings_row and settings_row.ledger_vision_ok)

    if llm is None or not llm.litellm_virtual_key_encrypted or not llm.litellm_model_alias:
        items.append(_item("ai_engine", "AI Engine", "blocked",
                           "No AI engine configured for Ledger.", "Configure AI Engine", "#ai-engine"))
    elif not vision_ok:
        items.append(_item("ai_engine", "AI Engine", "warn",
                           "Engine set, but not yet verified to read invoices. Run the document-reading "
                           "test with a sample bill.", "Test document reading", "#ledger-vision"))
    else:
        items.append(_item("ai_engine", "AI Engine", "ok",
                           f"{llm.provider} · vision verified", None, None))

    # --- Odoo assignment -----------------------------------------------------------------------
    odoo_link = _assigned_link(db, tenant_id, sydekyk_id, "erp")
    if odoo_link is None:
        items.append(_item("odoo_assigned", "Odoo assigned", "blocked",
                           "No Odoo instance assigned to Ledger.", "Assign Odoo", "#gadgets"))
    else:
        items.append(_item("odoo_assigned", "Odoo assigned", "ok", odoo_link.name, None, None))

        # --- Odoo connection (only meaningful once assigned) -----------------------------------
        if odoo_link.status == "connected":
            items.append(_item("odoo_connection", "Odoo connection", "ok", "Connection tested OK", None, None))
        elif odoo_link.status == "error":
            items.append(_item("odoo_connection", "Odoo connection", "blocked",
                               odoo_link.last_test_error or "Connection failed.", "Fix Odoo connection", "/hq/gadgets"))
        else:
            items.append(_item("odoo_connection", "Odoo connection", "warn",
                               "Not tested yet.", "Test connection", "/hq/gadgets"))

    # --- Email inbox (optional) ----------------------------------------------------------------
    email_link = _assigned_link(db, tenant_id, sydekyk_id, "inbox")
    if email_link is None:
        items.append(_item("email_inbox", "Email inbox (optional)", "warn",
                           "No inbound email connected.", "Create Email Inbox", "#email"))
    else:
        addr = f"{(email_link.config or {}).get('inbound_local_part')}@{(email_link.config or {}).get('inbound_domain')}"
        items.append(_item("email_inbox", "Email inbox (optional)", "ok", addr, None, None))

    # --- Last inbound email (informational) ----------------------------------------------------
    # Scope to THIS Sydekyk's inbox, not tenant-wide - otherwise an unrelated Sydekyk's inbound
    # email would show up as Ledger's "last inbound" (matters at Sydekyk #2).
    last_event = (
        db.query(EmailIngestEvent)
        .filter(EmailIngestEvent.tenant_id == tenant_id, EmailIngestEvent.matched_sydekyk_id == sydekyk_id)
        .order_by(EmailIngestEvent.created_at.desc())
        .first()
    )
    last_email_mission = (
        db.query(Mission)
        .filter(Mission.tenant_id == tenant_id, Mission.sydekyk_id == sydekyk_id, Mission.signal_type == "email")
        .order_by(Mission.created_at.desc())
        .first()
    )
    last_inbound = None
    if last_event is not None:
        last_inbound = last_event.created_at.isoformat()
    elif last_email_mission is not None:
        last_inbound = last_email_mission.created_at.isoformat()

    # Upload is blocked only by *required* gaps; email items never block.
    can_upload = not any(i["state"] == "blocked" and i["key"] != "email_inbox" for i in items)
    return {"items": items, "can_upload": can_upload, "last_inbound_email": last_inbound}
