"""Signet (native e-signature) tables: settings, assets, envelopes, signers, events

Revision ID: 0030_signet_tables
Revises: 0029_seal_tables
Create Date: 2026-07-15
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from migrations.helpers import has_index, has_table

revision = "0030_signet_tables"
down_revision = "0029_seal_tables"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if not has_table("signet_tenant_settings"):
        op.create_table(
            "signet_tenant_settings",
            sa.Column("id", UUID(as_uuid=True), primary_key=True),
            sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"),
                      nullable=False, unique=True),
            sa.Column("sender_name", sa.String(length=120), nullable=True),
            sa.Column("reminder_interval_days", sa.Integer(), nullable=False, server_default="3"),
            sa.Column("max_reminders", sa.Integer(), nullable=False, server_default="3"),
            sa.Column("expiry_days", sa.Integer(), nullable=False, server_default="30"),
            sa.Column("email_copy_mode", sa.String(length=12), nullable=False, server_default="template"),
            sa.Column("email_prompt", sa.Text(), nullable=False, server_default=""),
            sa.Column("estimated_hourly_wage", sa.Float(), nullable=False, server_default="45.0"),
            sa.Column("estimated_minutes_per_signature", sa.Float(), nullable=False, server_default="25.0"),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        )

    if not has_table("signet_assets"):
        op.create_table(
            "signet_assets",
            sa.Column("id", UUID(as_uuid=True), primary_key=True),
            sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
            sa.Column("envelope_id", UUID(as_uuid=True), nullable=True),
            sa.Column("kind", sa.String(length=12), nullable=False, server_default="source"),
            sa.Column("filename", sa.String(length=255), nullable=False, server_default="document.pdf"),
            sa.Column("content_type", sa.String(length=80), nullable=False, server_default="application/pdf"),
            sa.Column("size_bytes", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("content", sa.LargeBinary(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        )
        for col in ("tenant_id", "envelope_id"):
            idx = f"ix_signet_assets_{col}"
            if not has_index("signet_assets", idx):
                op.create_index(idx, "signet_assets", [col])

    if not has_table("signet_envelopes"):
        op.create_table(
            "signet_envelopes",
            sa.Column("id", UUID(as_uuid=True), primary_key=True),
            sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
            sa.Column("sydekyk_id", UUID(as_uuid=True), sa.ForeignKey("sydekyks.id", ondelete="CASCADE"), nullable=False),
            sa.Column("seal_contract_id", UUID(as_uuid=True), nullable=True),
            sa.Column("title", sa.String(length=255), nullable=False, server_default="Untitled document"),
            sa.Column("message", sa.Text(), nullable=False, server_default=""),
            sa.Column("source_asset_id", UUID(as_uuid=True), nullable=True),
            sa.Column("signed_pdf_asset_id", UUID(as_uuid=True), nullable=True),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="draft"),
            sa.Column("signing_order", sa.String(length=12), nullable=False, server_default="parallel"),
            sa.Column("reminder_interval_days", sa.Integer(), nullable=False, server_default="3"),
            sa.Column("max_reminders", sa.Integer(), nullable=False, server_default="3"),
            sa.Column("email_copy_mode", sa.String(length=12), nullable=False, server_default="template"),
            sa.Column("email_prompt", sa.Text(), nullable=False, server_default=""),
            sa.Column("hold", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("odoo_record_model", sa.String(length=64), nullable=True),
            sa.Column("odoo_record_id", sa.Integer(), nullable=True),
            sa.Column("mission_id", UUID(as_uuid=True), sa.ForeignKey("missions.id", ondelete="SET NULL"), nullable=True),
            sa.Column("created_by", sa.String(length=255), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
            sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        )
        for col in ("tenant_id", "sydekyk_id", "seal_contract_id", "status"):
            idx = f"ix_signet_envelopes_{col}"
            if not has_index("signet_envelopes", idx):
                op.create_index(idx, "signet_envelopes", [col])

    if not has_table("signet_signers"):
        op.create_table(
            "signet_signers",
            sa.Column("id", UUID(as_uuid=True), primary_key=True),
            sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
            sa.Column("envelope_id", UUID(as_uuid=True), sa.ForeignKey("signet_envelopes.id", ondelete="CASCADE"), nullable=False),
            sa.Column("name", sa.String(length=200), nullable=False),
            sa.Column("email", sa.String(length=320), nullable=False),
            sa.Column("order", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("token_hash", sa.String(length=64), nullable=False),
            sa.Column("token_encrypted", sa.Text(), nullable=False, server_default=""),
            sa.Column("status", sa.String(length=12), nullable=False, server_default="pending"),
            sa.Column("signature_name", sa.String(length=200), nullable=True),
            sa.Column("signature_image", sa.LargeBinary(), nullable=True),
            sa.Column("decline_reason", sa.Text(), nullable=True),
            sa.Column("viewed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("signed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_reminded_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("reminder_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("ip_address", sa.String(length=64), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        )
        if not has_index("signet_signers", "ix_signet_signers_tenant_id"):
            op.create_index("ix_signet_signers_tenant_id", "signet_signers", ["tenant_id"])
        if not has_index("signet_signers", "ix_signet_signers_envelope_id"):
            op.create_index("ix_signet_signers_envelope_id", "signet_signers", ["envelope_id"])
        if not has_index("signet_signers", "ix_signet_signers_token_hash"):
            op.create_index("ix_signet_signers_token_hash", "signet_signers", ["token_hash"], unique=True)

    if not has_table("signet_events"):
        op.create_table(
            "signet_events",
            sa.Column("id", UUID(as_uuid=True), primary_key=True),
            sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
            sa.Column("envelope_id", UUID(as_uuid=True), sa.ForeignKey("signet_envelopes.id", ondelete="CASCADE"), nullable=False),
            sa.Column("signer_id", UUID(as_uuid=True), nullable=True),
            sa.Column("event_type", sa.String(length=16), nullable=False),
            sa.Column("detail", sa.Text(), nullable=True),
            sa.Column("ip", sa.String(length=64), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        )
        for col in ("tenant_id", "envelope_id"):
            idx = f"ix_signet_events_{col}"
            if not has_index("signet_events", idx):
                op.create_index(idx, "signet_events", [col])


def downgrade() -> None:
    for table in ("signet_events", "signet_signers", "signet_envelopes", "signet_assets", "signet_tenant_settings"):
        if has_table(table):
            op.drop_table(table)
