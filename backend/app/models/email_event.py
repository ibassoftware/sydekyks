import uuid
from datetime import datetime, timezone

from sqlalchemy import Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class EmailIngestEvent(Base):
    """One row per inbound email the webhook received — accepted OR ignored, always with a reason
    (VS-8). This is the operator diagnostic trail for "why didn't my emailed bill show up?"

    It is APPEND-ONLY: one delivery can legitimately produce several rows over time (e.g. a
    `no_match` while misconfigured, then an `accepted` once fixed, then a `duplicate` on redelivery),
    so it must NOT carry a unique (provider, message_id) constraint. Idempotency is enforced by the
    webhook's explicit query for a prior `accepted`/`ambiguous_inbox` row, backed by the non-unique
    index below for lookup speed.
    """

    __tablename__ = "email_ingest_events"
    __table_args__ = (Index("ix_email_ingest_provider_message", "provider", "message_id"),)

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
    # accepted | duplicate | no_match | no_sydekyk | ambiguous_inbox | no_op | no_supported_attachment
    # | rejected_size | unauthorized | ignored
    outcome: Mapped[str] = mapped_column(String(30), nullable=False)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(timezone.utc))
