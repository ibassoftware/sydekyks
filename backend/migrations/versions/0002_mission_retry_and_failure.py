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

from migrations.helpers import has_column, has_fk, has_index

revision = "0002_mission_retry"
down_revision = "0001_baseline"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if not has_column("missions", "failure_category"):
        op.add_column("missions", sa.Column("failure_category", sa.String(length=20), nullable=True))
    if not has_column("missions", "parent_mission_id"):
        op.add_column("missions", sa.Column("parent_mission_id", UUID(as_uuid=True), nullable=True))
    if not has_column("missions", "root_mission_id"):
        op.add_column("missions", sa.Column("root_mission_id", UUID(as_uuid=True), nullable=True))
    if not has_column("missions", "attempt_number"):
        op.add_column("missions", sa.Column("attempt_number", sa.Integer(), nullable=False, server_default="1"))
        op.alter_column("missions", "attempt_number", server_default=None)
    if not has_index("missions", "ix_missions_root_mission_id"):
        op.create_index("ix_missions_root_mission_id", "missions", ["root_mission_id"])
    if not has_fk("missions", "fk_missions_parent_mission_id"):
        op.create_foreign_key(
            "fk_missions_parent_mission_id", "missions", "missions",
            ["parent_mission_id"], ["id"], ondelete="SET NULL",
        )


def downgrade() -> None:
    if has_fk("missions", "fk_missions_parent_mission_id"):
        op.drop_constraint("fk_missions_parent_mission_id", "missions", type_="foreignkey")
    if has_index("missions", "ix_missions_root_mission_id"):
        op.drop_index("ix_missions_root_mission_id", table_name="missions")
    for col in ("attempt_number", "root_mission_id", "parent_mission_id", "failure_category"):
        if has_column("missions", col):
            op.drop_column("missions", col)
