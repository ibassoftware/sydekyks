import uuid
from datetime import datetime, timezone

from sqlalchemy import Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class EmailIngestEvent(Base):
    """One row per inbound email the webhook received — accepted OR ignored, always with a reason
    (VS-8). This is the operator diagnostic trail for "why didn't my emailed bill show up?" and the
    idempotency ledger: a repeat provider message_id is deduped instead of re-creating Missions.

    Postgres treats NULLs as distinct, so the unique (provider, message_id) constraint only dedupes
    real message ids and never blocks rows where the provider omitted one.
    """

    __tablename__ = "email_ingest_events"
    __table_args__ = (UniqueConstraint("provider", "message_id", name="uq_email_ingest_provider_message"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True, index=True)
    provider: Mapped[str] = mapped_column(String(20), nullable=False, default="postmark")
    message_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    to_address: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    from_address: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    attachment_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    matched_link_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    matched_sydekyk_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    missions_created: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # accepted | duplicate | no_match | no_sydekyk | ambiguous_inbox | no_op | rejected_size | unauthorized
    outcome: Mapped[str] = mapped_column(String(30), nullable=False)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(timezone.utc))
