"""Scout scoring dashboard — throughput, average score, distribution, and top candidates from the
ScoutApplicant store. Gated on Scout being installed."""

import uuid
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.sydekyk import SydekykInstall
from app.services import gadget_links, savings
from app.sydekyks.scout.models import ScoutApplicant, ScoutTenantSettings

TREND_DAYS = 30
_BANDS = [("85-100", 85, 101), ("70-84", 70, 85), ("50-69", 50, 70), ("0-49", 0, 50)]
STRONG_SCORE = 80  # display-only band for "strong candidates" (Scout has no review gate)


def _tally(counter: Counter, display: dict, phrases) -> None:
    """Count free-text strength/weakness phrases, grouping case/whitespace variants under one key
    while keeping a readable first-seen label for display."""
    for p in phrases or []:
        norm = " ".join(str(p).split())
        if not norm:
            continue
        key = norm.lower()
        counter[key] += 1
        display.setdefault(key, norm)


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

    distribution = [
        {"band": label, "count": base.filter(ScoutApplicant.score >= lo, ScoutApplicant.score < hi).count()}
        for label, lo, hi in _BANDS
    ]

    # Per-role shortlist + health, and common strength/gap themes — one pass over the store.
    rows_all = base.all()
    by_role: dict = defaultdict(list)
    strengths_counter: Counter = Counter()
    weaknesses_counter: Counter = Counter()
    s_display: dict = {}
    w_display: dict = {}
    for r in rows_all:
        by_role[r.job_name or "Unassigned"].append(r)
        _tally(strengths_counter, s_display, r.strengths)
        _tally(weaknesses_counter, w_display, r.weaknesses)

    base_url = gadget_links.assigned_odoo_base_url(db, tenant_id=tenant_id, sydekyk_id=sydekyk_id)

    def _cand(r) -> dict:
        return {
            "applicant_name": r.applicant_name,
            "score": r.score,
            "summary": r.summary,
            "odoo_url": (
                gadget_links.odoo_form_url(base_url, "hr.applicant", r.odoo_applicant_id)
                if base_url and r.odoo_applicant_id else None
            ),
        }

    role_health = []
    for job, rs in by_role.items():
        scored = len(rs)
        top3 = sorted(rs, key=lambda x: (x.score, x.created_at), reverse=True)[:3]
        role_health.append({
            "job_name": job,
            "scored": scored,
            "strong": sum(1 for x in rs if x.score >= STRONG_SCORE),
            "avg_score": round(sum(x.score for x in rs) / scored, 1) if scored else 0.0,
            "top_score": max((x.score for x in rs), default=0),
            "top_candidates": [_cand(x) for x in top3],
        })
    role_health.sort(key=lambda d: d["scored"], reverse=True)
    role_health = role_health[:12]

    common_strengths = [{"label": s_display[k], "count": v} for k, v in strengths_counter.most_common(8)]
    common_weaknesses = [{"label": w_display[k], "count": v} for k, v in weaknesses_counter.most_common(8)]

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
    save["processing_seconds"] = savings.processing_seconds(db, tenant_id, sydekyk_id)

    return {
        "total_scored": total,
        "average_score": round(float(avg), 1),
        "strong_count": sum(1 for r in rows_all if r.score >= STRONG_SCORE),
        "distribution": distribution,
        "role_health": role_health,
        "common_strengths": common_strengths,
        "common_weaknesses": common_weaknesses,
        "daily_trend": daily_trend,
        **save,
    }
