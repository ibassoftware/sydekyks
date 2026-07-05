"""ledger_tenant_settings.auto_post_enabled + tenant_issues table

Revision ID: 0006_auto_post_issues
Revises: 0005_email_append
Create Date: 2026-07-05
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from migrations.helpers import has_column, has_index, has_table

revision = "0006_auto_post_issues"
down_revision = "0005_email_append"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Opt-in auto-post checkbox — defaults False, matching the model default.
    if not has_column("ledger_tenant_settings", "auto_post_enabled"):
        op.add_column(
            "ledger_tenant_settings",
            sa.Column("auto_post_enabled", sa.Boolean(), nullable=False, server_default="false"),
        )
        op.alter_column("ledger_tenant_settings", "auto_post_enabled", server_default=None)

    if has_table("tenant_issues"):
        return
    op.create_table(
        "tenant_issues",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("sydekyk_id", UUID(as_uuid=True), sa.ForeignKey("sydekyks.id", ondelete="CASCADE"), nullable=True),
        sa.Column("kind", sa.String(length=50), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("detail", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="open"),
        sa.Column("occurrence_count", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("first_seen_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("last_seen_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("resolved_at", sa.DateTime(), nullable=True),
        sa.Column("resolved_by_user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.UniqueConstraint("tenant_id", "sydekyk_id", "kind", name="uq_tenant_issue_tenant_sydekyk_kind"),
    )
    if not has_index("tenant_issues", "ix_tenant_issues_tenant_id"):
        op.create_index("ix_tenant_issues_tenant_id", "tenant_issues", ["tenant_id"])


def downgrade() -> None:
    if has_table("tenant_issues"):
        op.drop_table("tenant_issues")
    if has_column("ledger_tenant_settings", "auto_post_enabled"):
        op.drop_column("ledger_tenant_settings", "auto_post_enabled")
