import uuid
from datetime import datetime, timezone

from sqlalchemy import Float, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class TenantProviderCredential(Base):
    """A tenant's own BYOK connection for one provider. A tenant may hold several of these
    (one per provider) and assign different ones to different Sydekyks."""

    __tablename__ = "tenant_provider_credentials"
    __table_args__ = (UniqueConstraint("tenant_id", "provider", name="uq_tenant_provider_credential"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    provider: Mapped[str] = mapped_column(String(20), nullable=False)  # openai | anthropic | ollama_cloud
    encrypted_api_key: Mapped[str] = mapped_column(Text, nullable=False)
    api_base: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(
        default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc)
    )


class SydekykHostedAssignment(Base):
    """Admin-set, global per-Sydekyk config for the "Power Core" (Sydekyks-hosted) tier — the
    real provider/model that actually runs whenever any tenant picks Power Core for this Sydekyk.
    One shared LiteLLM model registration backs every tenant using it."""

    __tablename__ = "sydekyk_hosted_assignments"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    sydekyk_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sydekyks.id", ondelete="CASCADE"), nullable=False, unique=True, index=True
    )
    hosted_provider: Mapped[str] = mapped_column(String(20), nullable=False)
    hosted_model: Mapped[str] = mapped_column(String(150), nullable=False)
    litellm_model_alias: Mapped[str | None] = mapped_column(String(150), nullable=True)
    litellm_model_id: Mapped[str | None] = mapped_column(String(150), nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(
        default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc)
    )


class TenantSydekykLLMConfig(Base):
    """Which engine a specific tenant has chosen for a specific installed Sydekyk — the core of
    the "mixture" model: some Sydekyks on Power Core, some on the tenant's own BYOK key."""

    __tablename__ = "tenant_sydekyk_llm_configs"
    __table_args__ = (UniqueConstraint("tenant_id", "sydekyk_id", name="uq_tenant_sydekyk_llm_config"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    sydekyk_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sydekyks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    provider: Mapped[str] = mapped_column(String(20), nullable=False, default="power_core")
    model: Mapped[str | None] = mapped_column(String(150), nullable=True)  # set for BYOK; null for power_core

    litellm_model_alias: Mapped[str | None] = mapped_column(String(150), nullable=True)
    litellm_model_id: Mapped[str | None] = mapped_column(String(150), nullable=True)
    litellm_virtual_key_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)

    status: Mapped[str] = mapped_column(String(20), nullable=False, default="untested")  # untested|connected|error
    last_tested_at: Mapped[datetime | None] = mapped_column(nullable=True)
    last_test_error: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(
        default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc)
    )


class CentralProviderKey(Base):
    """API keys Sydekyks itself holds centrally, used to back the Power Core tier."""

    __tablename__ = "central_provider_keys"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    provider: Mapped[str] = mapped_column(String(20), unique=True, nullable=False, index=True)
    encrypted_api_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    api_base: Mapped[str | None] = mapped_column(String(500), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc)
    )


class TenantSydekykUsageSnapshot(Base):
    """Local resilience cache of a (tenant, sydekyk) pair's Power Core spend — NOT the source of
    truth (LiteLLM's own DB owns real spend history). Only tracked for power_core configs per
    the "we only track expenses for Sydekyk-as-provider" decision — BYOK usage isn't tracked yet."""

    __tablename__ = "tenant_sydekyk_usage_snapshots"
    __table_args__ = (UniqueConstraint("tenant_id", "sydekyk_id", name="uq_tenant_sydekyk_usage"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    sydekyk_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sydekyks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    spend_used: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    last_refreshed_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(timezone.utc))
    refresh_error: Mapped[str | None] = mapped_column(Text, nullable=True)
