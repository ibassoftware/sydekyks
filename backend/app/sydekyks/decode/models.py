import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base

DEFAULT_PROCESSED_TAG = "Sydekyks: Decoded"


class DecodeTenantSettings(Base):
    """Per-tenant Decode config (résumé parser). Owned by the Decode package."""

    __tablename__ = "decode_tenant_settings"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, unique=True, index=True
    )
    # May Decode create missing hr.skill entries in Odoo? Off → attach only existing, flag the rest.
    auto_create_skills: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # The tag Decode stamps on processed applicants (also the cron "unprocessed" filter).
    processed_tag_name: Mapped[str] = mapped_column(String(120), nullable=False, default=DEFAULT_PROCESSED_TAG)
    # Optional recruitment stage for "for pooling" applicants (no matching hr.job).
    pooling_stage_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    cron_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    cron_last_polled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    cron_poll_limit: Mapped[int] = mapped_column(Integer, nullable=False, default=30)
    created_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(
        default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc)
    )


class DecodeApplicant(Base):
    """Structured record of an applicant Decode parsed — powers the recruitment dashboard and the
    future learning loop. One row per parse (keyed loosely to the Odoo applicant)."""

    __tablename__ = "decode_applicants"

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
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(60), nullable=True)
    job_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    job_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_pooling: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    skills: Mapped[dict | None] = mapped_column(JSONB, nullable=True)  # list of skill names
    years_experience: Mapped[float | None] = mapped_column(Float, nullable=True)
    source: Mapped[str | None] = mapped_column(String(20), nullable=True)  # web_upload | email | odoo
    needs_review: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    review_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(timezone.utc))
