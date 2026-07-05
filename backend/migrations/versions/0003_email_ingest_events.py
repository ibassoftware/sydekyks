"""email_ingest_events (VS-8)

Diagnostic + idempotency ledger for inbound email.

Revision ID: 0003_email_events
Revises: 0002_mission_retry
Create Date: 2026-07-05
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from migrations.helpers import has_index, has_table

revision = "0003_email_events"
down_revision = "0002_mission_retry"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if has_table("email_ingest_events"):
        return
    op.create_table(
        "email_ingest_events",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", UUID(as_uuid=True), nullable=True),
        sa.Column("provider", sa.String(length=20), nullable=False, server_default="postmark"),
        sa.Column("message_id", sa.String(length=255), nullable=True),
        sa.Column("to_address", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("from_address", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("attachment_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("matched_link_id", UUID(as_uuid=True), nullable=True),
        sa.Column("matched_sydekyk_id", UUID(as_uuid=True), nullable=True),
        sa.Column("missions_created", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("outcome", sa.String(length=30), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("provider", "message_id", name="uq_email_ingest_provider_message"),
    )
    if not has_index("email_ingest_events", "ix_email_ingest_events_tenant_id"):
        op.create_index("ix_email_ingest_events_tenant_id", "email_ingest_events", ["tenant_id"])


def downgrade() -> None:
    if has_table("email_ingest_events"):
        op.drop_table("email_ingest_events")
