"""tenant_issues.mission_id — link an Issue to the Mission that reported it

Lets the Issues page deep-link to the actual Odoo bill (via the linked Mission's
result_summary.odoo_move_id) instead of making a human hunt for it.

Revision ID: 0007_tenant_issue_mission
Revises: 0006_auto_post_issues
Create Date: 2026-07-06
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from migrations.helpers import has_column

revision = "0007_tenant_issue_mission"
down_revision = "0006_auto_post_issues"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if not has_column("tenant_issues", "mission_id"):
        op.add_column(
            "tenant_issues",
            sa.Column("mission_id", UUID(as_uuid=True), sa.ForeignKey("missions.id", ondelete="SET NULL"), nullable=True),
        )


def downgrade() -> None:
    if has_column("tenant_issues", "mission_id"):
        op.drop_column("tenant_issues", "mission_id")
