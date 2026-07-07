import uuid
from datetime import datetime, timezone

from sqlalchemy import ForeignKey, Integer, LargeBinary, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class Mission(Base):
    """One execution instance of a Sydekyk's Playbook — a generic, Sydekyk-agnostic run record.
    Ledger is its first consumer, but nothing here is Ledger-specific."""

    __tablename__ = "missions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    sydekyk_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sydekyks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    mode: Mapped[str] = mapped_column(String(20), nullable=False, default="workflow_run")  # chat | workflow_run
    signal_type: Mapped[str] = mapped_column(String(20), nullable=False)  # manual_upload | email | scheduled | api
    playbook_key: Mapped[str] = mapped_column(String(150), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="queued")  # queued|running|succeeded|failed
    # Populated only on failure; drives the queue's retry policy (VS-7) instead of error-string matching.
    failure_category: Mapped[str | None] = mapped_column(String(20), nullable=True)  # setup|validation|transient|external|unknown
    result_summary: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Retry lineage (VS-4): a retry is a NEW Mission linked to its predecessor + the chain head.
    parent_mission_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("missions.id", ondelete="SET NULL"), nullable=True
    )
    root_mission_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True, index=True)
    attempt_number: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    # Human sign-off on a Mission the Playbook flagged for review (result_summary.needs_review).
    # Records who cleared it and when, so the Issues/Missions "Reviewed" badge has an audit trail.
    reviewed_at: Mapped[datetime | None] = mapped_column(nullable=True)
    reviewed_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(timezone.utc))
    started_at: Mapped[datetime | None] = mapped_column(nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(nullable=True)

    steps: Mapped[list["MissionStep"]] = relationship(
        back_populates="mission", cascade="all, delete-orphan", order_by="MissionStep.step_index"
    )
    document: Mapped["MissionDocument | None"] = relationship(
        back_populates="mission", cascade="all, delete-orphan", uselist=False
    )


class MissionStep(Base):
    __tablename__ = "mission_steps"
    __table_args__ = (UniqueConstraint("mission_id", "step_index", name="uq_mission_step_index"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    mission_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("missions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    step_index: Mapped[int] = mapped_column(Integer, nullable=False)
    step_key: Mapped[str] = mapped_column(String(100), nullable=False)
    step_type: Mapped[str] = mapped_column(String(20), nullable=False)  # llm_call|gadget_call|internal|wait
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")  # pending|running|succeeded|failed|skipped
    input: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    output: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(timezone.utc))

    mission: Mapped["Mission"] = relationship(back_populates="steps")


class MissionDocument(Base):
    __tablename__ = "mission_documents"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    mission_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("missions.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    filename: Mapped[str] = mapped_column(String(500), nullable=False)
    content_type: Mapped[str] = mapped_column(String(120), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    sha256_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    storage_backend: Mapped[str] = mapped_column(String(30), nullable=False, default="postgres_bytea")
    storage_key: Mapped[str | None] = mapped_column(String(500), nullable=True)  # reserved for S3 migration
    content: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    source: Mapped[str] = mapped_column(String(20), nullable=False)  # web_upload | email
    created_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(timezone.utc))

    mission: Mapped["Mission"] = relationship(back_populates="document")
