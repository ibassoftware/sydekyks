import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, ForeignKey, Integer, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class ReviewAssignment(Base):
    """Shared, per-(tenant, Sydekyk) review-assignment config: which Odoo users get an activity when
    that agent flags something. One table + one service reused by every agent (Ledger, Decode,
    Mirror, Shield) — DRY. A cron audits the assigned users and alerts the admin if one is removed or
    deactivated in Odoo."""

    __tablename__ = "agent_review_assignments"
    __table_args__ = (UniqueConstraint("tenant_id", "sydekyk_id", name="uq_review_assignment_tenant_sydekyk"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    sydekyk_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sydekyks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # When on, flagging a record creates an Odoo To-Do activity for each assigned user.
    create_activity: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    odoo_user_ids: Mapped[dict | None] = mapped_column(JSONB, nullable=True)  # list[int] res.users ids
    activity_days: Mapped[int] = mapped_column(Integer, nullable=False, default=3)  # deadline offset
    created_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(
        default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc)
    )
