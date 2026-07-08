"""Scout's package seed — sets playbook_key + the Odoo (erp) gadget requirement on the base Scout
Sydekyk catalog row. No email/upload trigger, so no inbox requirement and no accepts_document_uploads.
"""

from sqlalchemy.orm import Session

from app.models.gadget_requirement import SydekykGadgetRequirement
from app.models.sydekyk import Sydekyk

from app.sydekyks.scout.playbook import PLAYBOOK_KEY

_REQUIREMENTS = [
    {"role_key": "erp", "gadget_category": "erp", "label": "Odoo Instance", "is_required": True},
]


def seed(db: Session) -> None:
    sydekyk = db.query(Sydekyk).filter(Sydekyk.slug == "scout").first()
    if sydekyk is None:
        print("Scout seed: base Scout Sydekyk row not found yet, skipping")
        return

    if sydekyk.playbook_key != PLAYBOOK_KEY:
        sydekyk.playbook_key = PLAYBOOK_KEY
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
