"""baseline — pre-Alembic schema as of adoption

Establishes the schema that existed before Alembic was introduced (built until now by
`Base.metadata.create_all` + manual ALTERs). It reproduces ONLY those pre-existing tables, by
name, from the model metadata — so every later slice migration (which adds new tables/columns)
stays the single source of truth for its own change and never collides with this baseline.

On an existing demo/staging DB, run `alembic stamp 0001_baseline` instead of upgrading, then
`alembic upgrade head` to apply the post-baseline slice migrations. On a fresh DB, `alembic
upgrade head` builds everything from scratch.

Revision ID: 0001_baseline
Revises:
Create Date: 2026-07-05
"""
from alembic import op

from app.db.session import Base
import app.models  # noqa: F401 — register platform tables on the metadata
from app.sydekyks import discover_sydekyk_packages

revision = "0001_baseline"
down_revision = None
branch_labels = None
depends_on = None

# The tables that existed before Alembic. New tables introduced by later slices are deliberately
# absent here and are created by their own migrations.
BASELINE_TABLES = [
    "tenants",
    "users",
    "sydekyks",
    "sydekyk_installs",
    "gadgets",
    "tenant_gadget_links",
    "sydekyk_gadget_requirements",
    "tenant_sydekyk_gadget_assignments",
    "tenant_provider_credentials",
    "sydekyk_hosted_assignments",
    "tenant_sydekyk_llm_configs",
    "central_provider_keys",
    "tenant_sydekyk_usage_snapshots",
    "missions",
    "mission_steps",
    "mission_documents",
    "ledger_tenant_settings",
]


def _baseline_tables():
    discover_sydekyk_packages()  # ensure ledger_tenant_settings is registered
    return [Base.metadata.tables[name] for name in BASELINE_TABLES if name in Base.metadata.tables]


def upgrade() -> None:
    bind = op.get_bind()
    Base.metadata.create_all(bind=bind, tables=_baseline_tables(), checkfirst=True)


def downgrade() -> None:
    bind = op.get_bind()
    Base.metadata.drop_all(bind=bind, tables=list(reversed(_baseline_tables())))
