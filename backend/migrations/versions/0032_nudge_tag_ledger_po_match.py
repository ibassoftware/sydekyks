"""Add Nudge skip tag and optional Ledger purchase-order matching.

Revision ID: 0032_nudge_tag_ledger_po_match
Revises: 0031_system_incidents
"""

from alembic import op
import sqlalchemy as sa

revision = "0032_nudge_tag_ledger_po_match"
down_revision = "0031_system_incidents"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("nudge_tenant_settings", sa.Column("skip_tag_name", sa.String(length=80), nullable=False, server_default="Nudge-skip"))
    op.add_column("ledger_tenant_settings", sa.Column("purchase_order_match_enabled", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    op.drop_column("ledger_tenant_settings", "purchase_order_match_enabled")
    op.drop_column("nudge_tenant_settings", "skip_tag_name")
