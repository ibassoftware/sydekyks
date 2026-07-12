import uuid
from datetime import datetime, timezone

from sqlalchemy import BigInteger, Float, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class Tenant(Base):
    __tablename__ = "tenants"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    plan: Mapped[str] = mapped_column(String(50), nullable=False, default="starter")
    # Tenant's reporting currency (ISO 4217). The default/fallback for money shown on the dashboard and
    # in agent settings (wage/savings). Record-derived amounts (a bill's own currency) still win where
    # known; this fills the gap for figures that have no intrinsic currency (labor-cost savings).
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="USD")
    # Per-tenant cap overrides — null means "inherit the plan tier's default" (see app.services.metering).
    monthly_token_cap_override: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    gpu_seconds_per_hour_cap_override: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(timezone.utc))

    users: Mapped[list["User"]] = relationship(back_populates="tenant", cascade="all, delete-orphan")
