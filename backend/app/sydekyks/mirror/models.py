import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class MirrorTenantSettings(Base):
    """Per-tenant Mirror (duplicate-bill detector) config."""

    __tablename__ = "mirror_tenant_settings"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, unique=True, index=True
    )
    # Fuzzy match tuning: same vendor + same amount within this many days counts as a strong match.
    date_window_days: Mapped[int] = mapped_column(Integer, nullable=False, default=30)
    # Include unposted draft bills when scanning + comparing (off → only posted bills).
    include_drafts: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # Confidence at/above which Mirror raises a Command-Center issue (below → note only).
    flag_threshold: Mapped[int] = mapped_column(Integer, nullable=False, default=70)
    # Dashboard "$ prevented" assumes the review time a caught duplicate saves.
    estimated_hourly_wage: Mapped[float] = mapped_column(Float, nullable=False, default=30.0)
    estimated_minutes_per_review: Mapped[float] = mapped_column(Float, nullable=False, default=8.0)
    cron_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    cron_last_checked_at: Mapped[str | None] = mapped_column(String(32), nullable=True)  # Odoo create_date watermark
    cron_poll_limit: Mapped[int] = mapped_column(Integer, nullable=False, default=30)
    cron_days_back: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    created_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(
        default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc)
    )


class MirrorFinding(Base):
    """One bill Mirror checked - the audit log line + the dashboard/learning-loop store."""

    __tablename__ = "mirror_findings"

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
    odoo_move_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    vendor_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    partner_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ref: Mapped[str | None] = mapped_column(String(255), nullable=True)
    amount: Mapped[float | None] = mapped_column(Float, nullable=True)
    currency: Mapped[str | None] = mapped_column(String(12), nullable=True)
    is_duplicate: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    confidence: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    tier: Mapped[str | None] = mapped_column(String(24), nullable=True)  # exact|fuzzy|cross_vendor|line_item|none
    reasons: Mapped[dict | None] = mapped_column(JSONB, nullable=True)   # ["same vendor", "same ref …", …]
    matched_move_ids: Mapped[dict | None] = mapped_column(JSONB, nullable=True)  # [ids compared against]
    suppressed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)  # matched a recurring pattern
    # Human sign-off (learning loop): confirmed_duplicate | not_duplicate | recurring
    human_decision: Mapped[str | None] = mapped_column(String(32), nullable=True)
    decided_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(timezone.utc))


class MirrorRecurringPattern(Base):
    """Suppression memory: a vendor+amount pattern a clerk marked 'legitimately recurring' (rent,
    subscriptions, retainers). Future bills matching it are checked but never flagged."""

    __tablename__ = "mirror_recurring_patterns"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    sydekyk_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sydekyks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    partner_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    vendor_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    amount: Mapped[float | None] = mapped_column(Float, nullable=True)  # None = any amount from this vendor
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(timezone.utc))
