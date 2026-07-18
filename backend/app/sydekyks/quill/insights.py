"""Quill dashboard - because proposals are the most token-intensive work on the platform (long HTML in
and out on every revision), the card leads with tokens + AI cost, then the time/$ saved vs writing a
proposal by hand. Also: proposals created, how many reached "final", and the top customers.
"""

import uuid
from collections import Counter

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.sydekyk import SydekykInstall
from app.models.usage_record import UsageRecord
from app.services import savings
from app.sydekyks.quill.models import QuillChatMessage, QuillProposal, QuillTenantSettings


def quill_activated(db: Session, tenant_id: uuid.UUID, sydekyk_id: uuid.UUID) -> bool:
    return (
        db.query(SydekykInstall)
        .filter(SydekykInstall.tenant_id == tenant_id, SydekykInstall.sydekyk_id == sydekyk_id)
        .first()
    ) is not None


def compute_insights(db: Session, tenant_id: uuid.UUID, sydekyk_id: uuid.UUID) -> dict:
    props = db.query(QuillProposal).filter(
        QuillProposal.tenant_id == tenant_id, QuillProposal.sydekyk_id == sydekyk_id
    ).all()
    proposals_created = len(props)
    proposals_final = sum(1 for p in props if p.status == "final")

    revisions = (
        db.query(func.count(QuillChatMessage.id))
        .filter(QuillChatMessage.tenant_id == tenant_id, QuillChatMessage.role == "assistant")
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

    cust_counter: Counter = Counter(p.customer_name for p in props if p.customer_name)
    top_customers = [{"label": k, "count": v} for k, v in cust_counter.most_common(6)]

    s = db.query(QuillTenantSettings).filter(QuillTenantSettings.tenant_id == tenant_id).first()
    wage = s.estimated_hourly_wage if s else 45.0
    minutes = s.estimated_minutes_per_proposal if s else 45.0
    save = savings.compute(db, tenant_id, sydekyk_id, count=proposals_created, minutes_each=minutes, hourly_wage=wage)
    save.pop("ai_cost", None)  # we surface the real UsageRecord AI cost below instead
    save["processing_seconds"] = savings.processing_seconds(db, tenant_id, sydekyk_id)

    return {
        "proposals_created": proposals_created,
        "proposals_final": proposals_final,
        "revisions": int(revisions),
        "total_tokens": total_tokens,
        "ai_cost": ai_cost,
        "top_customers": top_customers,
        **save,
    }
