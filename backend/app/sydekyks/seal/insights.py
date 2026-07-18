"""Seal dashboard - contracts are token-intensive work (long HTML in and out on every revision and
review), so the card leads with tokens + AI cost, then the time/$ saved vs writing and reviewing a
contract by hand. The AI-only value line: contracts reviewed and how many HIGH-severity clauses were
caught - the risk a template tool would have shipped unnoticed.
"""

import uuid
from collections import Counter

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.sydekyk import SydekykInstall
from app.models.usage_record import UsageRecord
from app.services import savings
from app.sydekyks.seal.models import SealChatMessage, SealContract, SealReviewFinding, SealTenantSettings


def seal_activated(db: Session, tenant_id: uuid.UUID, sydekyk_id: uuid.UUID) -> bool:
    return (
        db.query(SydekykInstall)
        .filter(SydekykInstall.tenant_id == tenant_id, SydekykInstall.sydekyk_id == sydekyk_id)
        .first()
    ) is not None


def compute_insights(db: Session, tenant_id: uuid.UUID, sydekyk_id: uuid.UUID) -> dict:
    contracts = db.query(SealContract).filter(
        SealContract.tenant_id == tenant_id, SealContract.sydekyk_id == sydekyk_id
    ).all()
    contracts_created = len(contracts)
    contracts_final = sum(1 for c in contracts if c.status == "final")
    contracts_reviewed = sum(1 for c in contracts if (c.review_seq or 0) > 0)

    revisions = (
        db.query(func.count(SealChatMessage.id))
        .filter(SealChatMessage.tenant_id == tenant_id, SealChatMessage.role == "assistant")
        .scalar()
    ) or 0

    high_caught = (
        db.query(func.count(SealReviewFinding.id))
        .filter(SealReviewFinding.tenant_id == tenant_id, SealReviewFinding.severity == "high")
        .scalar()
    ) or 0
    redlines_accepted = (
        db.query(func.count(SealReviewFinding.id))
        .filter(SealReviewFinding.tenant_id == tenant_id, SealReviewFinding.status == "accepted")
        .scalar()
    ) or 0

    tok_row = (
        db.query(
            func.coalesce(func.sum(UsageRecord.total_tokens), 0),
            func.coalesce(func.sum(UsageRecord.cost_usd), 0.0),
        )
        .filter(UsageRecord.tenant_id == tenant_id, UsageRecord.sydekyk_id == sydekyk_id)
        .first()
    )
    total_tokens = int(tok_row[0]) if tok_row else 0
    ai_cost = round(float(tok_row[1]), 4) if tok_row else 0.0

    cp_counter: Counter = Counter(c.counterparty_name for c in contracts if c.counterparty_name)
    top_counterparties = [{"label": k, "count": v} for k, v in cp_counter.most_common(6)]

    s = db.query(SealTenantSettings).filter(SealTenantSettings.tenant_id == tenant_id).first()
    wage = s.estimated_hourly_wage if s else 60.0
    minutes = s.estimated_minutes_per_contract if s else 90.0
    save = savings.compute(db, tenant_id, sydekyk_id, count=contracts_created, minutes_each=minutes, hourly_wage=wage)
    save.pop("ai_cost", None)  # we surface the real UsageRecord AI cost below instead
    save["processing_seconds"] = savings.processing_seconds(db, tenant_id, sydekyk_id)

    return {
        "contracts_created": contracts_created,
        "contracts_final": contracts_final,
        "revisions": int(revisions),
        "contracts_reviewed": contracts_reviewed,
        "high_severity_caught": int(high_caught),
        "redlines_accepted": int(redlines_accepted),
        "total_tokens": total_tokens,
        "ai_cost": ai_cost,
        "top_counterparties": top_counterparties,
        **save,
    }
