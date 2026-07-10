"""Mirror (duplicate-bill detector) tables: settings, findings, recurring-pattern whitelist

Revision ID: 0018_mirror_tables
Revises: 0017_recruitment_savings
Create Date: 2026-07-10
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

from migrations.helpers import has_index, has_table

revision = "0018_mirror_tables"
down_revision = "0017_recruitment_savings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if not has_table("mirror_tenant_settings"):
        op.create_table(
            "mirror_tenant_settings",
            sa.Column("id", UUID(as_uuid=True), primary_key=True),
            sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"),
                      nullable=False, unique=True),
            sa.Column("date_window_days", sa.Integer(), nullable=False, server_default="30"),
            sa.Column("flag_threshold", sa.Integer(), nullable=False, server_default="70"),
            sa.Column("estimated_hourly_wage", sa.Float(), nullable=False, server_default="30.0"),
            sa.Column("estimated_minutes_per_review", sa.Float(), nullable=False, server_default="8.0"),
            sa.Column("cron_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("cron_last_checked_at", sa.String(length=32), nullable=True),
            sa.Column("cron_poll_limit", sa.Integer(), nullable=False, server_default="30"),
            sa.Column("cron_days_back", sa.Integer(), nullable=False, server_default="5"),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        )

    if not has_table("mirror_findings"):
        op.create_table(
            "mirror_findings",
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
            sa.Column("is_duplicate", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("confidence", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("tier", sa.String(length=24), nullable=True),
            sa.Column("reasons", JSONB(), nullable=True),
            sa.Column("matched_move_ids", JSONB(), nullable=True),
            sa.Column("suppressed", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("human_decision", sa.String(length=32), nullable=True),
            sa.Column("decided_by", sa.String(length=255), nullable=True),
            sa.Column("decided_at", sa.DateTime(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        )
        for col in ("tenant_id", "sydekyk_id", "odoo_move_id"):
            idx = f"ix_mirror_findings_{col}"
            if not has_index("mirror_findings", idx):
                op.create_index(idx, "mirror_findings", [col])

    if not has_table("mirror_recurring_patterns"):
        op.create_table(
            "mirror_recurring_patterns",
            sa.Column("id", UUID(as_uuid=True), primary_key=True),
            sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
            sa.Column("sydekyk_id", UUID(as_uuid=True), sa.ForeignKey("sydekyks.id", ondelete="CASCADE"), nullable=False),
            sa.Column("partner_id", sa.Integer(), nullable=False),
            sa.Column("vendor_name", sa.String(length=255), nullable=True),
            sa.Column("amount", sa.Float(), nullable=True),
            sa.Column("note", sa.Text(), nullable=True),
            sa.Column("created_by", sa.String(length=255), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        )
        for col in ("tenant_id", "sydekyk_id", "partner_id"):
            idx = f"ix_mirror_recurring_patterns_{col}"
            if not has_index("mirror_recurring_patterns", idx):
                op.create_index(idx, "mirror_recurring_patterns", [col])


def downgrade() -> None:
    for table in ("mirror_recurring_patterns", "mirror_findings", "mirror_tenant_settings"):
        if has_table(table):
            op.drop_table(table)
