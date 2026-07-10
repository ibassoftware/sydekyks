"""Shared 'estimated $ saved' math for Sydekyk dashboards: manual-labor cost avoided minus the AI
cost actually spent. Used by Decode (per résumé parsed) and Scout (per candidate scored); mirrors
Ledger's insight so every Sydekyk frames its value the same way."""

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.mission import Mission
from app.models.usage_record import UsageRecord


def processing_seconds(db: Session, tenant_id, sydekyk_id) -> float:
    """Total wall-clock the agent actually spent doing the work — the sum of completed_at−created_at
    over its succeeded Missions. Powers the dashboard's 'how fast we are' metric (contrast against the
    manual-hours-equivalent)."""
    total = (
        db.query(
            func.coalesce(func.sum(func.extract("epoch", Mission.completed_at - Mission.created_at)), 0.0)
        )
        .filter(
            Mission.tenant_id == tenant_id,
            Mission.sydekyk_id == sydekyk_id,
            Mission.status == "succeeded",
            Mission.completed_at.isnot(None),
        )
        .scalar()
    )
    return round(float(total or 0.0), 1)


def ai_cost(db: Session, tenant_id, sydekyk_id) -> float:
    total = (
        db.query(func.coalesce(func.sum(UsageRecord.cost_usd), 0.0))
        .filter(UsageRecord.tenant_id == tenant_id, UsageRecord.sydekyk_id == sydekyk_id)
        .scalar()
        or 0.0
    )
    return round(float(total), 4)


def compute(db: Session, tenant_id, sydekyk_id, *, count: int, minutes_each: float, hourly_wage: float) -> dict:
    """Estimated savings for `count` items each taking `minutes_each` of manual work at `hourly_wage`,
    net of the AI cost attributed to this (tenant, sydekyk)."""
    manual_cost = round(count * minutes_each / 60.0 * hourly_wage, 2)
    cost = ai_cost(db, tenant_id, sydekyk_id)
    return {
        "estimated_hourly_wage": hourly_wage,
        "estimated_minutes_each": minutes_each,
        "estimated_manual_cost": manual_cost,
        "ai_cost": cost,
        "estimated_net_savings": round(manual_cost - cost, 2),
    }
