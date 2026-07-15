"""postmark_config: webhook Basic Auth columns

Move the inbound webhook Basic Auth (user + encrypted pass) into the DB so it's editable in the
Command Center. Null falls back to the env defaults.

Revision ID: 0028_postmark_webhook_auth
Revises: 0027_postmark_config
Create Date: 2026-07-14
"""
from alembic import op
import sqlalchemy as sa

from migrations.helpers import has_column

revision = "0028_postmark_webhook_auth"
down_revision = "0027_postmark_config"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if not has_column("postmark_config", "webhook_basic_auth_user"):
        op.add_column("postmark_config", sa.Column("webhook_basic_auth_user", sa.String(length=255), nullable=True))
    if not has_column("postmark_config", "encrypted_webhook_basic_auth_pass"):
        op.add_column("postmark_config", sa.Column("encrypted_webhook_basic_auth_pass", sa.Text(), nullable=True))


def downgrade() -> None:
    if has_column("postmark_config", "encrypted_webhook_basic_auth_pass"):
        op.drop_column("postmark_config", "encrypted_webhook_basic_auth_pass")
    if has_column("postmark_config", "webhook_basic_auth_user"):
        op.drop_column("postmark_config", "webhook_basic_auth_user")
