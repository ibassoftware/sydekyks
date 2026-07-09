"""Scout scoring dashboard — throughput, average score, distribution, and top candidates from the
ScoutApplicant store. Gated on Scout being installed."""

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.sydekyk import SydekykInstall
from app.services import savings
from app.sydekyks.scout.models import ScoutApplicant, ScoutTenantSettings

TREND_DAYS = 30
_BANDS = [("85-100", 85, 101), ("70-84", 70, 85), ("50-69", 50, 70), ("0-49", 0, 50)]


def scout_activated(db: Session, tenant_id: uuid.UUID, sydekyk_id: uuid.UUID) -> bool:
    return (
        db.query(SydekykInstall)
        .filter(SydekykInstall.tenant_id == tenant_id, SydekykInstall.sydekyk_id == sydekyk_id)
        .first()
    ) is not None


def compute_insights(db: Session, tenant_id: uuid.UUID, sydekyk_id: uuid.UUID) -> dict:
    base = db.query(ScoutApplicant).filter(
        ScoutApplicant.tenant_id == tenant_id, ScoutApplicant.sydekyk_id == sydekyk_id
    )
    total = base.count()
    avg = db.query(func.coalesce(func.avg(ScoutApplicant.score), 0.0)).filter(
        ScoutApplicant.tenant_id == tenant_id, ScoutApplicant.sydekyk_id == sydekyk_id
    ).scalar() or 0.0
    needs_review = base.filter(ScoutApplicant.needs_review.is_(True)).count()

    distribution = [
        {"band": label, "count": base.filter(ScoutApplicant.score >= lo, ScoutApplicant.score < hi).count()}
        for label, lo, hi in _BANDS
    ]

    top = (
        base.order_by(ScoutApplicant.score.desc(), ScoutApplicant.created_at.desc()).limit(5).all()
    )
    top_candidates = [
        {"applicant_name": r.applicant_name, "job_name": r.job_name, "score": r.score} for r in top
    ]

    cutoff = datetime.now(timezone.utc) - timedelta(days=TREND_DAYS)
    rows = (
        db.query(func.date(ScoutApplicant.created_at).label("day"), func.count(ScoutApplicant.id))
        .filter(ScoutApplicant.tenant_id == tenant_id, ScoutApplicant.sydekyk_id == sydekyk_id,
                ScoutApplicant.created_at >= cutoff)
        .group_by("day")
        .all()
    )
    by_day = {(d.isoformat() if hasattr(d, "isoformat") else str(d)): int(c) for d, c in rows}
    today = datetime.now(timezone.utc).date()
    daily_trend = [
        {"date": (today - timedelta(days=i)).isoformat(), "count": by_day.get((today - timedelta(days=i)).isoformat(), 0)}
        for i in range(TREND_DAYS - 1, -1, -1)
    ]

    s = db.query(ScoutTenantSettings).filter(ScoutTenantSettings.tenant_id == tenant_id).first()
    wage = s.estimated_hourly_wage if s else 25.0
    minutes = s.estimated_minutes_per_candidate if s else 15.0
    save = savings.compute(db, tenant_id, sydekyk_id, count=total, minutes_each=minutes, hourly_wage=wage)

    return {
        "total_scored": total,
        "average_score": round(float(avg), 1),
        "needs_review_count": needs_review,
        "distribution": distribution,
        "top_candidates": top_candidates,
        "daily_trend": daily_trend,
        **save,
    }
