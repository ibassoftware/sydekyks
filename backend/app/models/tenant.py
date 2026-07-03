import uuid
from datetime import datetime, timezone

from sqlalchemy import String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class Tenant(Base):
    __tablename__ = "tenants"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    plan: Mapped[str] = mapped_column(String(50), nullable=False, default="starter")
    created_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(timezone.utc))

    users: Mapped[list["User"]] = relationship(back_populates="tenant", cascade="all, delete-orphan")
