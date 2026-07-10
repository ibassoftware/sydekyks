"""Mirror's package seed — sets the playbook_key + gadget requirement (Odoo) on the base Mirror
catalog row (created by app/seed.py). Mirror analyses existing bills, so it accepts no uploads."""

from sqlalchemy.orm import Session

from app.models.gadget_requirement import SydekykGadgetRequirement
from app.models.sydekyk import Sydekyk

from app.sydekyks.mirror.playbook import PLAYBOOK_KEY

_REQUIREMENTS = [
    {"role_key": "erp", "gadget_category": "erp", "label": "Odoo Instance", "is_required": True},
]


def seed(db: Session) -> None:
    sydekyk = db.query(Sydekyk).filter(Sydekyk.slug == "mirror").first()
    if sydekyk is None:
        print("Mirror seed: base Mirror Sydekyk row not found yet, skipping")
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
