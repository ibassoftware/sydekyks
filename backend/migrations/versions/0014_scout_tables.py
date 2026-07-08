"""Scout (résumé scorer) tables: scout_tenant_settings + scout_applicants

Revision ID: 0014_scout_tables
Revises: 0013_decode_tables
Create Date: 2026-07-08
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

from migrations.helpers import has_index, has_table

revision = "0014_scout_tables"
down_revision = "0013_decode_tables"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if not has_table("scout_tenant_settings"):
        op.create_table(
            "scout_tenant_settings",
            sa.Column("id", UUID(as_uuid=True), primary_key=True),
            sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"),
                      nullable=False, unique=True),
            sa.Column("processed_tag_name", sa.String(length=120), nullable=False, server_default="Sydekyks: Scored"),
            sa.Column("min_score_threshold", sa.Integer(), nullable=False, server_default="60"),
            sa.Column("scoring_rubric", sa.Text(), nullable=True),
            sa.Column("cron_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("cron_last_polled_at", sa.DateTime(), nullable=True),
            sa.Column("cron_poll_limit", sa.Integer(), nullable=False, server_default="30"),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        )

    if not has_table("scout_applicants"):
        op.create_table(
            "scout_applicants",
            sa.Column("id", UUID(as_uuid=True), primary_key=True),
            sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
            sa.Column("sydekyk_id", UUID(as_uuid=True), sa.ForeignKey("sydekyks.id", ondelete="CASCADE"), nullable=False),
            sa.Column("mission_id", UUID(as_uuid=True), sa.ForeignKey("missions.id", ondelete="SET NULL"), nullable=True),
            sa.Column("odoo_applicant_id", sa.Integer(), nullable=True),
            sa.Column("applicant_name", sa.String(length=255), nullable=True),
            sa.Column("job_id", sa.Integer(), nullable=True),
            sa.Column("job_name", sa.String(length=255), nullable=True),
            sa.Column("score", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("summary", sa.Text(), nullable=True),
            sa.Column("highlights", JSONB(), nullable=True),
            sa.Column("strengths", JSONB(), nullable=True),
            sa.Column("weaknesses", JSONB(), nullable=True),
            sa.Column("needs_review", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("review_reason", sa.Text(), nullable=True),
            sa.Column("source", sa.String(length=20), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        )
        if not has_index("scout_applicants", "ix_scout_applicants_tenant_id"):
            op.create_index("ix_scout_applicants_tenant_id", "scout_applicants", ["tenant_id"])
        if not has_index("scout_applicants", "ix_scout_applicants_sydekyk_id"):
            op.create_index("ix_scout_applicants_sydekyk_id", "scout_applicants", ["sydekyk_id"])


def downgrade() -> None:
    if has_table("scout_applicants"):
        op.drop_table("scout_applicants")
    if has_table("scout_tenant_settings"):
        op.drop_table("scout_tenant_settings")
