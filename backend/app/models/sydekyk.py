import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, Float, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class Sydekyk(Base):
    __tablename__ = "sydekyks"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    tagline: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    avatar_url: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    system_prompt: Mapped[str] = mapped_column(Text, nullable=False, default="")
    model: Mapped[str] = mapped_column(String(100), nullable=False, default="gpt-4o-mini")
    temperature: Mapped[float] = mapped_column(Float, nullable=False, default=0.7)
    is_exclusive: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_published: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    chat_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    workflow_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Generic capability flag gating the frontend document-intake UI, and the dispatch key that
    # routes a Mission to the right registered playbook (never an `if slug ==` check).
    accepts_document_uploads: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    playbook_key: Mapped[str | None] = mapped_column(String(150), nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(timezone.utc))

    installs: Mapped[list["SydekykInstall"]] = relationship(back_populates="sydekyk", cascade="all, delete-orphan")


class SydekykInstall(Base):
    __tablename__ = "sydekyk_installs"
    __table_args__ = (UniqueConstraint("tenant_id", "sydekyk_id", name="uq_sydekyk_install_tenant_sydekyk"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    sydekyk_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sydekyks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    installed_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(timezone.utc))

    sydekyk: Mapped["Sydekyk"] = relationship(back_populates="installs")
