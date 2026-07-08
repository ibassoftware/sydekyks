"""usage_daily — daily token/GPU/cost rollup archive

Revision ID: 0015_usage_daily
Revises: 0014_scout_tables
Create Date: 2026-07-08
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from migrations.helpers import has_index, has_table

revision = "0015_usage_daily"
down_revision = "0014_scout_tables"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if has_table("usage_daily"):
        return
    op.create_table(
        "usage_daily",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", UUID(as_uuid=True), nullable=False),
        sa.Column("sydekyk_id", UUID(as_uuid=True), nullable=True),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("total_tokens", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("gpu_seconds", sa.Float(), nullable=False, server_default="0"),
        sa.Column("cost_usd", sa.Float(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "sydekyk_id", "date", name="uq_usage_daily"),
    )
    if not has_index("usage_daily", "ix_usage_daily_tenant_id"):
        op.create_index("ix_usage_daily_tenant_id", "usage_daily", ["tenant_id"])


def downgrade() -> None:
    if has_table("usage_daily"):
        op.drop_table("usage_daily")
