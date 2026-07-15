"""postmark_config

Global Command Center Postmark settings (inbound domain + Server API token). Single-row.

Revision ID: 0027_postmark_config
Revises: 0026_quill_header_text
Create Date: 2026-07-14
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from migrations.helpers import has_table

revision = "0027_postmark_config"
down_revision = "0026_quill_header_text"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if has_table("postmark_config"):
        return
    op.create_table(
        "postmark_config",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("inbound_domain", sa.String(length=255), nullable=False),
        sa.Column("encrypted_server_token", sa.Text(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
    )


def downgrade() -> None:
    if has_table("postmark_config"):
        op.drop_table("postmark_config")
