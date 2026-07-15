"""Signet's package seed — sets the playbook_key + an OPTIONAL Odoo gadget requirement on the base
Signet catalog row (created by app/seed.py). Signet sends email and hosts a public signing page; it
accepts no document uploads through the generic intake (its source PDFs come from Seal or a direct
upload on the envelope)."""

from sqlalchemy.orm import Session

from app.models.gadget_requirement import SydekykGadgetRequirement
from app.models.sydekyk import Sydekyk

from app.sydekyks.signet.playbook import PLAYBOOK_KEY

# Odoo is optional for Signet (only to attach the signed PDF back to a record), so is_required=False.
_REQUIREMENTS = [
    {"role_key": "erp", "gadget_category": "erp", "label": "Odoo Instance (optional)", "is_required": False},
]


def seed(db: Session) -> None:
    sydekyk = db.query(Sydekyk).filter(Sydekyk.slug == "signet").first()
    if sydekyk is None:
        print("Signet seed: base Signet Sydekyk row not found yet, skipping")
        return

    if sydekyk.playbook_key != PLAYBOOK_KEY:
        sydekyk.playbook_key = PLAYBOOK_KEY
        db.commit()

    for req in _REQUIREMENTS:
        exists = (
            db.query(SydekykGadgetRequirement)
            .filter(SydekykGadgetRequirement.sydekyk_id == sydekyk.id,
                    SydekykGadgetRequirement.role_key == req["role_key"])
            .first()
        )
        if exists is None:
            db.add(SydekykGadgetRequirement(sydekyk_id=sydekyk.id, **req))
    db.commit()
