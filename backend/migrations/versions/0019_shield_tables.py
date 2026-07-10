"""Shield (fraud-risk detector) tables: settings, findings, rule-suppressions

Revision ID: 0019_shield_tables
Revises: 0018_mirror_tables
Create Date: 2026-07-10
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

from migrations.helpers import has_index, has_table

revision = "0019_shield_tables"
down_revision = "0018_mirror_tables"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if not has_table("shield_tenant_settings"):
        op.create_table(
            "shield_tenant_settings",
            sa.Column("id", UUID(as_uuid=True), primary_key=True),
            sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"),
                      nullable=False, unique=True),
            sa.Column("recent_change_days", sa.Integer(), nullable=False, server_default="14"),
            sa.Column("high_amount_threshold", sa.Float(), nullable=False, server_default="5000.0"),
            sa.Column("flag_threshold", sa.Integer(), nullable=False, server_default="45"),
            sa.Column("estimated_hourly_wage", sa.Float(), nullable=False, server_default="45.0"),
            sa.Column("estimated_minutes_per_review", sa.Float(), nullable=False, server_default="10.0"),
            sa.Column("cron_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("cron_last_checked_at", sa.String(length=32), nullable=True),
            sa.Column("cron_poll_limit", sa.Integer(), nullable=False, server_default="30"),
            sa.Column("cron_days_back", sa.Integer(), nullable=False, server_default="5"),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        )

    if not has_table("shield_findings"):
        op.create_table(
            "shield_findings",
            sa.Column("id", UUID(as_uuid=True), primary_key=True),
            sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
            sa.Column("sydekyk_id", UUID(as_uuid=True), sa.ForeignKey("sydekyks.id", ondelete="CASCADE"), nullable=False),
            sa.Column("mission_id", UUID(as_uuid=True), sa.ForeignKey("missions.id", ondelete="SET NULL"), nullable=True),
            sa.Column("odoo_move_id", sa.Integer(), nullable=False),
            sa.Column("vendor_name", sa.String(length=255), nullable=True),
            sa.Column("partner_id", sa.Integer(), nullable=True),
            sa.Column("ref", sa.String(length=255), nullable=True),
            sa.Column("amount", sa.Float(), nullable=True),
            sa.Column("currency", sa.String(length=12), nullable=True),
            sa.Column("risk_score", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("hold", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("flags", JSONB(), nullable=True),
            sa.Column("summary", sa.Text(), nullable=True),
            sa.Column("human_decision", sa.String(length=32), nullable=True),
            sa.Column("decided_by", sa.String(length=255), nullable=True),
            sa.Column("decided_at", sa.DateTime(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        )
        for col in ("tenant_id", "sydekyk_id", "odoo_move_id"):
            idx = f"ix_shield_findings_{col}"
            if not has_index("shield_findings", idx):
                op.create_index(idx, "shield_findings", [col])

    if not has_table("shield_suppressions"):
        op.create_table(
            "shield_suppressions",
            sa.Column("id", UUID(as_uuid=True), primary_key=True),
            sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
            sa.Column("sydekyk_id", UUID(as_uuid=True), sa.ForeignKey("sydekyks.id", ondelete="CASCADE"), nullable=False),
            sa.Column("partner_id", sa.Integer(), nullable=False),
            sa.Column("rule_code", sa.String(length=48), nullable=False),
            sa.Column("note", sa.Text(), nullable=True),
            sa.Column("created_by", sa.String(length=255), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        )
        for col in ("tenant_id", "sydekyk_id", "partner_id"):
            idx = f"ix_shield_suppressions_{col}"
            if not has_index("shield_suppressions", idx):
                op.create_index(idx, "shield_suppressions", [col])


def downgrade() -> None:
    for table in ("shield_suppressions", "shield_findings", "shield_tenant_settings"):
        if has_table(table):
            op.drop_table(table)
