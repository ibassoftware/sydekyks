import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class UserSydekykPermission(Base):
    """Per-user, per-Sydekyk grant for a non-commander (hero) user. Commanders are unconstrained and
    need no rows here. Absence of a row means no access to that Sydekyk. Only Sydekyks visible to the
    user's tenant (roster installs + that tenant's exclusive/custom Sydekyks) are grantable."""

    __tablename__ = "user_sydekyk_permissions"
    __table_args__ = (UniqueConstraint("user_id", "sydekyk_id", name="uq_user_sydekyk_permission"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    sydekyk_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sydekyks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    can_use: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    can_configure: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(
        default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc)
    )
