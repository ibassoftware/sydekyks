"""Mirror: include_drafts toggle on settings

Revision ID: 0020_mirror_include_drafts
Revises: 0019_shield_tables
Create Date: 2026-07-11
"""
from alembic import op
import sqlalchemy as sa

from migrations.helpers import has_column

revision = "0020_mirror_include_drafts"
down_revision = "0019_shield_tables"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if not has_column("mirror_tenant_settings", "include_drafts"):
        op.add_column(
            "mirror_tenant_settings",
            sa.Column("include_drafts", sa.Boolean(), nullable=False, server_default=sa.true()),
        )
        op.alter_column("mirror_tenant_settings", "include_drafts", server_default=None)


def downgrade() -> None:
    if has_column("mirror_tenant_settings", "include_drafts"):
        op.drop_column("mirror_tenant_settings", "include_drafts")
