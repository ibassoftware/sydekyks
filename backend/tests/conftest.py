"""Test fixtures.

DB-backed tests run against a real Postgres (models use JSONB/bytea/UUID, so SQLite would give
false confidence — VS-10). Set TEST_DATABASE_URL to point at a throwaway database; if it can't be
reached, the DB-backed tests are skipped rather than failing the whole run.
"""

import os
import uuid

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.session import Base
import app.models  # noqa: F401 — register all tables
from app.sydekyks import discover_sydekyk_packages

discover_sydekyk_packages()

TEST_DB_URL = os.getenv("TEST_DATABASE_URL", "postgresql+psycopg://sydekyks:sydekyks@localhost:5432/sydekyks_test")


@pytest.fixture(scope="session")
def engine():
    try:
        eng = create_engine(TEST_DB_URL)
        conn = eng.connect()
        conn.close()
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"No test database reachable at {TEST_DB_URL}: {exc}")
    Base.metadata.create_all(bind=eng)
    yield eng
    Base.metadata.drop_all(bind=eng)


@pytest.fixture
def db(engine):
    Session = sessionmaker(bind=engine)
    session = Session()
    # Clean slate per test.
    for table in reversed(Base.metadata.sorted_tables):
        session.execute(table.delete())
    session.commit()
    yield session
    session.rollback()
    session.close()


@pytest.fixture
def seeded(db):
    """Minimal tenant + Ledger Sydekyk + requirements + Odoo link/assignment + LLM config."""
    from app.models.gadget import Gadget, TenantGadgetLink
    from app.models.gadget_requirement import SydekykGadgetRequirement, TenantSydekykGadgetAssignment
    from app.models.llm_provider import TenantSydekykLLMConfig
    from app.models.sydekyk import Sydekyk
    from app.models.tenant import Tenant
    from app.core.crypto import encrypt_secret

    tenant = Tenant(name="Acme", slug="acme")
    db.add(tenant)
    db.flush()

    ledger = Sydekyk(
        tenant_id=None, name="Ledger", slug="ledger", tagline="t", description="d",
        avatar_url="/x.png", system_prompt="p", model="gpt-4o-mini", temperature=0.3,
        is_exclusive=False, is_published=True, chat_enabled=True, workflow_enabled=True,
        accepts_document_uploads=True, playbook_key="ledger.vendor_bill_ingest",
    )
    db.add(ledger)
    db.flush()

    erp_gadget = Gadget(name="Odoo", slug="odoo", type="external", category="erp", description="")
    db.add(erp_gadget)
    db.flush()
    erp_req = SydekykGadgetRequirement(sydekyk_id=ledger.id, role_key="erp", gadget_category="erp",
                                       label="Odoo", is_required=True)
    inbox_req = SydekykGadgetRequirement(sydekyk_id=ledger.id, role_key="inbox", gadget_category="email",
                                         label="Inbox", is_required=False)
    db.add_all([erp_req, inbox_req])
    db.flush()

    odoo_link = TenantGadgetLink(tenant_id=tenant.id, gadget_id=erp_gadget.id, name="Prod Odoo",
                                 url="http://odoo", database="db", username="u",
                                 encrypted_secret=encrypt_secret("secret"), status="connected")
    db.add(odoo_link)
    db.flush()
    db.add(TenantSydekykGadgetAssignment(tenant_id=tenant.id, requirement_id=erp_req.id, gadget_link_id=odoo_link.id))

    llm = TenantSydekykLLMConfig(tenant_id=tenant.id, sydekyk_id=ledger.id, provider="power_core",
                                 litellm_model_alias="ledger-hosted",
                                 litellm_virtual_key_encrypted=encrypt_secret("sk-virtual"), status="connected")
    db.add(llm)
    db.commit()
    return {"tenant": tenant, "ledger": ledger, "odoo_link": odoo_link}
