"""Mission human-review sign-off (reviewed_at + reviewed_by_user_id)

Lets a user mark a flagged (needs_review) Mission as reviewed, with an audit of who and when.

Revision ID: 0011_mission_review
Revises: 0010_user_perms
Create Date: 2026-07-07
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from migrations.helpers import has_column

revision = "0011_mission_review"
down_revision = "0010_user_perms"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if not has_column("missions", "reviewed_at"):
        op.add_column("missions", sa.Column("reviewed_at", sa.DateTime(), nullable=True))
    if not has_column("missions", "reviewed_by_user_id"):
        op.add_column(
            "missions",
            sa.Column(
                "reviewed_by_user_id",
                UUID(as_uuid=True),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
        )


def downgrade() -> None:
    for col in ("reviewed_by_user_id", "reviewed_at"):
        if has_column("missions", col):
            op.drop_column("missions", col)
