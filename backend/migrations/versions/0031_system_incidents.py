"""Operator-visible system incident log

Revision ID: 0031_system_incidents
Revises: 0030_signet_tables
Create Date: 2026-07-18
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from migrations.helpers import has_index, has_table

revision = "0031_system_incidents"
down_revision = "0030_signet_tables"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if not has_table("system_incidents"):
        op.create_table(
            "system_incidents",
            sa.Column("id", UUID(as_uuid=True), primary_key=True),
            sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="SET NULL"), nullable=True),
            sa.Column("mission_id", UUID(as_uuid=True), sa.ForeignKey("missions.id", ondelete="SET NULL"), nullable=True),
            sa.Column("source", sa.String(length=40), nullable=False, server_default="api"),
            sa.Column("severity", sa.String(length=16), nullable=False, server_default="error"),
            sa.Column("method", sa.String(length=12), nullable=True),
            sa.Column("path", sa.String(length=500), nullable=True),
            sa.Column("status_code", sa.Integer(), nullable=False, server_default="500"),
            sa.Column("error_type", sa.String(length=255), nullable=False),
            sa.Column("message", sa.Text(), nullable=False),
            sa.Column("traceback", sa.Text(), nullable=True),
            sa.Column("resolved", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        )
    for column in ("tenant_id", "mission_id", "resolved", "created_at"):
        index = f"ix_system_incidents_{column}"
        if not has_index("system_incidents", index):
            op.create_index(index, "system_incidents", [column])


def downgrade() -> None:
    if has_table("system_incidents"):
        op.drop_table("system_incidents")
