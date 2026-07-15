"""Seal's package seed — sets the playbook_key + an OPTIONAL Odoo gadget requirement on the base Seal
catalog row (created by app/seed.py), and seeds built-in starter contract templates + a default review
playbook so a new tenant isn't staring at a blank editor. Seal accepts document uploads only for the
optional "import a contract for review" path (handled in the router, not the generic intake)."""

from sqlalchemy.orm import Session

from app.models.gadget_requirement import SydekykGadgetRequirement
from app.models.sydekyk import Sydekyk

from app.sydekyks.seal.models import SealTemplate, SealTenantSettings
from app.sydekyks.seal.playbook import PLAYBOOK_KEY

# Odoo is optional for Seal (only needed to ground a draft or hand off to Odoo Sign), so is_required=False.
_REQUIREMENTS = [
    {"role_key": "erp", "gadget_category": "erp", "label": "Odoo Instance (optional)", "is_required": False},
]

DEFAULT_REVIEW_GUIDELINES = (
    "Review on behalf of our company as the party receiving obligations. Prefer: a mutual and capped "
    "limitation of liability; no automatic renewal without written notice; net-30 or better payment "
    "terms; a clear termination-for-convenience right with reasonable notice; we retain ownership of "
    "our pre-existing IP; mutual confidentiality; our home jurisdiction as governing law; and explicit "
    "data-protection obligations where personal data is processed. Flag uncapped liability, one-sided "
    "indemnities, auto-renewal traps, unfavourable payment terms, and any missing standard protections."
)

_BUILTIN_TEMPLATES = [
    {
        "name": "Mutual Non-Disclosure Agreement",
        "format": "html",
        "body": (
            "<h1>Mutual Non-Disclosure Agreement</h1>"
            "<p>This Mutual Non-Disclosure Agreement (the \"Agreement\") is entered into as of "
            "[confirm effective date] by and between [confirm Party A] and [confirm Party B] "
            "(each a \"Party\").</p>"
            "<h2>1. Confidential Information</h2><p>[confirm definition of Confidential Information]</p>"
            "<h2>2. Obligations</h2><p>Each Party shall protect the other's Confidential Information "
            "and use it solely for the Purpose.</p>"
            "<h2>3. Term</h2><p>This Agreement remains in effect for [confirm term], and confidentiality "
            "obligations survive for [confirm survival period].</p>"
            "<h2>4. Governing Law</h2><p>This Agreement is governed by the laws of [confirm jurisdiction].</p>"
            "<h2>5. Signatures</h2><p>[confirm signatory names and titles]</p>"
        ),
    },
    {
        "name": "Service Agreement",
        "format": "html",
        "body": (
            "<h1>Service Agreement</h1>"
            "<p>This Service Agreement is made between [confirm Provider] (\"Provider\") and "
            "[confirm Client] (\"Client\") as of [confirm date].</p>"
            "<h2>1. Services</h2><p>[confirm scope of services]</p>"
            "<h2>2. Fees and Payment</h2><p>Client shall pay [confirm fees], due [confirm payment terms].</p>"
            "<h2>3. Term and Termination</h2><p>[confirm term]. Either party may terminate on "
            "[confirm notice] written notice.</p>"
            "<h2>4. Intellectual Property</h2><p>[confirm IP ownership]</p>"
            "<h2>5. Limitation of Liability</h2><p>[confirm liability cap]</p>"
            "<h2>6. Confidentiality</h2><p>[confirm confidentiality terms]</p>"
            "<h2>7. Governing Law</h2><p>Governed by the laws of [confirm jurisdiction].</p>"
        ),
    },
    {
        "name": "Statement of Work (SOW)",
        "format": "md",
        "body": (
            "# Statement of Work — [confirm client]\n\n"
            "This SOW is issued under the Master Services Agreement dated [confirm MSA date].\n\n"
            "## 1. Background\n[confirm background]\n\n"
            "## 2. Deliverables\n- [confirm deliverable]\n\n"
            "## 3. Milestones & Timeline\n| Milestone | Date |\n|---|---|\n| [milestone] | [date] |\n\n"
            "## 4. Fees\n[confirm fees and payment schedule]\n\n"
            "## 5. Acceptance Criteria\n[confirm acceptance criteria]\n\n"
            "## 6. Assumptions\n- [confirm assumption]\n"
        ),
    },
    {
        "name": "Master Services Agreement (MSA)",
        "format": "html",
        "body": (
            "<h1>Master Services Agreement</h1>"
            "<p>This Master Services Agreement (\"MSA\") is entered into as of [confirm date] between "
            "[confirm Provider] and [confirm Client].</p>"
            "<h2>1. Scope</h2><p>Services are performed under Statements of Work referencing this MSA.</p>"
            "<h2>2. Payment Terms</h2><p>[confirm payment terms]</p>"
            "<h2>3. Term and Renewal</h2><p>[confirm term and renewal — avoid automatic renewal without notice]</p>"
            "<h2>4. Warranties</h2><p>[confirm warranties]</p>"
            "<h2>5. Indemnification</h2><p>[confirm indemnity — prefer mutual]</p>"
            "<h2>6. Limitation of Liability</h2><p>[confirm liability cap]</p>"
            "<h2>7. Confidentiality</h2><p>[confirm confidentiality]</p>"
            "<h2>8. Data Protection</h2><p>[confirm data-protection obligations]</p>"
            "<h2>9. Governing Law</h2><p>Governed by the laws of [confirm jurisdiction].</p>"
        ),
    },
]


def seed(db: Session) -> None:
    sydekyk = db.query(Sydekyk).filter(Sydekyk.slug == "seal").first()
    if sydekyk is None:
        print("Seal seed: base Seal Sydekyk row not found yet, skipping")
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
            db.query(SealTemplate)
            .filter(SealTemplate.tenant_id.is_(None), SealTemplate.is_builtin.is_(True),
                    SealTemplate.name == tpl["name"])
            .first()
        )
        if exists is None:
            db.add(SealTemplate(tenant_id=None, is_builtin=True, **tpl))
    db.commit()
