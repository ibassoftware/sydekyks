import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class ShieldTenantSettings(Base):
    """Per-tenant Shield (fraud-risk detector) config."""

    __tablename__ = "shield_tenant_settings"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, unique=True, index=True
    )
    # A vendor/bank record touched within this many days counts as a "recent change".
    recent_change_days: Mapped[int] = mapped_column(Integer, nullable=False, default=14)
    # First-invoice amount at/above which a brand-new vendor looks like a phantom-vendor risk.
    high_amount_threshold: Mapped[float] = mapped_column(Float, nullable=False, default=5000.0)
    # Risk score at/above which Shield raises an auditor review-queue issue.
    flag_threshold: Mapped[int] = mapped_column(Integer, nullable=False, default=45)
    estimated_hourly_wage: Mapped[float] = mapped_column(Float, nullable=False, default=45.0)
    estimated_minutes_per_review: Mapped[float] = mapped_column(Float, nullable=False, default=10.0)
    cron_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    cron_last_checked_at: Mapped[str | None] = mapped_column(String(32), nullable=True)
    cron_poll_limit: Mapped[int] = mapped_column(Integer, nullable=False, default=30)
    cron_days_back: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    created_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(
        default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc)
    )


class ShieldFinding(Base):
    """One transaction Shield risk-assessed — the auditor review-queue row + learning-loop store.
    Framing is always 'warrants review', never an accusation."""

    __tablename__ = "shield_findings"

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
    risk_score: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    hold: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)  # hard-hold (bank change)
    flags: Mapped[dict | None] = mapped_column(JSONB, nullable=True)   # [{code,label,weight,evidence}]
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)   # AI "warrants review" narrative
    # Learning loop: the auditor adjudicates. confirmed = genuine risk; cleared = false positive.
    human_decision: Mapped[str | None] = mapped_column(String(32), nullable=True)
    decided_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(timezone.utc))


class ShieldSuppression(Base):
    """A (vendor, rule) the auditor cleared as a false positive — that rule stops firing for that
    vendor. The tunable half of the learning loop, kept simple and explainable."""

    __tablename__ = "shield_suppressions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    sydekyk_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sydekyks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    partner_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    rule_code: Mapped[str] = mapped_column(String(48), nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(timezone.utc))
