"""mission retry lineage + failure_category

Adds VS-4 retry lineage (parent_mission_id, root_mission_id, attempt_number) and VS-7
failure_category to the missions table.

Revision ID: 0002_mission_retry
Revises: 0001_baseline
Create Date: 2026-07-05
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0002_mission_retry"
down_revision = "0001_baseline"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("missions", sa.Column("failure_category", sa.String(length=20), nullable=True))
    op.add_column("missions", sa.Column("parent_mission_id", UUID(as_uuid=True), nullable=True))
    op.add_column("missions", sa.Column("root_mission_id", UUID(as_uuid=True), nullable=True))
    op.add_column(
        "missions",
        sa.Column("attempt_number", sa.Integer(), nullable=False, server_default="1"),
    )
    op.create_index("ix_missions_root_mission_id", "missions", ["root_mission_id"])
    op.create_foreign_key(
        "fk_missions_parent_mission_id",
        "missions",
        "missions",
        ["parent_mission_id"],
        ["id"],
        ondelete="SET NULL",
    )
    # Drop the server_default now that existing rows are backfilled; the model default (1) applies.
    op.alter_column("missions", "attempt_number", server_default=None)


def downgrade() -> None:
    op.drop_constraint("fk_missions_parent_mission_id", "missions", type_="foreignkey")
    op.drop_index("ix_missions_root_mission_id", table_name="missions")
    op.drop_column("missions", "attempt_number")
    op.drop_column("missions", "root_mission_id")
    op.drop_column("missions", "parent_mission_id")
    op.drop_column("missions", "failure_category")
