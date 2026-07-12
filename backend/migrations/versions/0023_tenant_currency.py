"""Tenant reporting currency

Revision ID: 0023_tenant_currency
Revises: 0022_nudge_tables
Create Date: 2026-07-12
"""
from alembic import op
import sqlalchemy as sa

from migrations.helpers import has_column

revision = "0023_tenant_currency"
down_revision = "0022_nudge_tables"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if not has_column("tenants", "currency"):
        op.add_column("tenants", sa.Column("currency", sa.String(length=3), nullable=False, server_default="USD"))


def downgrade() -> None:
    if has_column("tenants", "currency"):
        op.drop_column("tenants", "currency")
