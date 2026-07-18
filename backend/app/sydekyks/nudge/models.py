import uuid
from datetime import date, datetime, timezone

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class NudgeTenantSettings(Base):
    """Per-tenant Nudge (follow-up) config."""

    __tablename__ = "nudge_tenant_settings"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, unique=True, index=True
    )
    # Fallback silence threshold; per-stage overrides live in stage_thresholds ({stage_id: days}).
    default_stale_days: Mapped[int] = mapped_column(Integer, nullable=False, default=14)
    stage_thresholds: Mapped[dict | None] = mapped_column(JSONB, nullable=True)  # {"<stage_id>": days}
    # Cadence guard: never nudge the same opp more than once per this many days.
    cadence_days: Mapped[int] = mapped_column(Integer, nullable=False, default=7)
    # Deadline offset for the created follow-up activity.
    activity_days: Mapped[int] = mapped_column(Integer, nullable=False, default=2)
    estimated_hourly_wage: Mapped[float] = mapped_column(Float, nullable=False, default=35.0)
    estimated_minutes_per_followup: Mapped[float] = mapped_column(Float, nullable=False, default=6.0)
    cron_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    cron_last_checked_at: Mapped[str | None] = mapped_column(String(32), nullable=True)
    cron_poll_limit: Mapped[int] = mapped_column(Integer, nullable=False, default=30)
    skip_tag_name: Mapped[str] = mapped_column(String(80), nullable=False, default="Nudge-skip")
    # Snapshot of open-opportunity count from the last poll - the denominator for coverage %, so the
    # dashboard doesn't hit Odoo on every load.
    last_open_total: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(
        default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc)
    )


class NudgeFinding(Base):
    """One stale opp Nudge acted on - the audit line + dashboard/learning store."""

    __tablename__ = "nudge_findings"

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
    odoo_lead_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    opp_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    partner_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    salesperson: Mapped[str | None] = mapped_column(String(255), nullable=True)
    stage_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    expected_revenue: Mapped[float | None] = mapped_column(Float, nullable=True)
    currency: Mapped[str | None] = mapped_column(String(12), nullable=True)
    days_stale: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    silence_score: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    value_at_risk: Mapped[float | None] = mapped_column(Float, nullable=True)
    overdue: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)  # existing overdue activity
    activity_created: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    draft_body: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Learning loop: sent | dismissed | snoozed
    human_decision: Mapped[str | None] = mapped_column(String(24), nullable=True)
    decided_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(timezone.utc))


class NudgeSnooze(Base):
    """Snooze / whitelist memory for legitimately-paused deals ('circle back in Q3', long
    procurement). `snooze_until` None = never nudge; a date = suppress until then."""

    __tablename__ = "nudge_snoozes"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    sydekyk_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sydekyks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    odoo_lead_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    opp_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    snooze_until: Mapped[date | None] = mapped_column(Date, nullable=True)  # None = don't nudge ever
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(timezone.utc))
