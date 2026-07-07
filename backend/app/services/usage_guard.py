"""Pre-flight quota/capacity gate, shared by every Sydekyk that runs hosted-AI calls.

A playbook calls `check_allowed` before spending any tokens. It enforces both metering dimensions
for the tenant: the monthly TOKEN budget and the rolling-hour GPU-SECOND rate limit. A cap of 0 (or
less) means "unlimited" so an unconfigured plan never blocks work.

Enforcement is "already at/over the cap → deny the next request" — we can't know the next call's
token cost in advance, so a call that tips a tenant over the line still completes; the following one
is refused until the window frees (GPU/hour) or the month rolls (tokens).
"""

import uuid

from sqlalchemy.orm import Session

from app.models.tenant import Tenant
from app.services import metering


def check_allowed(
    db: Session, tenant_id: uuid.UUID, sydekyk_id: uuid.UUID | None, model: str | None
) -> tuple[bool, str | None]:
    """Returns (allowed, reason). `reason` is a human-facing message when denied, else None.
    `sydekyk_id`/`model` are accepted for future per-Sydekyk/per-model policy; today the caps are
    purely per-tenant."""
    tenant = db.get(Tenant, tenant_id)
    if tenant is None:
        return True, None  # no tenant to meter — don't block (shouldn't happen in practice)

    summary = metering.tenant_usage_summary(db, tenant)

    if summary["token_throttled"]:
        return False, (
            f"Monthly AI token allowance reached ({summary['tokens_used_this_month']:,} of "
            f"{summary['monthly_token_cap']:,} tokens used). It resets on the 1st of next month, "
            "or upgrade the plan to raise the cap."
        )

    if summary["gpu_throttled"]:
        return False, (
            f"Hourly AI capacity reached ({summary['gpu_seconds_used_last_hour']:.0f} of "
            f"{summary['gpu_seconds_per_hour_cap']:.0f} GPU-seconds in the last hour). "
            "Please retry shortly, or upgrade the plan to raise the cap."
        )

    return True, None
