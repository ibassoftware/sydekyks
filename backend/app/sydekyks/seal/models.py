import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, LargeBinary, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class SealTenantSettings(Base):
    """Per-tenant Seal (contract generator + reviewer) config."""

    __tablename__ = "seal_tenant_settings"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, unique=True, index=True
    )
    # Default template a new contract starts from (nullable = blank editor).
    default_template_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    # The tenant's review playbook - the standard positions / risk tolerance the review turn is grounded in.
    review_guidelines: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # Print setup + branding for the PDF export.
    page_size: Mapped[str] = mapped_column(String(12), nullable=False, default="A4")  # A4 | Letter
    accent_color: Mapped[str | None] = mapped_column(String(12), nullable=True)  # hex, e.g. #1e3a5f
    header_text: Mapped[str | None] = mapped_column(String(300), nullable=True)  # PDF running header (company line)
    footer_text: Mapped[str | None] = mapped_column(String(300), nullable=True)  # PDF footer (company/contact line)
    logo_asset_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    # Savings assumptions.
    estimated_hourly_wage: Mapped[float] = mapped_column(Float, nullable=False, default=60.0)
    estimated_minutes_per_contract: Mapped[float] = mapped_column(Float, nullable=False, default=90.0)
    created_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(
        default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc)
    )


class SealTemplate(Base):
    """A reusable contract template. `tenant_id` NULL = a built-in/shared starter template (read-only);
    a tenant "Save as new template" writes a tenant-owned row."""

    __tablename__ = "seal_templates"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    format: Mapped[str] = mapped_column(String(8), nullable=False, default="html")  # html | md
    body: Mapped[str] = mapped_column(Text, nullable=False, default="")
    is_builtin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(
        default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc)
    )


class SealContract(Base):
    """A contract document - the §12 draft store. The canonical content is HTML (`content_html`)."""

    __tablename__ = "seal_contracts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    sydekyk_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sydekyks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False, default="Untitled contract")
    content_html: Mapped[str] = mapped_column(Text, nullable=False, default="")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="draft")  # draft | final
    template_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    counterparty_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Latest review run - findings carry `review_seq`; the highest is the live set.
    review_seq: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Optional Odoo links (all optional).
    odoo_lead_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    odoo_partner_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    odoo_sign_request_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # The mission that last generated this contract (draft). Refine/review missions are linked via child rows.
    mission_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("missions.id", ondelete="SET NULL"), nullable=True
    )
    created_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(
        default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc)
    )


class SealAsset(Base):
    """An image (or brand logo) embedded in a contract. Bytes live in Postgres, mirroring the
    document_storage boundary. Served back to the editor via GET /assets/{id}."""

    __tablename__ = "seal_assets"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    contract_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True, index=True)
    filename: Mapped[str] = mapped_column(String(255), nullable=False, default="image")
    content_type: Mapped[str] = mapped_column(String(80), nullable=False, default="application/octet-stream")
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    content: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    created_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(timezone.utc))


class SealChatMessage(Base):
    """One turn of the "Ask Seal" conversation on a contract + its token ledger. Assistant turns copy
    the turn's token counts from its UsageRecord so the editor shows a running per-contract total; the
    authoritative billing ledger stays UsageRecord/metering."""

    __tablename__ = "seal_chat_messages"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    contract_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("seal_contracts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    seq: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    role: Mapped[str] = mapped_column(String(12), nullable=False)  # user | assistant
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    mission_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("missions.id", ondelete="SET NULL"), nullable=True
    )
    prompt_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    completion_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cost_usd: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    created_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(timezone.utc))


class SealReviewFinding(Base):
    """One clause-level risk finding from a `seal.review` run. `clause_anchor` is the exact quoted text
    the finding refers to (traceable); accepting applies `suggested_redline` in place of that anchor.
    Findings are versioned by `review_seq` - re-running review writes a fresh set and supersedes the
    prior one (the contract's `review_seq` points at the live set)."""

    __tablename__ = "seal_review_findings"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    contract_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("seal_contracts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    review_seq: Mapped[int] = mapped_column(Integer, nullable=False, default=0, index=True)
    clause_label: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    category: Mapped[str] = mapped_column(String(40), nullable=False, default="other")
    severity: Mapped[str] = mapped_column(String(8), nullable=False, default="low")  # high | medium | low
    issue: Mapped[str] = mapped_column(Text, nullable=False, default="")
    rationale: Mapped[str] = mapped_column(Text, nullable=False, default="")
    clause_anchor: Mapped[str] = mapped_column(Text, nullable=False, default="")
    suggested_redline: Mapped[str] = mapped_column(Text, nullable=False, default="")
    status: Mapped[str] = mapped_column(String(12), nullable=False, default="open")  # open | accepted | dismissed
    mission_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("missions.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(timezone.utc))
