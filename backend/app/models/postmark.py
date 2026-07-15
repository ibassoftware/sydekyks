import uuid
from datetime import datetime, timezone

from sqlalchemy import String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class PostmarkConfig(Base):
    """Global (Command Center) Postmark settings — the inbound domain mail is received on and the
    Postmark Server API token. Single-row: one Postmark account backs the whole platform, so this is
    edited in the Command Center rather than per-tenant."""

    __tablename__ = "postmark_config"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    inbound_domain: Mapped[str] = mapped_column(String(255), nullable=False)
    encrypted_server_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Basic Auth the webhook checks so we can prove a POST is really from our Postmark server. Null
    # falls back to the env defaults, so a fresh/legacy row keeps working before it's ever edited.
    webhook_basic_auth_user: Mapped[str | None] = mapped_column(String(255), nullable=True)
    encrypted_webhook_basic_auth_pass: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc)
    )
