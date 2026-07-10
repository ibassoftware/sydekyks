"""Ledger dashboard insights — trend data + an estimated $-saved metric.

Deliberately Ledger-owned (not a generic platform feature): the "how much manual data-entry time
did this save" framing is specific to Ledger's value proposition, not something every future
Sydekyk would want computed the same way.
"""

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.mission import Mission
from app.models.sydekyk import SydekykInstall
from app.models.usage_record import UsageRecord
from app.services import savings
from app.sydekyks.ledger.models import LedgerTenantSettings

TREND_DAYS = 30


def ledger_activated(db: Session, tenant_id: uuid.UUID, ledger_sydekyk_id: uuid.UUID) -> bool:
    installed = (
        db.query(SydekykInstall)
        .filter(SydekykInstall.tenant_id == tenant_id, SydekykInstall.sydekyk_id == ledger_sydekyk_id)
        .first()
    )
    return installed is not None


def compute_insights(db: Session, tenant_id: uuid.UUID, ledger_sydekyk_id: uuid.UUID) -> dict:
    settings = db.query(LedgerTenantSettings).filter(LedgerTenantSettings.tenant_id == tenant_id).first()
    hourly_wage = settings.estimated_hourly_wage if settings else 15.0
    minutes_per_bill = settings.estimated_minutes_per_bill if settings else 5.0

    base = db.query(Mission).filter(Mission.tenant_id == tenant_id, Mission.sydekyk_id == ledger_sydekyk_id)
    total_missions = base.count()
    succeeded_missions = base.filter(Mission.status == "succeeded").count()
    failed_missions = base.filter(Mission.status == "failed").count()
    needs_review_missions = base.filter(
        Mission.status == "succeeded", Mission.result_summary["needs_review"].astext == "true"
    ).count()
    posted_count = base.filter(
        Mission.status == "succeeded", Mission.result_summary["posted"].astext == "true"
    ).count()

    # Every succeeded Mission — even a needs-review one — spared a human from reading the bill and
    # keying it in from scratch; they're reviewing Ledger's draft, not starting blank.
    manual_hours_saved = succeeded_missions * minutes_per_bill / 60.0
    estimated_manual_cost = round(manual_hours_saved * hourly_wage, 2)

    ai_cost = (
        db.query(func.coalesce(func.sum(UsageRecord.cost_usd), 0.0))
        .filter(UsageRecord.tenant_id == tenant_id, UsageRecord.sydekyk_id == ledger_sydekyk_id)
        .scalar()
        or 0.0
    )
    ai_cost = round(float(ai_cost), 4)
    estimated_net_savings = round(estimated_manual_cost - ai_cost, 2)

    cutoff = datetime.now(timezone.utc) - timedelta(days=TREND_DAYS)
    rows = (
        db.query(func.date(Mission.created_at).label("day"), Mission.status, func.count(Mission.id))
        .filter(Mission.tenant_id == tenant_id, Mission.sydekyk_id == ledger_sydekyk_id, Mission.created_at >= cutoff)
        .group_by("day", Mission.status)
        .all()
    )
    by_day: dict[str, dict[str, int]] = {}
    for day, status, count in rows:
        key = day.isoformat() if hasattr(day, "isoformat") else str(day)
        by_day.setdefault(key, {"succeeded": 0, "failed": 0})
        if status in ("succeeded", "failed"):
            by_day[key][status] = count

    daily_trend = []
    today = datetime.now(timezone.utc).date()
    for i in range(TREND_DAYS - 1, -1, -1):
        day = (today - timedelta(days=i)).isoformat()
        counts = by_day.get(day, {"succeeded": 0, "failed": 0})
        daily_trend.append({"date": day, "succeeded": counts["succeeded"], "failed": counts["failed"]})

    return {
        "total_missions": total_missions,
        "succeeded_missions": succeeded_missions,
        "failed_missions": failed_missions,
        "needs_review_missions": needs_review_missions,
        "posted_count": posted_count,
        "daily_trend": daily_trend,
        "estimated_hourly_wage": hourly_wage,
        "estimated_minutes_per_bill": minutes_per_bill,
        "estimated_manual_cost": estimated_manual_cost,
        "ai_cost": ai_cost,
        "estimated_net_savings": estimated_net_savings,
        "processing_seconds": savings.processing_seconds(db, tenant_id, ledger_sydekyk_id),
    }
