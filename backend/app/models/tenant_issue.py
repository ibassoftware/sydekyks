import uuid
from datetime import datetime, timezone

from sqlalchemy import ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class TenantIssue(Base):
    """A standing, tenant-visible flag for something that needs human attention — e.g. a Sydekyk
    discovering a missing Odoo tax configuration while running a Mission. Distinct from a single
    Mission's `needs_review` flag: an Issue represents an ongoing environment/config gap that will
    keep recurring across many Missions until a human fixes it in the external system, so it is
    upserted (by tenant + sydekyk + kind) rather than duplicated per occurrence.

    Deliberately generic/platform-level (not under app/sydekyks/ledger/) — any Sydekyk can report
    one, matching the same "generic Mission engine, Ledger is just the first consumer" pattern.
    """

    __tablename__ = "tenant_issues"
    __table_args__ = (
        UniqueConstraint("tenant_id", "sydekyk_id", "kind", name="uq_tenant_issue_tenant_sydekyk_kind"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    sydekyk_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sydekyks.id", ondelete="CASCADE"), nullable=True
    )
    kind: Mapped[str] = mapped_column(String(50), nullable=False)  # e.g. "missing_tax_config"
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="open")  # open | resolved
    occurrence_count: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    first_seen_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(timezone.utc))
    last_seen_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(timezone.utc))
    resolved_at: Mapped[datetime | None] = mapped_column(nullable=True)
    resolved_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
