"""Nudge (sales follow-up) tables: settings, findings, snoozes

Revision ID: 0022_nudge_tables
Revises: 0021_review_assignments
Create Date: 2026-07-12
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

from migrations.helpers import has_index, has_table

revision = "0022_nudge_tables"
down_revision = "0021_review_assignments"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if not has_table("nudge_tenant_settings"):
        op.create_table(
            "nudge_tenant_settings",
            sa.Column("id", UUID(as_uuid=True), primary_key=True),
            sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"),
                      nullable=False, unique=True),
            sa.Column("default_stale_days", sa.Integer(), nullable=False, server_default="14"),
            sa.Column("stage_thresholds", JSONB(), nullable=True),
            sa.Column("cadence_days", sa.Integer(), nullable=False, server_default="7"),
            sa.Column("activity_days", sa.Integer(), nullable=False, server_default="2"),
            sa.Column("estimated_hourly_wage", sa.Float(), nullable=False, server_default="35.0"),
            sa.Column("estimated_minutes_per_followup", sa.Float(), nullable=False, server_default="6.0"),
            sa.Column("cron_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("cron_last_checked_at", sa.String(length=32), nullable=True),
            sa.Column("cron_poll_limit", sa.Integer(), nullable=False, server_default="30"),
            sa.Column("last_open_total", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        )

    if not has_table("nudge_findings"):
        op.create_table(
            "nudge_findings",
            sa.Column("id", UUID(as_uuid=True), primary_key=True),
            sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
            sa.Column("sydekyk_id", UUID(as_uuid=True), sa.ForeignKey("sydekyks.id", ondelete="CASCADE"), nullable=False),
            sa.Column("mission_id", UUID(as_uuid=True), sa.ForeignKey("missions.id", ondelete="SET NULL"), nullable=True),
            sa.Column("odoo_lead_id", sa.Integer(), nullable=False),
            sa.Column("opp_name", sa.String(length=255), nullable=True),
            sa.Column("partner_name", sa.String(length=255), nullable=True),
            sa.Column("salesperson", sa.String(length=255), nullable=True),
            sa.Column("stage_name", sa.String(length=120), nullable=True),
            sa.Column("expected_revenue", sa.Float(), nullable=True),
            sa.Column("currency", sa.String(length=12), nullable=True),
            sa.Column("days_stale", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("silence_score", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("value_at_risk", sa.Float(), nullable=True),
            sa.Column("overdue", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("activity_created", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("draft_body", sa.Text(), nullable=True),
            sa.Column("human_decision", sa.String(length=24), nullable=True),
            sa.Column("decided_by", sa.String(length=255), nullable=True),
            sa.Column("decided_at", sa.DateTime(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        )
        for col in ("tenant_id", "sydekyk_id", "odoo_lead_id"):
            idx = f"ix_nudge_findings_{col}"
            if not has_index("nudge_findings", idx):
                op.create_index(idx, "nudge_findings", [col])

    if not has_table("nudge_snoozes"):
        op.create_table(
            "nudge_snoozes",
            sa.Column("id", UUID(as_uuid=True), primary_key=True),
            sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
            sa.Column("sydekyk_id", UUID(as_uuid=True), sa.ForeignKey("sydekyks.id", ondelete="CASCADE"), nullable=False),
            sa.Column("odoo_lead_id", sa.Integer(), nullable=False),
            sa.Column("opp_name", sa.String(length=255), nullable=True),
            sa.Column("snooze_until", sa.Date(), nullable=True),
            sa.Column("note", sa.Text(), nullable=True),
            sa.Column("created_by", sa.String(length=255), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        )
        for col in ("tenant_id", "sydekyk_id", "odoo_lead_id"):
            idx = f"ix_nudge_snoozes_{col}"
            if not has_index("nudge_snoozes", idx):
                op.create_index(idx, "nudge_snoozes", [col])


def downgrade() -> None:
    for table in ("nudge_snoozes", "nudge_findings", "nudge_tenant_settings"):
        if has_table(table):
            op.drop_table(table)
