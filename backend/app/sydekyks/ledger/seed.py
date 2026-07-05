"""Ledger's own seed logic, run generically by the discovery loop in app/seed.py.

The shared seed still creates Ledger's *base* catalog row (name/slug/avatar). This adds the
capability flags + playbook_key + gadget requirements idempotently — everything Ledger-owned.
"""

from sqlalchemy.orm import Session

from app.models.gadget_requirement import SydekykGadgetRequirement
from app.models.sydekyk import Sydekyk

from app.sydekyks.ledger.playbook import PLAYBOOK_KEY

_REQUIREMENTS = [
    {"role_key": "erp", "gadget_category": "erp", "label": "Odoo Instance", "is_required": True},
    {"role_key": "inbox", "gadget_category": "email", "label": "Inbound Email", "is_required": False},
]


def seed(db: Session) -> None:
    sydekyk = db.query(Sydekyk).filter(Sydekyk.slug == "ledger").first()
    if sydekyk is None:
        print("Ledger seed: base Ledger Sydekyk row not found yet, skipping")
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
        print("Ledger seed: set capability flags on Ledger Sydekyk")

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
            print(f"Ledger seed: created gadget requirement '{req['role_key']}'")
    db.commit()
