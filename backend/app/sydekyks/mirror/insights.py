"""Mirror dashboard — duplicates caught, double-payments prevented ($), and a queue of the latest
flags to act on. Gated on Mirror being installed. Reads the MirrorFinding store."""

import uuid
from collections import Counter
from datetime import datetime, timedelta, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.sydekyk import SydekykInstall
from app.services import gadget_links, savings
from app.sydekyks.mirror.models import MirrorFinding, MirrorTenantSettings

TREND_DAYS = 30


def mirror_activated(db: Session, tenant_id: uuid.UUID, sydekyk_id: uuid.UUID) -> bool:
    return (
        db.query(SydekykInstall)
        .filter(SydekykInstall.tenant_id == tenant_id, SydekykInstall.sydekyk_id == sydekyk_id)
        .first()
    ) is not None


def compute_insights(db: Session, tenant_id: uuid.UUID, sydekyk_id: uuid.UUID) -> dict:
    base = db.query(MirrorFinding).filter(
        MirrorFinding.tenant_id == tenant_id, MirrorFinding.sydekyk_id == sydekyk_id
    )
    rows = base.all()
    total = len(rows)
    dupes = [r for r in rows if r.is_duplicate]
    suppressed = sum(1 for r in rows if r.suppressed)
    prevented = round(sum(float(r.amount or 0.0) for r in dupes), 2)

    tiers: Counter = Counter(r.tier or "none" for r in dupes)
    by_tier = [{"tier": k, "count": v} for k, v in tiers.most_common()]

    base_url = gadget_links.assigned_odoo_base_url(db, tenant_id=tenant_id, sydekyk_id=sydekyk_id)
    recent = sorted(dupes, key=lambda r: r.created_at, reverse=True)[:10]
    recent_flags = [
        {
            "odoo_move_id": r.odoo_move_id, "vendor_name": r.vendor_name, "ref": r.ref,
            "amount": r.amount, "currency": r.currency, "confidence": r.confidence, "tier": r.tier,
            "reasons": r.reasons or [],
            "odoo_url": gadget_links.odoo_form_url(base_url, "account.move", r.odoo_move_id) if base_url else None,
            "human_decision": r.human_decision, "finding_id": r.id,
        }
        for r in recent
    ]

    cutoff = datetime.now(timezone.utc) - timedelta(days=TREND_DAYS)
    trend_rows = (
        db.query(func.date(MirrorFinding.created_at).label("day"), func.count(MirrorFinding.id))
        .filter(MirrorFinding.tenant_id == tenant_id, MirrorFinding.sydekyk_id == sydekyk_id,
                MirrorFinding.created_at >= cutoff)
        .group_by("day")
        .all()
    )
    by_day = {(d.isoformat() if hasattr(d, "isoformat") else str(d)): int(c) for d, c in trend_rows}
    today = datetime.now(timezone.utc).date()
    daily_trend = [
        {"date": (today - timedelta(days=i)).isoformat(), "count": by_day.get((today - timedelta(days=i)).isoformat(), 0)}
        for i in range(TREND_DAYS - 1, -1, -1)
    ]

    s = db.query(MirrorTenantSettings).filter(MirrorTenantSettings.tenant_id == tenant_id).first()
    wage = s.estimated_hourly_wage if s else 30.0
    minutes = s.estimated_minutes_per_review if s else 8.0
    save = savings.compute(db, tenant_id, sydekyk_id, count=total, minutes_each=minutes, hourly_wage=wage)
    save["processing_seconds"] = savings.processing_seconds(db, tenant_id, sydekyk_id)

    return {
        "total_checked": total,
        "duplicates_found": len(dupes),
        "suppressed_count": suppressed,
        "prevented_amount": prevented,
        "by_tier": by_tier,
        "recent_flags": recent_flags,
        "daily_trend": daily_trend,
        **save,
    }
