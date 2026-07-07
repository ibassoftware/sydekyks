import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, Float, ForeignKey, Integer
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import DateTime

from app.db.session import Base


class LedgerTenantSettings(Base):
    """Ledger's own per-tenant business config — deliberately NOT part of the generic
    Gadget-assignment system. Owned entirely within Ledger's package."""

    __tablename__ = "ledger_tenant_settings"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, unique=True, index=True
    )
    auto_create_partner: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Opt-in: bills only auto-post when this is explicitly enabled AND confidence clears the
    # threshold. Defaults False — never auto-post without an explicit choice.
    auto_post_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    auto_post_threshold: Mapped[int] = mapped_column(Integer, nullable=False, default=90)
    # VS-12: result of the last "can this engine actually read a bill?" probe.
    ledger_vision_ok: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    ledger_vision_tested_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # Dashboard "estimated $ saved" assumptions — tenant-configurable, defaults to a plausible
    # ballpark (data-entry clerk wage, ~5 min to manually key in one bill).
    estimated_hourly_wage: Mapped[float] = mapped_column(Float, nullable=False, default=15.0)
    estimated_minutes_per_bill: Mapped[float] = mapped_column(Float, nullable=False, default=5.0)
    created_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(
        default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc)
    )
