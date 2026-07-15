"""Signet readiness — outbound email is REQUIRED (that's how signers are invited): the Postmark server
token must be set. Seal must be installed (Signet signs Seal's contracts; auto-installed on first use).
The AI engine is OPTIONAL (only used for AI-written email copy); Odoo is OPTIONAL (attach the signed PDF
back to a record).
"""

import uuid

from sqlalchemy.orm import Session

from app.models.llm_provider import TenantSydekykLLMConfig
from app.models.sydekyk import Sydekyk, SydekykInstall
from app.services import postmark_config
from app.services.gadget_links import find_assigned_link


def _item(key, label, state, detail, action_label=None, action_href=None):
    return {"key": key, "label": label, "state": state, "detail": detail,
            "action_label": action_label, "action_href": action_href}


def compute_readiness(db: Session, tenant_id: uuid.UUID, sydekyk_id: uuid.UUID) -> dict:
    items = []

    cfg = postmark_config.get_config(db)
    if cfg.encrypted_server_token:
        items.append(_item("outbound_email", "Outbound email", "ok", "Postmark server token configured", None, None))
    else:
        items.append(_item("outbound_email", "Outbound email", "blocked",
                           "Signet needs a Postmark server token to send signing invitations.",
                           "Set it in the Command Center", None))

    seal = db.query(Sydekyk).filter(Sydekyk.slug == "seal").first()
    seal_installed = seal is not None and (
        db.query(SydekykInstall)
        .filter(SydekykInstall.tenant_id == tenant_id, SydekykInstall.sydekyk_id == seal.id)
        .first()
    ) is not None
    if seal_installed:
        items.append(_item("seal_installed", "Seal (contract agent)", "ok", "Installed", None, None))
    else:
        items.append(_item("seal_installed", "Seal (contract agent)", "warn",
                           "Signet signs contracts authored in Seal — it's installed automatically when you send.",
                           "Open Seal", None))

    llm = (
        db.query(TenantSydekykLLMConfig)
        .filter(TenantSydekykLLMConfig.tenant_id == tenant_id, TenantSydekykLLMConfig.sydekyk_id == sydekyk_id)
        .first()
    )
    if llm and llm.litellm_virtual_key_encrypted and llm.litellm_model_alias:
        items.append(_item("ai_engine", "AI Engine (optional)", "ok", f"{llm.provider}", None, None))
    else:
        items.append(_item("ai_engine", "AI Engine (optional)", "warn",
                           "Add an AI engine to write personalised invitations; templates are used otherwise.",
                           "Configure AI Engine", "#ai-engine"))

    odoo_link = find_assigned_link(db, tenant_id=tenant_id, sydekyk_id=sydekyk_id, role_key="erp")
    if odoo_link is None:
        items.append(_item("odoo_assigned", "Odoo (optional)", "warn",
                           "Connect Odoo to attach the signed PDF back to a record.", "Assign Odoo", "#gadgets"))
    else:
        items.append(_item("odoo_assigned", "Odoo (optional)", "ok", odoo_link.name, None, None))

    can_send = not any(i["state"] == "blocked" for i in items)
    return {"items": items, "can_send": can_send}
