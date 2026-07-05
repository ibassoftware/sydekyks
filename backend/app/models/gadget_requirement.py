import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class SydekykGadgetRequirement(Base):
    """A Sydekyk declares it needs a Gadget of a given category for a given role. Generic —
    mirrors how SydekykHostedAssignment declares an LLM need. Populated per-Sydekyk in seed."""

    __tablename__ = "sydekyk_gadget_requirements"
    __table_args__ = (UniqueConstraint("sydekyk_id", "role_key", name="uq_sydekyk_gadget_requirement_role"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    sydekyk_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sydekyks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role_key: Mapped[str] = mapped_column(String(50), nullable=False)  # e.g. "erp", "inbox"
    gadget_category: Mapped[str] = mapped_column(String(50), nullable=False)  # matches Gadget.category
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    is_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(timezone.utc))


class TenantSydekykGadgetAssignment(Base):
    """A tenant's chosen TenantGadgetLink satisfying a specific Sydekyk requirement. Generic —
    one row per (tenant, requirement), mirroring TenantSydekykLLMConfig's shape."""

    __tablename__ = "tenant_sydekyk_gadget_assignments"
    __table_args__ = (UniqueConstraint("tenant_id", "requirement_id", name="uq_tenant_sydekyk_gadget_assignment"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    requirement_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sydekyk_gadget_requirements.id", ondelete="CASCADE"), nullable=False, index=True
    )
    gadget_link_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenant_gadget_links.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(
        default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc)
    )

    requirement: Mapped["SydekykGadgetRequirement"] = relationship()
