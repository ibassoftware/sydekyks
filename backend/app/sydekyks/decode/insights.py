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


_SENIORITY_BANDS = [("0-2 yrs", 0, 3), ("3-5 yrs", 3, 6), ("6-9 yrs", 6, 10), ("10+ yrs", 10, 10_000)]


def compute_insights(db: Session, tenant_id: uuid.UUID, sydekyk_id: uuid.UUID) -> dict:
    base = db.query(DecodeApplicant).filter(
        DecodeApplicant.tenant_id == tenant_id, DecodeApplicant.sydekyk_id == sydekyk_id
    )
    rows_all = base.all()
    total = len(rows_all)
    pooling = sum(1 for r in rows_all if r.is_pooling)
    needs_review = sum(1 for r in rows_all if r.needs_review)

    # Single pass over the store: top skills, where they applied, data completeness, seniority mix.
    counter: Counter = Counter()
    positions: Counter = Counter()
    q_email = q_phone = q_skills = q_exp = 0
    seniority = {label: 0 for label, _, _ in _SENIORITY_BANDS}
    seniority["Unknown"] = 0
    for row in rows_all:
        skills = row.skills or []
        for skill in skills:
            if skill:
                counter[str(skill)] += 1
        positions["Pool" if row.is_pooling else (row.job_name or "Unassigned")] += 1
        if row.email:
            q_email += 1
        if row.phone:
            q_phone += 1
        if skills:
            q_skills += 1
        yrs = row.years_experience
        if yrs is None:
            seniority["Unknown"] += 1
            continue
        q_exp += 1
        for label, lo, hi in _SENIORITY_BANDS:
            if lo <= yrs < hi:
                seniority[label] += 1
                break

    top_skills = [{"skill": k, "count": v} for k, v in counter.most_common(10)]
    applications_by_position = [
        {"job_name": name, "count": count} for name, count in positions.most_common(12)
    ]

    def pct(n: int) -> int:
        return round(100 * n / total) if total else 0

    data_quality = {
        "with_email": pct(q_email),
        "with_phone": pct(q_phone),
        "with_skills": pct(q_skills),
        "with_experience": pct(q_exp),
        "needs_review": pct(needs_review),
    }
    seniority_mix = [{"band": label, "count": seniority[label]} for label, _, _ in _SENIORITY_BANDS]
    seniority_mix.append({"band": "Unknown", "count": seniority["Unknown"]})

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
        "applications_by_position": applications_by_position,
        "data_quality": data_quality,
        "seniority_mix": seniority_mix,
        "daily_trend": daily_trend,
        **save,
    }
