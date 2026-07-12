"""Nudge dashboard — the ranked "value-at-risk" follow-up queue is the product. Headline metric is
"follow-ups never missed" = stale opps caught / open opps tracked. Also: follow-ups drafted, revenue
at risk, which stages go stale most, and the time/$ saved vs writing follow-ups by hand.
"""

import uuid
from collections import Counter
from datetime import datetime, timedelta, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.sydekyk import SydekykInstall
from app.services import gadget_links, savings
from app.sydekyks.nudge.models import NudgeFinding, NudgeTenantSettings

TREND_DAYS = 30


def nudge_activated(db: Session, tenant_id: uuid.UUID, sydekyk_id: uuid.UUID) -> bool:
    return (
        db.query(SydekykInstall)
        .filter(SydekykInstall.tenant_id == tenant_id, SydekykInstall.sydekyk_id == sydekyk_id)
        .first()
    ) is not None


def _item_out(r: NudgeFinding, base_url: str | None) -> dict:
    return {
        "finding_id": r.id, "odoo_lead_id": r.odoo_lead_id, "opp_name": r.opp_name,
        "partner_name": r.partner_name, "salesperson": r.salesperson, "stage_name": r.stage_name,
        "expected_revenue": r.expected_revenue, "currency": r.currency, "days_stale": r.days_stale,
        "silence_score": r.silence_score, "value_at_risk": r.value_at_risk, "overdue": r.overdue,
        "activity_created": r.activity_created, "draft_body": r.draft_body,
        "odoo_url": gadget_links.odoo_form_url(base_url, "crm.lead", r.odoo_lead_id) if base_url else None,
        "human_decision": r.human_decision,
    }


def pending_nudges(db: Session, tenant_id: uuid.UUID, sydekyk_id: uuid.UUID, *, limit: int, offset: int) -> dict:
    """Paged follow-up queue — drafted nudges awaiting the rep's send/dismiss, highest value-at-risk first."""
    base = db.query(NudgeFinding).filter(
        NudgeFinding.tenant_id == tenant_id, NudgeFinding.sydekyk_id == sydekyk_id,
        NudgeFinding.human_decision.is_(None),
    )
    total = base.count()
    rows = (
        base.order_by(NudgeFinding.value_at_risk.desc().nullslast(), NudgeFinding.silence_score.desc(),
                      NudgeFinding.created_at.desc())
        .limit(limit).offset(offset).all()
    )
    base_url = gadget_links.assigned_odoo_base_url(db, tenant_id=tenant_id, sydekyk_id=sydekyk_id)
    return {"items": [_item_out(r, base_url) for r in rows], "total": total, "limit": limit, "offset": offset}


def compute_insights(db: Session, tenant_id: uuid.UUID, sydekyk_id: uuid.UUID) -> dict:
    base = db.query(NudgeFinding).filter(
        NudgeFinding.tenant_id == tenant_id, NudgeFinding.sydekyk_id == sydekyk_id
    )
    rows = base.all()
    total = len(rows)
    drafted = sum(1 for r in rows if r.activity_created)
    # Distinct stale opps caught (a given opp may be nudged more than once across cycles).
    stale_caught = len({r.odoo_lead_id for r in rows})
    # Headline "revenue at risk" is the REAL pipeline value still exposed — the expected_revenue of the
    # undecided stale deals, de-duplicated per opp so a deal nudged twice isn't counted twice. (The
    # weighted `value_at_risk` = revenue × urgency stays purely as the queue's sort key; showing it as
    # dollars would overstate exposure, e.g. a $22.5k deal 20× past tolerance reading as $450k.)
    exposed_rev: dict[int, float] = {}
    for r in rows:
        if r.human_decision is None:
            exposed_rev[r.odoo_lead_id] = float(r.expected_revenue or 0.0)
    at_risk_total = round(sum(exposed_rev.values()), 2)
    cur_counter: Counter = Counter(r.currency for r in rows if r.currency)
    currency = cur_counter.most_common(1)[0][0] if cur_counter else None

    s = db.query(NudgeTenantSettings).filter(NudgeTenantSettings.tenant_id == tenant_id).first()
    open_total = (s.last_open_total if s and s.last_open_total is not None else stale_caught)
    coverage = round(100.0 * stale_caught / open_total, 1) if open_total else 0.0

    stage_counter: Counter = Counter(r.stage_name for r in rows if r.stage_name)
    top_stages = [{"label": k, "count": v} for k, v in stage_counter.most_common(8)]

    cutoff = datetime.now(timezone.utc) - timedelta(days=TREND_DAYS)
    trend_rows = (
        db.query(func.date(NudgeFinding.created_at).label("day"), func.count(NudgeFinding.id))
        .filter(NudgeFinding.tenant_id == tenant_id, NudgeFinding.sydekyk_id == sydekyk_id,
                NudgeFinding.created_at >= cutoff)
        .group_by("day")
        .all()
    )
    by_day = {(d.isoformat() if hasattr(d, "isoformat") else str(d)): int(c) for d, c in trend_rows}
    today = datetime.now(timezone.utc).date()
    daily_trend = [
        {"date": (today - timedelta(days=i)).isoformat(), "count": by_day.get((today - timedelta(days=i)).isoformat(), 0)}
        for i in range(TREND_DAYS - 1, -1, -1)
    ]

    wage = s.estimated_hourly_wage if s else 35.0
    minutes = s.estimated_minutes_per_followup if s else 6.0
    save = savings.compute(db, tenant_id, sydekyk_id, count=drafted, minutes_each=minutes, hourly_wage=wage)
    save["processing_seconds"] = savings.processing_seconds(db, tenant_id, sydekyk_id)

    return {
        "open_total": open_total,
        "stale_caught": stale_caught,
        "coverage_pct": coverage,
        "followups_drafted": drafted,
        "value_at_risk_total": at_risk_total,
        "currency": currency,
        "top_stages": top_stages,
        "daily_trend": daily_trend,
        **save,
    }
