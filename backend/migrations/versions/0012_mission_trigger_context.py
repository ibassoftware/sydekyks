"""Generic Mission.trigger_context (per-trigger metadata)

Carries optional per-trigger context set at Mission creation (email subject/body/from for email
ingest, or a cron poller's target Odoo record id + mode). Sydekyk-agnostic; read by playbooks.

Revision ID: 0012_mission_trigger_context
Revises: 0011_mission_review
Create Date: 2026-07-08
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from migrations.helpers import has_column

revision = "0012_mission_trigger_context"
down_revision = "0011_mission_review"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if not has_column("missions", "trigger_context"):
        op.add_column("missions", sa.Column("trigger_context", JSONB(), nullable=True))


def downgrade() -> None:
    if has_column("missions", "trigger_context"):
        op.drop_column("missions", "trigger_context")
