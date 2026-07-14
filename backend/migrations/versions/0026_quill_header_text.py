"""Quill: header_text on tenant settings (PDF running header line)

Revision ID: 0026_quill_header_text
Revises: 0025_quill_footer_text
Create Date: 2026-07-14
"""
from alembic import op
import sqlalchemy as sa

from migrations.helpers import has_column, has_table

revision = "0026_quill_header_text"
down_revision = "0025_quill_footer_text"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if has_table("quill_tenant_settings") and not has_column("quill_tenant_settings", "header_text"):
        op.add_column("quill_tenant_settings", sa.Column("header_text", sa.String(length=300), nullable=True))


def downgrade() -> None:
    if has_table("quill_tenant_settings") and has_column("quill_tenant_settings", "header_text"):
        op.drop_column("quill_tenant_settings", "header_text")
