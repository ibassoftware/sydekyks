"""Mirror dashboard - duplicates caught, double-payments prevented ($), and a queue of the latest
flags to act on. Gated on Mirror being installed. Reads the MirrorFinding store."""

import uuid
from collections import Counter, defaultdict
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


def _flag_out(f: MirrorFinding, base_url: str | None) -> dict:
    return {
        "odoo_move_id": f.odoo_move_id, "vendor_name": f.vendor_name, "ref": f.ref,
        "amount": f.amount, "currency": f.currency, "confidence": f.confidence, "tier": f.tier,
        "reasons": f.reasons or [],
        "odoo_url": gadget_links.odoo_form_url(base_url, "account.move", f.odoo_move_id) if base_url else None,
        "human_decision": f.human_decision, "finding_id": f.id,
    }


def pending_flags(db: Session, tenant_id: uuid.UUID, sydekyk_id: uuid.UUID, *, limit: int, offset: int) -> dict:
    """A paged worklist of flagged duplicates still awaiting a human decision (newest first)."""
    base = db.query(MirrorFinding).filter(
        MirrorFinding.tenant_id == tenant_id, MirrorFinding.sydekyk_id == sydekyk_id,
        MirrorFinding.is_duplicate.is_(True), MirrorFinding.human_decision.is_(None),
    )
    total = base.count()
    rows = base.order_by(MirrorFinding.created_at.desc()).limit(limit).offset(offset).all()
    base_url = gadget_links.assigned_odoo_base_url(db, tenant_id=tenant_id, sydekyk_id=sydekyk_id)
    return {"items": [_flag_out(r, base_url) for r in rows], "total": total, "limit": limit, "offset": offset}


def _prevented_amount(dupes: list[MirrorFinding]) -> float:
    """The double-payment actually avoided. Mirror flags BOTH bills of a duplicate pair, so naively
    summing every flagged amount double-counts. Cluster the mutually-referencing findings (each
    cluster = one purchase billed 2+ times) and, per cluster, count only the EXTRA copies: total
    minus one legitimate payment (the cheapest)."""
    parent: dict = {}

    def find(x):
        parent.setdefault(x, x)
        root = x
        while parent[root] != root:
            root = parent[root]
        while parent[x] != root:
            parent[x], x = root, parent[x]
        return root

    for f in dupes:
        find(f.odoo_move_id)
        for m in (f.matched_move_ids or []):
            parent[find(f.odoo_move_id)] = find(m)

    clusters: dict = defaultdict(list)
    for f in dupes:
        clusters[find(f.odoo_move_id)].append(f)

    total = 0.0
    for group in clusters.values():
        amts = sorted(float(f.amount or 0.0) for f in group)
        s = sum(amts)
        if len(group) >= 2:  # both/all copies were flagged → drop one legitimate payment
            s -= amts[0]
        total += s
    return round(total, 2)


def compute_insights(db: Session, tenant_id: uuid.UUID, sydekyk_id: uuid.UUID) -> dict:
    base = db.query(MirrorFinding).filter(
        MirrorFinding.tenant_id == tenant_id, MirrorFinding.sydekyk_id == sydekyk_id
    )
    rows = base.all()
    total = len(rows)
    dupes = [r for r in rows if r.is_duplicate]
    suppressed = sum(1 for r in rows if r.suppressed)
    prevented = _prevented_amount(dupes)
    cur_counter: Counter = Counter(r.currency for r in dupes if r.currency)
    currency = cur_counter.most_common(1)[0][0] if cur_counter else None

    tiers: Counter = Counter(r.tier or "none" for r in dupes)
    by_tier = [{"tier": k, "count": v} for k, v in tiers.most_common()]

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
        "currency": currency,
        "by_tier": by_tier,
        "daily_trend": daily_trend,
        **save,
    }
