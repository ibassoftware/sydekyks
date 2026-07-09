"""decode_tenant_settings.max_resume_pages

Configurable cap on how many résumé pages are sent to the vision model (image fallback path).

Revision ID: 0016_decode_max_pages
Revises: 0015_usage_daily
Create Date: 2026-07-09
"""
from alembic import op
import sqlalchemy as sa

from migrations.helpers import has_column

revision = "0016_decode_max_pages"
down_revision = "0015_usage_daily"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if not has_column("decode_tenant_settings", "max_resume_pages"):
        op.add_column(
            "decode_tenant_settings",
            sa.Column("max_resume_pages", sa.Integer(), nullable=False, server_default="6"),
        )
        op.alter_column("decode_tenant_settings", "max_resume_pages", server_default=None)


def downgrade() -> None:
    if has_column("decode_tenant_settings", "max_resume_pages"):
        op.drop_column("decode_tenant_settings", "max_resume_pages")
