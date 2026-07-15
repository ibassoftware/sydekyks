"""Seal (contract generator + reviewer) tables: settings, templates, contracts, assets, chat messages,
review findings

Revision ID: 0029_seal_tables
Revises: 0028_postmark_webhook_auth
Create Date: 2026-07-15
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from migrations.helpers import has_index, has_table

revision = "0029_seal_tables"
down_revision = "0028_postmark_webhook_auth"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if not has_table("seal_tenant_settings"):
        op.create_table(
            "seal_tenant_settings",
            sa.Column("id", UUID(as_uuid=True), primary_key=True),
            sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"),
                      nullable=False, unique=True),
            sa.Column("default_template_id", UUID(as_uuid=True), nullable=True),
            sa.Column("review_guidelines", sa.Text(), nullable=False, server_default=""),
            sa.Column("page_size", sa.String(length=12), nullable=False, server_default="A4"),
            sa.Column("accent_color", sa.String(length=12), nullable=True),
            sa.Column("header_text", sa.String(length=300), nullable=True),
            sa.Column("footer_text", sa.String(length=300), nullable=True),
            sa.Column("logo_asset_id", UUID(as_uuid=True), nullable=True),
            sa.Column("estimated_hourly_wage", sa.Float(), nullable=False, server_default="60.0"),
            sa.Column("estimated_minutes_per_contract", sa.Float(), nullable=False, server_default="90.0"),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        )

    if not has_table("seal_templates"):
        op.create_table(
            "seal_templates",
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
        if not has_index("seal_templates", "ix_seal_templates_tenant_id"):
            op.create_index("ix_seal_templates_tenant_id", "seal_templates", ["tenant_id"])

    if not has_table("seal_contracts"):
        op.create_table(
            "seal_contracts",
            sa.Column("id", UUID(as_uuid=True), primary_key=True),
            sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
            sa.Column("sydekyk_id", UUID(as_uuid=True), sa.ForeignKey("sydekyks.id", ondelete="CASCADE"), nullable=False),
            sa.Column("title", sa.String(length=255), nullable=False, server_default="Untitled contract"),
            sa.Column("content_html", sa.Text(), nullable=False, server_default=""),
            sa.Column("status", sa.String(length=16), nullable=False, server_default="draft"),
            sa.Column("template_id", UUID(as_uuid=True), nullable=True),
            sa.Column("counterparty_name", sa.String(length=255), nullable=True),
            sa.Column("review_seq", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("odoo_lead_id", sa.Integer(), nullable=True),
            sa.Column("odoo_partner_id", sa.Integer(), nullable=True),
            sa.Column("odoo_sign_request_id", sa.Integer(), nullable=True),
            sa.Column("mission_id", UUID(as_uuid=True), sa.ForeignKey("missions.id", ondelete="SET NULL"), nullable=True),
            sa.Column("created_by", sa.String(length=255), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        )
        for col in ("tenant_id", "sydekyk_id"):
            idx = f"ix_seal_contracts_{col}"
            if not has_index("seal_contracts", idx):
                op.create_index(idx, "seal_contracts", [col])

    if not has_table("seal_assets"):
        op.create_table(
            "seal_assets",
            sa.Column("id", UUID(as_uuid=True), primary_key=True),
            sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
            sa.Column("contract_id", UUID(as_uuid=True), nullable=True),
            sa.Column("filename", sa.String(length=255), nullable=False, server_default="image"),
            sa.Column("content_type", sa.String(length=80), nullable=False, server_default="application/octet-stream"),
            sa.Column("size_bytes", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("content", sa.LargeBinary(), nullable=False),
            sa.Column("created_by", sa.String(length=255), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        )
        for col in ("tenant_id", "contract_id"):
            idx = f"ix_seal_assets_{col}"
            if not has_index("seal_assets", idx):
                op.create_index(idx, "seal_assets", [col])

    if not has_table("seal_chat_messages"):
        op.create_table(
            "seal_chat_messages",
            sa.Column("id", UUID(as_uuid=True), primary_key=True),
            sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
            sa.Column("contract_id", UUID(as_uuid=True), sa.ForeignKey("seal_contracts.id", ondelete="CASCADE"), nullable=False),
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
        for col in ("tenant_id", "contract_id"):
            idx = f"ix_seal_chat_messages_{col}"
            if not has_index("seal_chat_messages", idx):
                op.create_index(idx, "seal_chat_messages", [col])

    if not has_table("seal_review_findings"):
        op.create_table(
            "seal_review_findings",
            sa.Column("id", UUID(as_uuid=True), primary_key=True),
            sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
            sa.Column("contract_id", UUID(as_uuid=True), sa.ForeignKey("seal_contracts.id", ondelete="CASCADE"), nullable=False),
            sa.Column("review_seq", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("clause_label", sa.String(length=200), nullable=False, server_default=""),
            sa.Column("category", sa.String(length=40), nullable=False, server_default="other"),
            sa.Column("severity", sa.String(length=8), nullable=False, server_default="low"),
            sa.Column("issue", sa.Text(), nullable=False, server_default=""),
            sa.Column("rationale", sa.Text(), nullable=False, server_default=""),
            sa.Column("clause_anchor", sa.Text(), nullable=False, server_default=""),
            sa.Column("suggested_redline", sa.Text(), nullable=False, server_default=""),
            sa.Column("status", sa.String(length=12), nullable=False, server_default="open"),
            sa.Column("mission_id", UUID(as_uuid=True), sa.ForeignKey("missions.id", ondelete="SET NULL"), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        )
        for col in ("tenant_id", "contract_id", "review_seq"):
            idx = f"ix_seal_review_findings_{col}"
            if not has_index("seal_review_findings", idx):
                op.create_index(idx, "seal_review_findings", [col])


def downgrade() -> None:
    for table in ("seal_review_findings", "seal_chat_messages", "seal_assets", "seal_contracts",
                  "seal_templates", "seal_tenant_settings"):
        if has_table(table):
            op.drop_table(table)
