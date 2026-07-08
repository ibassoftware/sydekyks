"""Daily usage archive — rolls each (tenant, sydekyk)'s raw UsageRecord rows for a day into one
UsageDaily row (tokens + GPU-seconds + cost). Idempotent (upsert), so re-running is safe. Live cap
enforcement stays windowed over UsageRecord; this is durable history + cheap trend reads.
"""

from datetime import date, datetime, timedelta, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.usage_record import UsageDaily, UsageRecord


def snapshot_usage_for_date(db: Session, day: date) -> int:
    """Upsert one UsageDaily row per (tenant, sydekyk) with activity on `day`. Returns rows written."""
    start = datetime(day.year, day.month, day.day, tzinfo=timezone.utc)
    end = start + timedelta(days=1)
    rows = (
        db.query(
            UsageRecord.tenant_id,
            UsageRecord.sydekyk_id,
            func.coalesce(func.sum(UsageRecord.total_tokens), 0),
            func.coalesce(func.sum(UsageRecord.estimated_gpu_seconds), 0.0),
            func.coalesce(func.sum(UsageRecord.cost_usd), 0.0),
        )
        .filter(UsageRecord.created_at >= start, UsageRecord.created_at < end)
        .group_by(UsageRecord.tenant_id, UsageRecord.sydekyk_id)
        .all()
    )
    written = 0
    for tenant_id, sydekyk_id, tokens, gpu, cost in rows:
        q = db.query(UsageDaily).filter(UsageDaily.tenant_id == tenant_id, UsageDaily.date == day)
        q = q.filter(UsageDaily.sydekyk_id == sydekyk_id) if sydekyk_id is not None else q.filter(UsageDaily.sydekyk_id.is_(None))
        existing = q.first()
        if existing is None:
            db.add(UsageDaily(tenant_id=tenant_id, sydekyk_id=sydekyk_id, date=day,
                              total_tokens=int(tokens), gpu_seconds=float(gpu), cost_usd=float(cost)))
        else:
            existing.total_tokens = int(tokens)
            existing.gpu_seconds = float(gpu)
            existing.cost_usd = float(cost)
        written += 1
    db.commit()
    return written


def snapshot_yesterday(db: Session) -> int:
    yesterday = (datetime.now(timezone.utc) - timedelta(days=1)).date()
    return snapshot_usage_for_date(db, yesterday)
