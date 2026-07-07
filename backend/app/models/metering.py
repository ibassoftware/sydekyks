import uuid
from datetime import datetime, timezone

from sqlalchemy import BigInteger, Float, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base

# The single row's stable key, so get-or-create always targets the same row.
METERING_CONFIG_KEY = "default"


class PlatformMeteringConfig(Base):
    """Singleton global config for GPU-second estimation. `prompt_rate` / `generation_rate` are the
    two throughput constants (tokens processed per GPU-second) shared by every model; the per-model
    weight lives in ModelRateProfile.multiplier. Admin-keyed in the Command Center."""

    __tablename__ = "platform_metering_config"

    key: Mapped[str] = mapped_column(String(20), primary_key=True, default=METERING_CONFIG_KEY)
    prompt_rate: Mapped[float] = mapped_column(Float, nullable=False, default=3000.0)
    generation_rate: Mapped[float] = mapped_column(Float, nullable=False, default=50.0)
    updated_at: Mapped[datetime] = mapped_column(
        default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc)
    )


class ModelRateProfile(Base):
    """Per-model GPU weight. `multiplier` scales the base (prompt+generation) GPU-seconds for a
    model — a heavier model is "×2", etc. Keyed by the LiteLLM model string/alias as seen on the
    usage record. Models without a row fall back to a ×1.0 default."""

    __tablename__ = "model_rate_profiles"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    model: Mapped[str] = mapped_column(String(150), unique=True, nullable=False, index=True)
    multiplier: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    created_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(
        default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc)
    )


class PlanTier(Base):
    """A subscription plan's default caps. `key` is the stable identifier stored on Tenant.plan;
    `display_name` is the heroic-sidekick label shown to humans. Caps are per-tenant defaults a
    tenant can still override (see Tenant.*_override)."""

    __tablename__ = "plan_tiers"

    key: Mapped[str] = mapped_column(String(50), primary_key=True)
    display_name: Mapped[str] = mapped_column(String(80), nullable=False)
    # Max hosted-AI tokens per calendar month (prorated on mid-month signup).
    monthly_token_cap: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    # Max estimated GPU-seconds allowed within any trailing 60-minute window.
    gpu_seconds_per_hour_cap: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    updated_at: Mapped[datetime] = mapped_column(
        default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc)
    )
