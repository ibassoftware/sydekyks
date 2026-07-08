"""Decode's package seed — sets capability flags + playbook_key + gadget requirements on the base
Decode Sydekyk catalog row (created by app/seed.py). Idempotent, run by the discovery loop."""

from sqlalchemy.orm import Session

from app.models.gadget_requirement import SydekykGadgetRequirement
from app.models.sydekyk import Sydekyk

from app.sydekyks.decode.playbook import PLAYBOOK_KEY

_REQUIREMENTS = [
    {"role_key": "erp", "gadget_category": "erp", "label": "Odoo Instance", "is_required": True},
    {"role_key": "inbox", "gadget_category": "email", "label": "Inbound Email", "is_required": False},
]


def seed(db: Session) -> None:
    sydekyk = db.query(Sydekyk).filter(Sydekyk.slug == "decode").first()
    if sydekyk is None:
        print("Decode seed: base Decode Sydekyk row not found yet, skipping")
        return

    changed = False
    if not sydekyk.accepts_document_uploads:
        sydekyk.accepts_document_uploads = True
        changed = True
    if sydekyk.playbook_key != PLAYBOOK_KEY:
        sydekyk.playbook_key = PLAYBOOK_KEY
        changed = True
    if changed:
        db.commit()

    for req in _REQUIREMENTS:
        exists = (
            db.query(SydekykGadgetRequirement)
            .filter(
                SydekykGadgetRequirement.sydekyk_id == sydekyk.id,
                SydekykGadgetRequirement.role_key == req["role_key"],
            )
            .first()
        )
        if exists is None:
            db.add(SydekykGadgetRequirement(sydekyk_id=sydekyk.id, **req))
    db.commit()
