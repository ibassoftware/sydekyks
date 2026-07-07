"""Per-user, per-Sydekyk permissions (hero RBAC)

Lets a commander scope a non-commander (hero) user to specific Sydekyks with Use / Configure grants.

Revision ID: 0010_user_perms
Revises: 0009_metering_plans
Create Date: 2026-07-07
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from migrations.helpers import has_index, has_table

revision = "0010_user_perms"
down_revision = "0009_metering_plans"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if has_table("user_sydekyk_permissions"):
        return
    op.create_table(
        "user_sydekyk_permissions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("sydekyk_id", UUID(as_uuid=True), sa.ForeignKey("sydekyks.id", ondelete="CASCADE"), nullable=False),
        sa.Column("can_use", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("can_configure", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("user_id", "sydekyk_id", name="uq_user_sydekyk_permission"),
    )
    if not has_index("user_sydekyk_permissions", "ix_user_sydekyk_permissions_user_id"):
        op.create_index("ix_user_sydekyk_permissions_user_id", "user_sydekyk_permissions", ["user_id"])
    if not has_index("user_sydekyk_permissions", "ix_user_sydekyk_permissions_sydekyk_id"):
        op.create_index("ix_user_sydekyk_permissions_sydekyk_id", "user_sydekyk_permissions", ["sydekyk_id"])


def downgrade() -> None:
    if has_table("user_sydekyk_permissions"):
        op.drop_table("user_sydekyk_permissions")
