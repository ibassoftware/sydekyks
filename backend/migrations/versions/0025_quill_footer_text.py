"""Quill: footer_text on tenant settings (PDF footer line)

Revision ID: 0025_quill_footer_text
Revises: 0024_quill_tables
Create Date: 2026-07-14
"""
from alembic import op
import sqlalchemy as sa

from migrations.helpers import has_column, has_table

revision = "0025_quill_footer_text"
down_revision = "0024_quill_tables"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if has_table("quill_tenant_settings") and not has_column("quill_tenant_settings", "footer_text"):
        op.add_column("quill_tenant_settings", sa.Column("footer_text", sa.String(length=300), nullable=True))


def downgrade() -> None:
    if has_table("quill_tenant_settings") and has_column("quill_tenant_settings", "footer_text"):
        op.drop_column("quill_tenant_settings", "footer_text")
