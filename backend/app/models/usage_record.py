import uuid
from datetime import datetime, timezone

from sqlalchemy import Float, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class UsageRecord(Base):
    """Billing-grade attribution event for one hosted-AI call (VS-15).

    We emit one row per call so spend can be attributed to (tenant, sydekyk, mission). LiteLLM
    remains the source of truth for money; these rows are reconciled against it. `litellm_request_id`
    is unique so a retried call is never double-counted.
    """

    __tablename__ = "usage_records"
    __table_args__ = (UniqueConstraint("litellm_request_id", name="uq_usage_records_request_id"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    sydekyk_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    mission_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    provider: Mapped[str] = mapped_column(String(30), nullable=False)
    model: Mapped[str | None] = mapped_column(String(150), nullable=True)
    prompt_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    completion_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cost_usd: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    # Estimated GPU-seconds for this call, frozen at write time from the then-current rate config
    # + the model's multiplier (see app.services.metering). Powers the rolling-hour capacity cap.
    estimated_gpu_seconds: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    litellm_request_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(timezone.utc))
