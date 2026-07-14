"""Quill's package seed — sets the playbook_key + an OPTIONAL Odoo gadget requirement on the base
Quill catalog row (created by app/seed.py), and seeds a couple of built-in starter templates so a new
tenant isn't staring at a blank editor. Quill accepts no document uploads (it authors, not ingests)."""

from sqlalchemy.orm import Session

from app.models.gadget_requirement import SydekykGadgetRequirement
from app.models.sydekyk import Sydekyk

from app.sydekyks.quill.models import QuillTemplate
from app.sydekyks.quill.playbook import PLAYBOOK_KEY

# Odoo is optional for Quill (only needed to raise/merge a quotation), so is_required=False.
_REQUIREMENTS = [
    {"role_key": "erp", "gadget_category": "erp", "label": "Odoo Instance (optional)", "is_required": False},
]

_BUILTIN_TEMPLATES = [
    {
        "name": "Standard business proposal",
        "format": "html",
        "body": (
            "<h1>Proposal for [confirm client name]</h1>"
            "<h2>Overview</h2><p>[confirm the one-paragraph summary of what we're proposing]</p>"
            "<h2>Objectives</h2><ul><li>[confirm objective]</li></ul>"
            "<h2>Scope of work</h2><p>[confirm scope]</p>"
            "<h2>Timeline</h2><p>[confirm timeline]</p>"
            "<h2>Investment</h2><table><tr><th>Item</th><th>Description</th><th>Price</th></tr>"
            "<tr><td>[item]</td><td>[description]</td><td>[price]</td></tr></table>"
            "<h2>Next steps</h2><p>[confirm next steps]</p>"
        ),
    },
    {
        "name": "Services statement of work",
        "format": "md",
        "body": (
            "# Statement of Work — [confirm client]\n\n"
            "## Background\n[confirm background]\n\n"
            "## Deliverables\n- [confirm deliverable]\n\n"
            "## Milestones & timeline\n| Milestone | Date |\n|---|---|\n| [milestone] | [date] |\n\n"
            "## Pricing\n[confirm pricing]\n\n"
            "## Assumptions\n- [confirm assumption]\n\n"
            "## Acceptance\n[confirm acceptance criteria]\n"
        ),
    },
]


def seed(db: Session) -> None:
    sydekyk = db.query(Sydekyk).filter(Sydekyk.slug == "quill").first()
    if sydekyk is None:
        print("Quill seed: base Quill Sydekyk row not found yet, skipping")
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

    for tpl in _BUILTIN_TEMPLATES:
        exists = (
            db.query(QuillTemplate)
            .filter(QuillTemplate.tenant_id.is_(None), QuillTemplate.is_builtin.is_(True),
                    QuillTemplate.name == tpl["name"])
            .first()
        )
        if exists is None:
            db.add(QuillTemplate(tenant_id=None, is_builtin=True, **tpl))
    db.commit()
