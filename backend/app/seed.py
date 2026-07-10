import os

import app.models  # noqa: F401 — ensure all platform models are registered
from app.core.config import settings
from app.core.security import hash_password
from app.db.session import Base, SessionLocal, engine
from app.models.gadget import Gadget
from app.models.sydekyk import Sydekyk
from app.models.user import User
from app.sydekyks import collect_seed_functions, discover_sydekyk_packages


def seed_admin(db):
    existing = db.query(User).filter(User.email == settings.admin_email).first()
    if existing:
        print(f"Admin user already exists: {settings.admin_email}")
        return

    admin = User(
        tenant_id=None,
        email=settings.admin_email,
        hashed_password=hash_password(settings.admin_password),
        role="super_admin",
    )
    db.add(admin)
    db.commit()
    print(f"Created super_admin user: {settings.admin_email}")


# Base catalog rows for every shared roster Sydekyk. Each package's own seed() then adds its
# capability flags + gadget requirements (see app/sydekyks/<slug>/seed.py).
_ROSTER_SYDEKYKS = [
    dict(
        name="Ledger", slug="ledger",
        tagline="Your accounts-payable sidekick — turns vendor bills into Odoo entries.",
        description=(
            "Ledger turns the vendor bills you upload or email in into Odoo vendor bills — "
            "automatically. It reads each bill with AI, pulls out the vendor, dates, line items, "
            "tax and totals, and matches them to your real Odoo setup (currency, tax, and expense "
            "account). It creates the bill in Odoo with the original document attached, posts it "
            "when it's confident, and flags anything that needs a human — a suspected duplicate, a "
            "missing tax rate, or an unfamiliar vendor."
        ),
        avatar_url="/sydekyks/ledger.png",
        system_prompt=(
            "You are Ledger, a meticulous financial assistant. Help the user track "
            "expenses, summarize spending, and keep their books accurate and current."
        ),
        model="gpt-4o-mini", temperature=0.3, chat_enabled=True, workflow_enabled=True,
    ),
    dict(
        name="Decode", slug="decode",
        tagline="Your recruitment sidekick — turns résumés into Odoo applicants.",
        description=(
            "Decode reads every résumé you upload, email in, or already have in Odoo, extracts the "
            "candidate's details with AI, and fills out their Odoo applicant record — contact info, "
            "the position they applied for (or the talent pool), skills, and a summary note. It "
            "reads the résumé's text when it can and the page images when it can't, and flags "
            "anything a recruiter should double-check."
        ),
        avatar_url="/sydekyks/decode.png",
        system_prompt=(
            "You are Decode, a meticulous recruitment assistant. Parse résumés accurately and map "
            "candidates onto the right Odoo records and skills."
        ),
        model="gpt-4o-mini", temperature=0.2, chat_enabled=False, workflow_enabled=True,
    ),
    dict(
        name="Scout", slug="scout",
        tagline="Your recruitment sidekick — scores candidates against the role.",
        description=(
            "Scout reviews the applicants in your Odoo, reads each résumé, and scores how well the "
            "candidate fits the job they applied for — with an honest breakdown of strengths, "
            "weaknesses, and highlights. It sets the applicant's evaluation stars, posts a scoring "
            "note, and tags who it has reviewed. Run it on a schedule or on demand."
        ),
        avatar_url="/sydekyks/scout.png",
        system_prompt=(
            "You are Scout, an expert technical recruiter. Score candidates fairly and specifically "
            "against the role, and explain your reasoning."
        ),
        model="gpt-4o-mini", temperature=0.2, chat_enabled=False, workflow_enabled=True,
    ),
    dict(
        name="Mirror", slug="mirror",
        tagline="Your accounts-payable watchdog — catches duplicate vendor bills before you pay twice.",
        description=(
            "Mirror scans your Odoo vendor bills and flags likely duplicates before they get paid "
            "twice. It matches on the invoice reference, on the same vendor + amount + date even when "
            "the reference differs, and across split vendor records that share a Tax ID or bank "
            "account — and uses AI to confirm resubmitted invoices by their line items. It logs every "
            "check to the bill's chatter, raises the high-confidence ones for review, and learns which "
            "recurring bills (rent, subscriptions) are legitimately identical so it stops nagging."
        ),
        avatar_url="/sydekyks/mirror.png",
        system_prompt=(
            "You are Mirror, a meticulous accounts-payable duplicate detector. Compare vendor bills "
            "and judge whether they represent the same purchase billed twice."
        ),
        model="gpt-4o-mini", temperature=0.1, chat_enabled=False, workflow_enabled=True,
    ),
]


def seed_roster_sydekyks(db):
    for spec in _ROSTER_SYDEKYKS:
        if db.query(Sydekyk).filter(Sydekyk.slug == spec["slug"]).first():
            print(f"Roster Sydekyk already exists: {spec['slug']}")
            continue
        db.add(Sydekyk(tenant_id=None, is_exclusive=False, is_published=True, **spec))
        db.commit()
        print(f"Created Roster Sydekyk: {spec['name']}")


def seed_gadgets(db):
    if not db.query(Gadget).filter(Gadget.slug == "odoo").first():
        db.add(
            Gadget(
                name="Odoo",
                slug="odoo",
                type="external",
                category="erp",
                description="Connect an Odoo instance to let Sydekyks read and act on your ERP data.",
            )
        )
        db.commit()
        print("Created Gadget: Odoo")
    else:
        print("Gadget already exists: odoo")

    if not db.query(Gadget).filter(Gadget.slug == "email").first():
        db.add(
            Gadget(
                name="Email Inbox",
                slug="email",
                type="external",
                category="email",
                description="Route inbound emails with attachments into a Sydekyk's Mission pipeline.",
            )
        )
        db.commit()
        print("Created Gadget: Email Inbox")
    else:
        print("Gadget already exists: email")


def run():
    # Import every Sydekyk package so their models.py register with metadata.
    discover_sydekyk_packages()

    # Schema is owned by Alembic — run `alembic upgrade head` before seeding. `create_all` is kept
    # only as an opt-in local/test bootstrap (SCHEMA_AUTO_CREATE=1); it never ALTERs existing
    # tables, so it must not be relied on for evolving schemas.
    if os.getenv("SCHEMA_AUTO_CREATE") == "1":
        Base.metadata.create_all(bind=engine)
        print("SCHEMA_AUTO_CREATE=1 — created any missing tables via create_all (dev/test only).")

    db = SessionLocal()
    try:
        seed_admin(db)
        seed_roster_sydekyks(db)
        seed_gadgets(db)
        # Each Sydekyk package seeds its own catalog additions (capability flags, requirements).
        for sydekyk_seed in collect_seed_functions():
            sydekyk_seed(db)
    finally:
        db.close()


if __name__ == "__main__":
    run()
