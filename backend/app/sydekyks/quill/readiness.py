"""Quill readiness — the AI engine is REQUIRED (it writes and revises the proposal). Odoo is entirely
OPTIONAL: creating a quotation and merging its PDF are opt-in extras; Quill drafts, edits, and exports
a PDF with no Odoo connection at all.
"""

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
    if llm and llm.litellm_virtual_key_encrypted and llm.litellm_model_alias:
        items.append(_item("ai_engine", "AI Engine", "ok", f"{llm.provider}", None, None))
    else:
        items.append(_item("ai_engine", "AI Engine", "blocked",
                           "Quill needs an AI engine to write and revise proposals.",
                           "Configure AI Engine", "#ai-engine"))

    odoo_link = find_assigned_link(db, tenant_id=tenant_id, sydekyk_id=sydekyk_id, role_key="erp")
    if odoo_link is None:
        items.append(_item("odoo_assigned", "Odoo (optional)", "warn",
                           "Connect Odoo to create a quotation and merge it into the proposal PDF.",
                           "Assign Odoo", "#gadgets"))
    else:
        items.append(_item("odoo_assigned", "Odoo (optional)", "ok", odoo_link.name, None, None))

    # `can_upload` gates the workbench actions (generate/chat/export). Only the AI engine is required.
    can_upload = not any(i["state"] == "blocked" for i in items)
    return {"items": items, "can_upload": can_upload}
