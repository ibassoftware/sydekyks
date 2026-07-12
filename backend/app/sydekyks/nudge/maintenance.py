"""Nudge upkeep: keep the per-stage silence thresholds aligned with the tenant's real CRM stages.

Stages can be renamed, merged, or deleted in Odoo. An override keyed on a stage id that no longer
exists is dead config — it silently stops applying. A daily cron reconciles the saved overrides
against the live stage ids, prunes the dead ones, and raises a Command-Center issue so an admin knows
a threshold they set is gone.
"""

import uuid

from sqlalchemy.orm import Session

from app.services import tenant_issues
from app.sydekyks.nudge.models import NudgeTenantSettings


def reconcile_stage_thresholds(
    db: Session, *, tenant_id: uuid.UUID, sydekyk_id: uuid.UUID, real_stage_ids: set[int]
) -> list[int]:
    """Drop per-stage overrides whose stage id no longer exists in Odoo; raise/clear an issue.
    Returns the list of dropped stage ids. Pure w.r.t. Odoo — the caller supplies `real_stage_ids`,
    so it's unit-testable. A None/empty stage set is treated as 'couldn't read stages' and is a
    no-op (never prune on a failed read)."""
    if not real_stage_ids:
        return []
    s = db.query(NudgeTenantSettings).filter(NudgeTenantSettings.tenant_id == tenant_id).first()
    if s is None or not s.stage_thresholds:
        return []

    dropped = [int(k) for k in s.stage_thresholds if int(k) not in real_stage_ids]
    if not dropped:
        return []

    s.stage_thresholds = {k: v for k, v in s.stage_thresholds.items() if int(k) in real_stage_ids} or None
    tenant_issues.report_issue(
        db, tenant_id=tenant_id, sydekyk_id=sydekyk_id, kind="nudge_stage_drift",
        title=f"{len(dropped)} Nudge stage threshold{'s' if len(dropped) != 1 else ''} no longer match Odoo",
        detail=(
            "One or more CRM stages you set a custom silence threshold for were removed or merged in "
            "Odoo, so those overrides were dropped. Re-open Nudge → Settings and set the threshold on "
            "the current stages. Until then those opportunities use the default threshold."
        ),
    )
    db.commit()
    return dropped
