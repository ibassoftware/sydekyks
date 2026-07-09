"""Decode/Scout dashboard savings assumptions

Adds estimated wage + minutes-per-item to decode_tenant_settings and scout_tenant_settings so their
dashboards can show an estimated-$-saved metric (like Ledger).

Revision ID: 0017_recruitment_savings
Revises: 0016_decode_max_pages
Create Date: 2026-07-09
"""
from alembic import op
import sqlalchemy as sa

from migrations.helpers import has_column

revision = "0017_recruitment_savings"
down_revision = "0016_decode_max_pages"
branch_labels = None
depends_on = None


def _add(table, col, default):
    if not has_column(table, col):
        op.add_column(table, sa.Column(col, sa.Float(), nullable=False, server_default=default))
        op.alter_column(table, col, server_default=None)


def upgrade() -> None:
    _add("decode_tenant_settings", "estimated_hourly_wage", "20.0")
    _add("decode_tenant_settings", "estimated_minutes_per_resume", "10.0")
    _add("scout_tenant_settings", "estimated_hourly_wage", "25.0")
    _add("scout_tenant_settings", "estimated_minutes_per_candidate", "15.0")


def downgrade() -> None:
    for table, col in (
        ("decode_tenant_settings", "estimated_hourly_wage"),
        ("decode_tenant_settings", "estimated_minutes_per_resume"),
        ("scout_tenant_settings", "estimated_hourly_wage"),
        ("scout_tenant_settings", "estimated_minutes_per_candidate"),
    ):
        if has_column(table, col):
            op.drop_column(table, col)
