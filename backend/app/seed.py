from app.core.config import settings
from app.core.security import hash_password
from app.db.session import Base, SessionLocal, engine
from app.models.gadget import Gadget
from app.models.sydekyk import Sydekyk
from app.models.user import User


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


def seed_roster_sydekyks(db):
    existing = db.query(Sydekyk).filter(Sydekyk.slug == "ledger").first()
    if existing:
        print("Roster Sydekyk already exists: ledger")
        return

    ledger = Sydekyk(
        tenant_id=None,
        name="Ledger",
        slug="ledger",
        tagline="Your finance sidekick, always balancing the books.",
        description=(
            "Ledger keeps a hero eye on invoices, expenses, and cash flow. "
            "Ask for a spend summary, reconcile transactions, or hand off recurring "
            "bookkeeping to a Playbook and let Ledger run it on a schedule."
        ),
        avatar_url="/sydekyks/ledger.png",
        system_prompt=(
            "You are Ledger, a meticulous financial assistant. Help the user track "
            "expenses, summarize spending, and keep their books accurate and current."
        ),
        model="gpt-4o-mini",
        temperature=0.3,
        is_exclusive=False,
        is_published=True,
        chat_enabled=True,
        workflow_enabled=True,
    )
    db.add(ledger)
    db.commit()
    print("Created Roster Sydekyk: Ledger")


def seed_gadgets(db):
    existing = db.query(Gadget).filter(Gadget.slug == "odoo").first()
    if existing:
        print("Gadget already exists: odoo")
        return

    odoo = Gadget(
        name="Odoo",
        slug="odoo",
        type="external",
        description="Connect an Odoo instance to let Sydekyks read and act on your ERP data.",
    )
    db.add(odoo)
    db.commit()
    print("Created Gadget: Odoo")


def run():
    Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    try:
        seed_admin(db)
        seed_roster_sydekyks(db)
        seed_gadgets(db)
    finally:
        db.close()


if __name__ == "__main__":
    run()
