"""Decode (résumé parser) tables: decode_tenant_settings + decode_applicants

Revision ID: 0013_decode_tables
Revises: 0012_mission_trigger_context
Create Date: 2026-07-08
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

from migrations.helpers import has_index, has_table

revision = "0013_decode_tables"
down_revision = "0012_mission_trigger_context"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if not has_table("decode_tenant_settings"):
        op.create_table(
            "decode_tenant_settings",
            sa.Column("id", UUID(as_uuid=True), primary_key=True),
            sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"),
                      nullable=False, unique=True),
            sa.Column("auto_create_skills", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("processed_tag_name", sa.String(length=120), nullable=False, server_default="Sydekyks: Decoded"),
            sa.Column("pooling_stage_name", sa.String(length=120), nullable=True),
            sa.Column("cron_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("cron_last_polled_at", sa.DateTime(), nullable=True),
            sa.Column("cron_poll_limit", sa.Integer(), nullable=False, server_default="30"),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        )

    if not has_table("decode_applicants"):
        op.create_table(
            "decode_applicants",
            sa.Column("id", UUID(as_uuid=True), primary_key=True),
            sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
            sa.Column("sydekyk_id", UUID(as_uuid=True), sa.ForeignKey("sydekyks.id", ondelete="CASCADE"), nullable=False),
            sa.Column("mission_id", UUID(as_uuid=True), sa.ForeignKey("missions.id", ondelete="SET NULL"), nullable=True),
            sa.Column("odoo_applicant_id", sa.Integer(), nullable=True),
            sa.Column("applicant_name", sa.String(length=255), nullable=True),
            sa.Column("email", sa.String(length=255), nullable=True),
            sa.Column("phone", sa.String(length=60), nullable=True),
            sa.Column("job_id", sa.Integer(), nullable=True),
            sa.Column("job_name", sa.String(length=255), nullable=True),
            sa.Column("is_pooling", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("skills", JSONB(), nullable=True),
            sa.Column("years_experience", sa.Float(), nullable=True),
            sa.Column("source", sa.String(length=20), nullable=True),
            sa.Column("needs_review", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("review_reason", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        )
        if not has_index("decode_applicants", "ix_decode_applicants_tenant_id"):
            op.create_index("ix_decode_applicants_tenant_id", "decode_applicants", ["tenant_id"])
        if not has_index("decode_applicants", "ix_decode_applicants_sydekyk_id"):
            op.create_index("ix_decode_applicants_sydekyk_id", "decode_applicants", ["sydekyk_id"])


def downgrade() -> None:
    if has_table("decode_applicants"):
        op.drop_table("decode_applicants")
    if has_table("decode_tenant_settings"):
        op.drop_table("decode_tenant_settings")
