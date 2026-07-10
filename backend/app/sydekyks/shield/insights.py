"""Shield dashboard — the ranked auditor review queue is the product. Also: transactions assessed,
how many warranted review, hard-holds, exposure ($ under review), and which rules fire most.
"""

import uuid
from collections import Counter
from datetime import datetime, timedelta, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.sydekyk import SydekykInstall
from app.services import gadget_links, savings
from app.sydekyks.shield.models import ShieldFinding, ShieldTenantSettings

TREND_DAYS = 30


def shield_activated(db: Session, tenant_id: uuid.UUID, sydekyk_id: uuid.UUID) -> bool:
    return (
        db.query(SydekykInstall)
        .filter(SydekykInstall.tenant_id == tenant_id, SydekykInstall.sydekyk_id == sydekyk_id)
        .first()
    ) is not None


def compute_insights(db: Session, tenant_id: uuid.UUID, sydekyk_id: uuid.UUID) -> dict:
    base = db.query(ShieldFinding).filter(
        ShieldFinding.tenant_id == tenant_id, ShieldFinding.sydekyk_id == sydekyk_id
    )
    rows = base.all()
    total = len(rows)
    # "Flagged" = any bill that fired at least one risk signal; the queue shows the riskiest undecided.
    flagged = [r for r in rows if (r.flags or [])]
    holds = sum(1 for r in rows if r.hold)
    exposure = round(sum(float(r.amount or 0.0) for r in flagged if r.human_decision is None), 2)

    rule_counter: Counter = Counter()
    for r in flagged:
        for f in (r.flags or []):
            rule_counter[f.get("label") or f.get("code")] += 1
    top_rules = [{"label": k, "count": v} for k, v in rule_counter.most_common(8)]

    base_url = gadget_links.assigned_odoo_base_url(db, tenant_id=tenant_id, sydekyk_id=sydekyk_id)
    # Ranked queue: undecided first, by hold then risk score.
    queue = sorted(
        [r for r in flagged if r.human_decision is None],
        key=lambda r: (r.hold, r.risk_score, r.created_at), reverse=True,
    )[:12]
    review_queue = [
        {
            "odoo_move_id": r.odoo_move_id, "vendor_name": r.vendor_name, "ref": r.ref,
            "amount": r.amount, "currency": r.currency, "risk_score": r.risk_score, "hold": r.hold,
            "flags": r.flags or [], "summary": r.summary,
            "odoo_url": gadget_links.odoo_form_url(base_url, "account.move", r.odoo_move_id) if base_url else None,
            "human_decision": r.human_decision, "finding_id": r.id,
        }
        for r in queue
    ]

    cutoff = datetime.now(timezone.utc) - timedelta(days=TREND_DAYS)
    trend_rows = (
        db.query(func.date(ShieldFinding.created_at).label("day"), func.count(ShieldFinding.id))
        .filter(ShieldFinding.tenant_id == tenant_id, ShieldFinding.sydekyk_id == sydekyk_id,
                ShieldFinding.created_at >= cutoff)
        .group_by("day")
        .all()
    )
    by_day = {(d.isoformat() if hasattr(d, "isoformat") else str(d)): int(c) for d, c in trend_rows}
    today = datetime.now(timezone.utc).date()
    daily_trend = [
        {"date": (today - timedelta(days=i)).isoformat(), "count": by_day.get((today - timedelta(days=i)).isoformat(), 0)}
        for i in range(TREND_DAYS - 1, -1, -1)
    ]

    s = db.query(ShieldTenantSettings).filter(ShieldTenantSettings.tenant_id == tenant_id).first()
    wage = s.estimated_hourly_wage if s else 45.0
    minutes = s.estimated_minutes_per_review if s else 10.0
    save = savings.compute(db, tenant_id, sydekyk_id, count=total, minutes_each=minutes, hourly_wage=wage)
    save["processing_seconds"] = savings.processing_seconds(db, tenant_id, sydekyk_id)

    return {
        "total_assessed": total,
        "flagged_count": len(flagged),
        "holds_count": holds,
        "exposure_amount": exposure,
        "top_rules": top_rules,
        "review_queue": review_queue,
        "daily_trend": daily_trend,
        **save,
    }
