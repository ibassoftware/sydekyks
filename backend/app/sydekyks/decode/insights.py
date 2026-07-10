"""Decode recruitment dashboard — parsing throughput + candidate insights, from the DecodeApplicant
store. Gated on the Sydekyk being installed (mirrors Ledger's `ledger_activated`)."""

import uuid
from collections import Counter
from datetime import datetime, timedelta, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.sydekyk import SydekykInstall
from app.services import savings
from app.sydekyks.decode.models import DecodeApplicant, DecodeTenantSettings

TREND_DAYS = 30


def decode_activated(db: Session, tenant_id: uuid.UUID, sydekyk_id: uuid.UUID) -> bool:
    return (
        db.query(SydekykInstall)
        .filter(SydekykInstall.tenant_id == tenant_id, SydekykInstall.sydekyk_id == sydekyk_id)
        .first()
    ) is not None


def compute_insights(db: Session, tenant_id: uuid.UUID, sydekyk_id: uuid.UUID) -> dict:
    base = db.query(DecodeApplicant).filter(
        DecodeApplicant.tenant_id == tenant_id, DecodeApplicant.sydekyk_id == sydekyk_id
    )
    total = base.count()
    pooling = base.filter(DecodeApplicant.is_pooling.is_(True)).count()
    needs_review = base.filter(DecodeApplicant.needs_review.is_(True)).count()

    counter: Counter = Counter()
    for row in base.all():
        for skill in (row.skills or []):
            if skill:
                counter[str(skill)] += 1
    top_skills = [{"skill": k, "count": v} for k, v in counter.most_common(10)]

    cutoff = datetime.now(timezone.utc) - timedelta(days=TREND_DAYS)
    rows = (
        db.query(func.date(DecodeApplicant.created_at).label("day"), func.count(DecodeApplicant.id))
        .filter(DecodeApplicant.tenant_id == tenant_id, DecodeApplicant.sydekyk_id == sydekyk_id,
                DecodeApplicant.created_at >= cutoff)
        .group_by("day")
        .all()
    )
    by_day = {(d.isoformat() if hasattr(d, "isoformat") else str(d)): int(c) for d, c in rows}
    today = datetime.now(timezone.utc).date()
    daily_trend = [
        {"date": (today - timedelta(days=i)).isoformat(), "count": by_day.get((today - timedelta(days=i)).isoformat(), 0)}
        for i in range(TREND_DAYS - 1, -1, -1)
    ]

    s = db.query(DecodeTenantSettings).filter(DecodeTenantSettings.tenant_id == tenant_id).first()
    wage = s.estimated_hourly_wage if s else 20.0
    minutes = s.estimated_minutes_per_resume if s else 10.0
    save = savings.compute(db, tenant_id, sydekyk_id, count=total, minutes_each=minutes, hourly_wage=wage)
    save["processing_seconds"] = savings.processing_seconds(db, tenant_id, sydekyk_id)

    return {
        "total_applicants": total,
        "with_job_count": total - pooling,
        "pooling_count": pooling,
        "needs_review_count": needs_review,
        "top_skills": top_skills,
        "daily_trend": daily_trend,
        **save,
    }
