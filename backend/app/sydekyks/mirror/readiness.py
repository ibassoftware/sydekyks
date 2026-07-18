"""Mirror readiness - Odoo is required; the AI engine is OPTIONAL (only used to confirm ambiguous
same-amount/different-reference duplicates by their line items, so Mirror still runs without it)."""

import uuid

from sqlalchemy.orm import Session

from app.models.llm_provider import TenantSydekykLLMConfig
from app.services.gadget_links import find_assigned_link


def _item(key, label, state, detail, action_label=None, action_href=None):
    return {"key": key, "label": label, "state": state, "detail": detail,
            "action_label": action_label, "action_href": action_href}


def compute_readiness(db: Session, tenant_id: uuid.UUID, sydekyk_id: uuid.UUID) -> dict:
    items = []

    odoo_link = find_assigned_link(db, tenant_id=tenant_id, sydekyk_id=sydekyk_id, role_key="erp")
    if odoo_link is None:
        items.append(_item("odoo_assigned", "Odoo assigned", "blocked",
                           "No Odoo instance assigned to Mirror.", "Assign Odoo", "#gadgets"))
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

    llm = (
        db.query(TenantSydekykLLMConfig)
        .filter(TenantSydekykLLMConfig.tenant_id == tenant_id, TenantSydekykLLMConfig.sydekyk_id == sydekyk_id)
        .first()
    )
    if llm and llm.litellm_virtual_key_encrypted and llm.litellm_model_alias:
        items.append(_item("ai_engine", "AI Engine (optional)", "ok", f"{llm.provider}", None, None))
    else:
        items.append(_item("ai_engine", "AI Engine (optional)", "warn",
                           "Line-item confirmation is off until an engine is set.", "Configure AI Engine", "#ai-engine"))

    can_upload = not any(i["state"] == "blocked" for i in items)
    return {"items": items, "can_upload": can_upload}
