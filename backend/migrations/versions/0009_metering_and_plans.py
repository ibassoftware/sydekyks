"""GPU-second metering + per-tenant plan caps

Adds usage_records.estimated_gpu_seconds, tenant cap-override columns, and three config tables:
platform_metering_config (global rates), model_rate_profiles (per-model multipliers), and
plan_tiers (per-plan default caps). Seeds the three heroic-sidekick plans + the default rate config.

Revision ID: 0009_metering_plans
Revises: 0008_ledger_savings
Create Date: 2026-07-07
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from migrations.helpers import has_column, has_table

revision = "0009_metering_plans"
down_revision = "0008_ledger_savings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Per-call GPU-second estimate, frozen at write time.
    if not has_column("usage_records", "estimated_gpu_seconds"):
        op.add_column(
            "usage_records",
            sa.Column("estimated_gpu_seconds", sa.Float(), nullable=False, server_default="0"),
        )
        op.alter_column("usage_records", "estimated_gpu_seconds", server_default=None)

    # Per-tenant cap overrides (null = inherit the plan tier default).
    if not has_column("tenants", "monthly_token_cap_override"):
        op.add_column("tenants", sa.Column("monthly_token_cap_override", sa.BigInteger(), nullable=True))
    if not has_column("tenants", "gpu_seconds_per_hour_cap_override"):
        op.add_column("tenants", sa.Column("gpu_seconds_per_hour_cap_override", sa.Float(), nullable=True))

    # Global GPU-second rate config (singleton).
    if not has_table("platform_metering_config"):
        op.create_table(
            "platform_metering_config",
            sa.Column("key", sa.String(length=20), primary_key=True),
            sa.Column("prompt_rate", sa.Float(), nullable=False, server_default="3000"),
            sa.Column("generation_rate", sa.Float(), nullable=False, server_default="50"),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        )
        op.bulk_insert(
            sa.table(
                "platform_metering_config",
                sa.column("key", sa.String),
                sa.column("prompt_rate", sa.Float),
                sa.column("generation_rate", sa.Float),
            ),
            [{"key": "default", "prompt_rate": 3000.0, "generation_rate": 50.0}],
        )

    # Per-model multipliers.
    if not has_table("model_rate_profiles"):
        op.create_table(
            "model_rate_profiles",
            sa.Column("id", UUID(as_uuid=True), primary_key=True),
            sa.Column("model", sa.String(length=150), nullable=False),
            sa.Column("multiplier", sa.Float(), nullable=False, server_default="1"),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
            sa.UniqueConstraint("model", name="uq_model_rate_profiles_model"),
        )
        op.create_index("ix_model_rate_profiles_model", "model_rate_profiles", ["model"], unique=True)

    # Plan tiers — seeded with the three heroic-sidekick plans. Caps are PLACEHOLDERS meant to be
    # tuned in the Command Center: Pro should be set to ~"$20 of GPT-5.5" once real pricing is known.
    if not has_table("plan_tiers"):
        op.create_table(
            "plan_tiers",
            sa.Column("key", sa.String(length=50), primary_key=True),
            sa.Column("display_name", sa.String(length=80), nullable=False),
            sa.Column("monthly_token_cap", sa.BigInteger(), nullable=False, server_default="0"),
            sa.Column("gpu_seconds_per_hour_cap", sa.Float(), nullable=False, server_default="0"),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        )
        op.bulk_insert(
            sa.table(
                "plan_tiers",
                sa.column("key", sa.String),
                sa.column("display_name", sa.String),
                sa.column("monthly_token_cap", sa.BigInteger),
                sa.column("gpu_seconds_per_hour_cap", sa.Float),
                sa.column("sort_order", sa.Integer),
            ),
            [
                {"key": "starter", "display_name": "Recruit", "monthly_token_cap": 20_000_000,
                 "gpu_seconds_per_hour_cap": 3_600.0, "sort_order": 1},
                {"key": "intermediate", "display_name": "Vanguard", "monthly_token_cap": 100_000_000,
                 "gpu_seconds_per_hour_cap": 18_000.0, "sort_order": 2},
                {"key": "pro", "display_name": "Legend", "monthly_token_cap": 500_000_000,
                 "gpu_seconds_per_hour_cap": 50_000.0, "sort_order": 3},
            ],
        )


def downgrade() -> None:
    if has_table("plan_tiers"):
        op.drop_table("plan_tiers")
    if has_table("model_rate_profiles"):
        op.drop_table("model_rate_profiles")
    if has_table("platform_metering_config"):
        op.drop_table("platform_metering_config")
    for col in ("gpu_seconds_per_hour_cap_override", "monthly_token_cap_override"):
        if has_column("tenants", col):
            op.drop_column("tenants", col)
    if has_column("usage_records", "estimated_gpu_seconds"):
        op.drop_column("usage_records", "estimated_gpu_seconds")
