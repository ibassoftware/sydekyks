"""ledger_tenant_settings: estimated_hourly_wage + estimated_minutes_per_bill

Powers the dashboard's estimated-$-saved metric; tenant-configurable, defaults to a plausible
ballpark (data-entry clerk wage, ~5 min to manually key in one bill).

Revision ID: 0008_ledger_savings
Revises: 0007_tenant_issue_mission
Create Date: 2026-07-07
"""
from alembic import op
import sqlalchemy as sa

from migrations.helpers import has_column

revision = "0008_ledger_savings"
down_revision = "0007_tenant_issue_mission"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if not has_column("ledger_tenant_settings", "estimated_hourly_wage"):
        op.add_column(
            "ledger_tenant_settings",
            sa.Column("estimated_hourly_wage", sa.Float(), nullable=False, server_default="15.0"),
        )
        op.alter_column("ledger_tenant_settings", "estimated_hourly_wage", server_default=None)
    if not has_column("ledger_tenant_settings", "estimated_minutes_per_bill"):
        op.add_column(
            "ledger_tenant_settings",
            sa.Column("estimated_minutes_per_bill", sa.Float(), nullable=False, server_default="5.0"),
        )
        op.alter_column("ledger_tenant_settings", "estimated_minutes_per_bill", server_default=None)


def downgrade() -> None:
    for col in ("estimated_minutes_per_bill", "estimated_hourly_wage"):
        if has_column("ledger_tenant_settings", col):
            op.drop_column("ledger_tenant_settings", col)
