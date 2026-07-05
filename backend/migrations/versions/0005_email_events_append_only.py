"""email_ingest_events: append-only (drop unique constraint)

P0 fix (post-review): the table doubled as an event log AND a unique idempotency ledger, so the
`duplicate` branch (a second row with the same provider/message_id) violated
`uq_email_ingest_provider_message`. Idempotency is done by an explicit query instead; the table is
append-only. Replace the unique constraint with a plain lookup index.

Revision ID: 0005_email_append
Revises: 0004_vision_usage
Create Date: 2026-07-05
"""
from alembic import op

from migrations.helpers import has_index

revision = "0005_email_append"
down_revision = "0004_vision_usage"
branch_labels = None
depends_on = None

_UNIQUE = "uq_email_ingest_provider_message"
_INDEX = "ix_email_ingest_provider_message"


def upgrade() -> None:
    # Dropping the unique constraint also drops its backing index.
    op.execute(f"ALTER TABLE email_ingest_events DROP CONSTRAINT IF EXISTS {_UNIQUE}")
    if not has_index("email_ingest_events", _INDEX):
        op.create_index(_INDEX, "email_ingest_events", ["provider", "message_id"])


def downgrade() -> None:
    if has_index("email_ingest_events", _INDEX):
        op.drop_index(_INDEX, table_name="email_ingest_events")
    op.create_unique_constraint(_UNIQUE, "email_ingest_events", ["provider", "message_id"])
