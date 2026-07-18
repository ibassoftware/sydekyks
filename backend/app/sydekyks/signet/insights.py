"""Signet dashboard - a coverage/throughput view. Leads with the completion rate and the median
time-to-signature (the wow metric - how fast a document gets signed vs chasing it by hand), then what's
still in flight and at risk (overdue and unsigned). Savings = documents signed × manual-chase-minutes.
"""

import uuid

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.sydekyk import SydekykInstall
from app.services import savings
from app.sydekyks.signet.models import SignetEnvelope, SignetEvent, SignetSigner, SignetTenantSettings


def signet_activated(db: Session, tenant_id: uuid.UUID, sydekyk_id: uuid.UUID) -> bool:
    return (
        db.query(SydekykInstall)
        .filter(SydekykInstall.tenant_id == tenant_id, SydekykInstall.sydekyk_id == sydekyk_id)
        .first()
    ) is not None


def compute_insights(db: Session, tenant_id: uuid.UUID, sydekyk_id: uuid.UUID) -> dict:
    envelopes = db.query(SignetEnvelope).filter(
        SignetEnvelope.tenant_id == tenant_id, SignetEnvelope.sydekyk_id == sydekyk_id
    ).all()
    sent_statuses = {"sent", "partially_signed", "completed", "declined", "voided", "expired"}
    envelopes_sent = sum(1 for e in envelopes if e.status in sent_statuses)
    completed = sum(1 for e in envelopes if e.status == "completed")
    in_flight = [e for e in envelopes if e.status in ("sent", "partially_signed")]
    pending = len(in_flight)
    completion_rate = round(completed / envelopes_sent, 3) if envelopes_sent else 0.0

    from datetime import datetime, timezone

    now = datetime.now(timezone.utc)
    at_risk = sum(1 for e in in_flight if e.expires_at is not None and e.expires_at <= now) + sum(
        1 for e in in_flight
        if e.sent_at is not None and (now - e.sent_at).days >= max(1, e.reminder_interval_days) and not e.hold
    )

    reminders_sent = (
        db.query(func.count(SignetEvent.id))
        .filter(SignetEvent.tenant_id == tenant_id, SignetEvent.event_type == "reminded")
        .scalar()
    ) or 0

    # Median hours from sent to signed across completed envelopes.
    durations: list[float] = []
    for e in envelopes:
        if e.status == "completed" and e.sent_at and e.completed_at:
            durations.append((e.completed_at - e.sent_at).total_seconds() / 3600.0)
    median_hours = None
    if durations:
        durations.sort()
        mid = len(durations) // 2
        median_hours = round(
            durations[mid] if len(durations) % 2 else (durations[mid - 1] + durations[mid]) / 2, 1
        )

    signatures = (
        db.query(func.count(SignetSigner.id))
        .filter(SignetSigner.tenant_id == tenant_id, SignetSigner.status == "signed")
        .scalar()
    ) or 0

    s = db.query(SignetTenantSettings).filter(SignetTenantSettings.tenant_id == tenant_id).first()
    wage = s.estimated_hourly_wage if s else 45.0
    minutes = s.estimated_minutes_per_signature if s else 25.0
    save = savings.compute(db, tenant_id, sydekyk_id, count=int(signatures), minutes_each=minutes, hourly_wage=wage)
    save.pop("ai_cost", None)
    save["processing_seconds"] = savings.processing_seconds(db, tenant_id, sydekyk_id)

    return {
        "envelopes_sent": envelopes_sent,
        "completed": completed,
        "completion_rate": completion_rate,
        "pending": pending,
        "at_risk": at_risk,
        "reminders_sent": int(reminders_sent),
        "median_hours_to_sign": median_hours,
        **save,
    }
