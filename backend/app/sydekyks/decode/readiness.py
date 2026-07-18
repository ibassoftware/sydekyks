"""Decode readiness checklist - mirrors the playbook's runtime gates (AI engine, Odoo assignment/
connection) so gaps surface before a résumé is processed. Reuses the generic gadget resolver."""

import uuid

from sqlalchemy.orm import Session

from app.models.llm_provider import TenantSydekykLLMConfig
from app.services.gadget_links import find_assigned_link


def _item(key, label, state, detail, action_label=None, action_href=None):
    return {"key": key, "label": label, "state": state, "detail": detail,
            "action_label": action_label, "action_href": action_href}


def compute_readiness(db: Session, tenant_id: uuid.UUID, sydekyk_id: uuid.UUID) -> dict:
    items = []

    llm = (
        db.query(TenantSydekykLLMConfig)
        .filter(TenantSydekykLLMConfig.tenant_id == tenant_id, TenantSydekykLLMConfig.sydekyk_id == sydekyk_id)
        .first()
    )
    if llm is None or not llm.litellm_virtual_key_encrypted or not llm.litellm_model_alias:
        items.append(_item("ai_engine", "AI Engine", "blocked",
                           "No AI engine configured for Decode.", "Configure AI Engine", "#ai-engine"))
    else:
        items.append(_item("ai_engine", "AI Engine", "ok", f"{llm.provider}", None, None))

    odoo_link = find_assigned_link(db, tenant_id=tenant_id, sydekyk_id=sydekyk_id, role_key="erp")
    if odoo_link is None:
        items.append(_item("odoo_assigned", "Odoo assigned", "blocked",
                           "No Odoo instance assigned to Decode.", "Assign Odoo", "#gadgets"))
    else:
        items.append(_item("odoo_assigned", "Odoo assigned", "ok", odoo_link.name, None, None))
        if odoo_link.status == "connected":
            items.append(_item("odoo_connection", "Odoo connection", "ok", "Connection tested OK", None, None))
        elif odoo_link.status == "error":
            items.append(_item("odoo_connection", "Odoo connection", "blocked",
                               odoo_link.last_test_error or "Connection failed.", "Fix Odoo connection", "/hq/gadgets"))
        else:
            items.append(_item("odoo_connection", "Odoo connection", "warn",
                               "Not tested yet.", "Test connection", "/hq/gadgets"))

    email_link = find_assigned_link(db, tenant_id=tenant_id, sydekyk_id=sydekyk_id, role_key="inbox")
    if email_link is None:
        items.append(_item("email_inbox", "Email inbox (optional)", "warn",
                           "No inbound email connected.", "Create Email Inbox", "#email"))
    else:
        cfg = email_link.config or {}
        addr = f"{cfg.get('inbound_local_part')}@{cfg.get('inbound_domain')}"
        items.append(_item("email_inbox", "Email inbox (optional)", "ok", addr, None, None))

    can_upload = not any(i["state"] == "blocked" and i["key"] != "email_inbox" for i in items)
    return {"items": items, "can_upload": can_upload, "last_inbound_email": None}
