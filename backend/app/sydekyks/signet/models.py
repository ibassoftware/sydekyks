import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, LargeBinary, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class SignetTenantSettings(Base):
    """Per-tenant Signet (e-signature) config."""

    __tablename__ = "signet_tenant_settings"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, unique=True, index=True
    )
    sender_name: Mapped[str | None] = mapped_column(String(120), nullable=True)  # display name on invitations
    reminder_interval_days: Mapped[int] = mapped_column(Integer, nullable=False, default=3)
    max_reminders: Mapped[int] = mapped_column(Integer, nullable=False, default=3)
    expiry_days: Mapped[int] = mapped_column(Integer, nullable=False, default=30)
    # Email copy: "template" (fixed) or "ai" (AI-written, grounded in an optional prompt).
    email_copy_mode: Mapped[str] = mapped_column(String(12), nullable=False, default="template")
    email_prompt: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # Savings assumptions (time chasing signatures by hand).
    estimated_hourly_wage: Mapped[float] = mapped_column(Float, nullable=False, default=45.0)
    estimated_minutes_per_signature: Mapped[float] = mapped_column(Float, nullable=False, default=25.0)
    created_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(
        default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc)
    )


class SignetAsset(Base):
    """PDF bytes in Postgres (mirrors Seal's asset boundary) - an envelope's source document and, once
    everyone has signed, the assembled signed PDF. `kind` distinguishes them."""

    __tablename__ = "signet_assets"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    envelope_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True, index=True)
    kind: Mapped[str] = mapped_column(String(12), nullable=False, default="source")  # source | signed
    filename: Mapped[str] = mapped_column(String(255), nullable=False, default="document.pdf")
    content_type: Mapped[str] = mapped_column(String(80), nullable=False, default="application/pdf")
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    content: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    created_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(timezone.utc))


class SignetEnvelope(Base):
    """A signing request for one document sent to one or more signers."""

    __tablename__ = "signet_envelopes"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    sydekyk_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sydekyks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    seal_contract_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False, default="Untitled document")
    message: Mapped[str] = mapped_column(Text, nullable=False, default="")  # optional note included to signers
    source_asset_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    signed_pdf_asset_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    # draft | sent | partially_signed | completed | declined | voided | expired
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft", index=True)
    signing_order: Mapped[str] = mapped_column(String(12), nullable=False, default="parallel")  # parallel | sequential
    reminder_interval_days: Mapped[int] = mapped_column(Integer, nullable=False, default=3)
    max_reminders: Mapped[int] = mapped_column(Integer, nullable=False, default=3)
    email_copy_mode: Mapped[str] = mapped_column(String(12), nullable=False, default="template")
    email_prompt: Mapped[str] = mapped_column(Text, nullable=False, default="")
    hold: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    odoo_record_model: Mapped[str | None] = mapped_column(String(64), nullable=True)
    odoo_record_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    mission_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("missions.id", ondelete="SET NULL"), nullable=True
    )
    created_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(timezone.utc))
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc)
    )


class SignetSigner(Base):
    """One signatory on an envelope. The signing link carries a high-entropy raw token; we store only
    its sha256 `token_hash` (for public lookup) plus a Fernet-encrypted copy (so reminders can rebuild
    the same link) - the raw token is never persisted in the clear."""

    __tablename__ = "signet_signers"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    envelope_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("signet_envelopes.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    email: Mapped[str] = mapped_column(String(320), nullable=False)
    order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    token_encrypted: Mapped[str] = mapped_column(Text, nullable=False, default="")
    status: Mapped[str] = mapped_column(String(12), nullable=False, default="pending")  # pending|viewed|signed|declined
    signature_name: Mapped[str | None] = mapped_column(String(200), nullable=True)  # the typed full name
    signature_image: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)  # optional drawn PNG
    decline_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    viewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    signed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_reminded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reminder_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(timezone.utc))


class SignetEvent(Base):
    """Append-only audit trail for an envelope - powers the signer certificate and the status drawer."""

    __tablename__ = "signet_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    envelope_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("signet_envelopes.id", ondelete="CASCADE"), nullable=False, index=True
    )
    signer_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    # created | sent | viewed | signed | reminded | declined | completed | voided | expired
    event_type: Mapped[str] = mapped_column(String(16), nullable=False)
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(timezone.utc))
