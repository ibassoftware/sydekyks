import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base

DEFAULT_PROCESSED_TAG = "Sydekyks: Scored"


class ScoutTenantSettings(Base):
    """Per-tenant Scout config (résumé scorer)."""

    __tablename__ = "scout_tenant_settings"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, unique=True, index=True
    )
    processed_tag_name: Mapped[str] = mapped_column(String(120), nullable=False, default=DEFAULT_PROCESSED_TAG)
    # Below this score → the applicant is flagged needs-review.
    min_score_threshold: Mapped[int] = mapped_column(Integer, nullable=False, default=60)
    # Extra tenant criteria fed to the AI scorer on top of the job description.
    scoring_rubric: Mapped[str | None] = mapped_column(Text, nullable=True)
    cron_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    cron_last_polled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    cron_poll_limit: Mapped[int] = mapped_column(Integer, nullable=False, default=30)
    created_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(
        default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc)
    )


class ScoutApplicant(Base):
    """A scored applicant — powers the scoring dashboard and the future learning loop."""

    __tablename__ = "scout_applicants"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    sydekyk_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sydekyks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    mission_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("missions.id", ondelete="SET NULL"), nullable=True
    )
    odoo_applicant_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    applicant_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    job_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    job_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    score: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    highlights: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    strengths: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    weaknesses: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    needs_review: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    review_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    source: Mapped[str | None] = mapped_column(String(20), nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(timezone.utc))
