"""ledger vision-readiness columns (VS-12) + usage_records (VS-15)

Revision ID: 0004_vision_usage
Revises: 0003_email_events
Create Date: 2026-07-05
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0004_vision_usage"
down_revision = "0003_email_events"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # VS-12 — Ledger vision-readiness probe result.
    op.add_column("ledger_tenant_settings", sa.Column("ledger_vision_ok", sa.Boolean(), nullable=True))
    op.add_column("ledger_tenant_settings", sa.Column("ledger_vision_tested_at", sa.DateTime(), nullable=True))

    # VS-15 — billing-grade usage events per hosted-AI call.
    op.create_table(
        "usage_records",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", UUID(as_uuid=True), nullable=False, index=True),
        sa.Column("sydekyk_id", UUID(as_uuid=True), nullable=True),
        sa.Column("mission_id", UUID(as_uuid=True), nullable=True),
        sa.Column("provider", sa.String(length=30), nullable=False),
        sa.Column("model", sa.String(length=150), nullable=True),
        sa.Column("prompt_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("completion_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("cost_usd", sa.Float(), nullable=False, server_default="0"),
        sa.Column("litellm_request_id", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("litellm_request_id", name="uq_usage_records_request_id"),
    )
    op.create_index("ix_usage_records_tenant_id", "usage_records", ["tenant_id"])


def downgrade() -> None:
    op.drop_index("ix_usage_records_tenant_id", table_name="usage_records")
    op.drop_table("usage_records")
    op.drop_column("ledger_tenant_settings", "ledger_vision_tested_at")
    op.drop_column("ledger_tenant_settings", "ledger_vision_ok")
