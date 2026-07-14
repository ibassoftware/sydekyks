"""Quill (proposal generator) tables: settings, templates, proposals, assets, chat messages

Revision ID: 0024_quill_tables
Revises: 0023_tenant_currency
Create Date: 2026-07-14
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from migrations.helpers import has_index, has_table

revision = "0024_quill_tables"
down_revision = "0023_tenant_currency"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if not has_table("quill_tenant_settings"):
        op.create_table(
            "quill_tenant_settings",
            sa.Column("id", UUID(as_uuid=True), primary_key=True),
            sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"),
                      nullable=False, unique=True),
            sa.Column("default_template_id", UUID(as_uuid=True), nullable=True),
            sa.Column("page_size", sa.String(length=12), nullable=False, server_default="A4"),
            sa.Column("accent_color", sa.String(length=12), nullable=True),
            sa.Column("logo_asset_id", UUID(as_uuid=True), nullable=True),
            sa.Column("estimated_hourly_wage", sa.Float(), nullable=False, server_default="45.0"),
            sa.Column("estimated_minutes_per_proposal", sa.Float(), nullable=False, server_default="45.0"),
            sa.Column("auto_create_quotation", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("merge_quotation_pdf", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("upload_to_quotation", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        )

    if not has_table("quill_templates"):
        op.create_table(
            "quill_templates",
            sa.Column("id", UUID(as_uuid=True), primary_key=True),
            sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True),
            sa.Column("name", sa.String(length=200), nullable=False),
            sa.Column("format", sa.String(length=8), nullable=False, server_default="html"),
            sa.Column("body", sa.Text(), nullable=False, server_default=""),
            sa.Column("is_builtin", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("created_by", sa.String(length=255), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        )
        if not has_index("quill_templates", "ix_quill_templates_tenant_id"):
            op.create_index("ix_quill_templates_tenant_id", "quill_templates", ["tenant_id"])

    if not has_table("quill_proposals"):
        op.create_table(
            "quill_proposals",
            sa.Column("id", UUID(as_uuid=True), primary_key=True),
            sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
            sa.Column("sydekyk_id", UUID(as_uuid=True), sa.ForeignKey("sydekyks.id", ondelete="CASCADE"), nullable=False),
            sa.Column("title", sa.String(length=255), nullable=False, server_default="Untitled proposal"),
            sa.Column("content_html", sa.Text(), nullable=False, server_default=""),
            sa.Column("status", sa.String(length=16), nullable=False, server_default="draft"),
            sa.Column("template_id", UUID(as_uuid=True), nullable=True),
            sa.Column("customer_name", sa.String(length=255), nullable=True),
            sa.Column("odoo_lead_id", sa.Integer(), nullable=True),
            sa.Column("odoo_sale_order_id", sa.Integer(), nullable=True),
            sa.Column("odoo_sale_order_name", sa.String(length=64), nullable=True),
            sa.Column("mission_id", UUID(as_uuid=True), sa.ForeignKey("missions.id", ondelete="SET NULL"), nullable=True),
            sa.Column("created_by", sa.String(length=255), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        )
        for col in ("tenant_id", "sydekyk_id"):
            idx = f"ix_quill_proposals_{col}"
            if not has_index("quill_proposals", idx):
                op.create_index(idx, "quill_proposals", [col])

    if not has_table("quill_assets"):
        op.create_table(
            "quill_assets",
            sa.Column("id", UUID(as_uuid=True), primary_key=True),
            sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
            sa.Column("proposal_id", UUID(as_uuid=True), nullable=True),
            sa.Column("filename", sa.String(length=255), nullable=False, server_default="image"),
            sa.Column("content_type", sa.String(length=80), nullable=False, server_default="application/octet-stream"),
            sa.Column("size_bytes", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("content", sa.LargeBinary(), nullable=False),
            sa.Column("created_by", sa.String(length=255), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        )
        for col in ("tenant_id", "proposal_id"):
            idx = f"ix_quill_assets_{col}"
            if not has_index("quill_assets", idx):
                op.create_index(idx, "quill_assets", [col])

    if not has_table("quill_chat_messages"):
        op.create_table(
            "quill_chat_messages",
            sa.Column("id", UUID(as_uuid=True), primary_key=True),
            sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
            sa.Column("proposal_id", UUID(as_uuid=True), sa.ForeignKey("quill_proposals.id", ondelete="CASCADE"), nullable=False),
            sa.Column("seq", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("role", sa.String(length=12), nullable=False),
            sa.Column("content", sa.Text(), nullable=False, server_default=""),
            sa.Column("mission_id", UUID(as_uuid=True), sa.ForeignKey("missions.id", ondelete="SET NULL"), nullable=True),
            sa.Column("prompt_tokens", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("completion_tokens", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("total_tokens", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("cost_usd", sa.Float(), nullable=False, server_default="0.0"),
            sa.Column("created_by", sa.String(length=255), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        )
        for col in ("tenant_id", "proposal_id"):
            idx = f"ix_quill_chat_messages_{col}"
            if not has_index("quill_chat_messages", idx):
                op.create_index(idx, "quill_chat_messages", [col])


def downgrade() -> None:
    for table in ("quill_chat_messages", "quill_assets", "quill_proposals", "quill_templates", "quill_tenant_settings"):
        if has_table(table):
            op.drop_table(table)
