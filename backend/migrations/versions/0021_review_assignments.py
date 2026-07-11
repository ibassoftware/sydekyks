"""Shared per-(tenant, Sydekyk) review-assignment config (assign Odoo users on flag)

Revision ID: 0021_review_assignments
Revises: 0020_mirror_include_drafts
Create Date: 2026-07-11
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

from migrations.helpers import has_index, has_table

revision = "0021_review_assignments"
down_revision = "0020_mirror_include_drafts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if not has_table("agent_review_assignments"):
        op.create_table(
            "agent_review_assignments",
            sa.Column("id", UUID(as_uuid=True), primary_key=True),
            sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
            sa.Column("sydekyk_id", UUID(as_uuid=True), sa.ForeignKey("sydekyks.id", ondelete="CASCADE"), nullable=False),
            sa.Column("create_activity", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("odoo_user_ids", JSONB(), nullable=True),
            sa.Column("activity_days", sa.Integer(), nullable=False, server_default="3"),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
            sa.UniqueConstraint("tenant_id", "sydekyk_id", name="uq_review_assignment_tenant_sydekyk"),
        )
        for col in ("tenant_id", "sydekyk_id"):
            idx = f"ix_agent_review_assignments_{col}"
            if not has_index("agent_review_assignments", idx):
                op.create_index(idx, "agent_review_assignments", [col])


def downgrade() -> None:
    if has_table("agent_review_assignments"):
        op.drop_table("agent_review_assignments")
