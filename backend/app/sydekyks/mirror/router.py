import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.deps import require_tenant_member
from app.db.session import get_db
from app.models.sydekyk import Sydekyk
from app.models.user import User
from app.services import bill_poll, permissions

from app.sydekyks.mirror import insights as insights_svc
from app.sydekyks.mirror import readiness as readiness_svc
from app.sydekyks.mirror.models import MirrorFinding, MirrorRecurringPattern, MirrorTenantSettings
from app.sydekyks.mirror.playbook import PLAYBOOK_KEY, PLAYBOOK_STEPS
from app.sydekyks.mirror.schemas import (
    FindingDecisionIn,
    MirrorInsightsOut,
    MirrorPlaybook,
    MirrorReadiness,
    MirrorSettingsOut,
    MirrorSettingsUpdate,
    RecurringPatternIn,
    RecurringPatternOut,
    RunNowOut,
)

router = APIRouter(prefix="/api/tenant/mirror", tags=["mirror"], dependencies=[Depends(require_tenant_member)])


def _mirror(db: Session, user: User) -> Sydekyk:
    sydekyk = (
        db.query(Sydekyk)
        .filter(Sydekyk.slug == "mirror", Sydekyk.is_published.is_(True),
                or_(Sydekyk.tenant_id.is_(None), Sydekyk.tenant_id == user.tenant_id))
        .first()
    )
    if sydekyk is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Mirror Sydekyk not found")
    return sydekyk


def _settings(db: Session, tenant_id) -> MirrorTenantSettings:
    s = db.query(MirrorTenantSettings).filter(MirrorTenantSettings.tenant_id == tenant_id).first()
    if s is None:
        s = MirrorTenantSettings(tenant_id=tenant_id)
        db.add(s)
        db.commit()
        db.refresh(s)
    return s


def _settings_out(s: MirrorTenantSettings) -> MirrorSettingsOut:
    return MirrorSettingsOut(
        date_window_days=s.date_window_days, include_drafts=s.include_drafts, flag_threshold=s.flag_threshold,
        estimated_hourly_wage=s.estimated_hourly_wage, estimated_minutes_per_review=s.estimated_minutes_per_review,
        cron_enabled=s.cron_enabled, cron_poll_limit=s.cron_poll_limit, cron_days_back=s.cron_days_back,
    )


def _states(s: MirrorTenantSettings) -> list[str]:
    return ["draft", "posted"] if s.include_drafts else ["posted"]


@router.get("/settings", response_model=MirrorSettingsOut)
def get_settings(user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    return _settings_out(_settings(db, user.tenant_id))


@router.put("/settings", response_model=MirrorSettingsOut)
def update_settings(payload: MirrorSettingsUpdate, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    permissions.assert_can_configure(db, user, _mirror(db, user).id)
    s = _settings(db, user.tenant_id)
    s.date_window_days = payload.date_window_days
    s.include_drafts = payload.include_drafts
    s.flag_threshold = payload.flag_threshold
    s.estimated_hourly_wage = payload.estimated_hourly_wage
    s.estimated_minutes_per_review = payload.estimated_minutes_per_review
    s.cron_enabled = payload.cron_enabled
    s.cron_poll_limit = payload.cron_poll_limit
    s.cron_days_back = payload.cron_days_back
    db.commit()
    db.refresh(s)
    return _settings_out(s)


@router.get("/readiness", response_model=MirrorReadiness)
def get_readiness(user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    sydekyk = _mirror(db, user)
    return MirrorReadiness(**readiness_svc.compute_readiness(db, user.tenant_id, sydekyk.id))


@router.get("/playbook", response_model=MirrorPlaybook)
def get_playbook(user: User = Depends(require_tenant_member)):
    return MirrorPlaybook(playbook_key=PLAYBOOK_KEY, editable=False, steps=PLAYBOOK_STEPS)


@router.get("/insights", response_model=MirrorInsightsOut)
def get_insights(user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    sydekyk = _mirror(db, user)
    activated = insights_svc.mirror_activated(db, user.tenant_id, sydekyk.id)
    return MirrorInsightsOut(activated=activated, **insights_svc.compute_insights(db, user.tenant_id, sydekyk.id))


@router.post("/run-now", response_model=RunNowOut)
async def run_now(user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    """Scan forward from the last-checked watermark for unchecked vendor bills (≤5 days, ≤30)."""
    sydekyk = _mirror(db, user)
    permissions.assert_can_use(db, user, sydekyk.id)
    s = _settings(db, user.tenant_id)
    queued, newest = await bill_poll.enqueue_recent_bills(
        db, tenant_id=user.tenant_id, sydekyk_id=sydekyk.id, store_model=MirrorFinding,
        days_back=s.cron_days_back, limit=s.cron_poll_limit, since=s.cron_last_checked_at, states=_states(s),
    )
    if newest:
        s.cron_last_checked_at = newest
        db.commit()
    return RunNowOut(queued=queued)


# --- Suppression memory (recurring/whitelist) --------------------------------------------------


@router.get("/recurring", response_model=list[RecurringPatternOut])
def list_recurring(user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    sydekyk = _mirror(db, user)
    rows = (
        db.query(MirrorRecurringPattern)
        .filter(MirrorRecurringPattern.tenant_id == user.tenant_id, MirrorRecurringPattern.sydekyk_id == sydekyk.id)
        .order_by(MirrorRecurringPattern.created_at.desc())
        .all()
    )
    return [RecurringPatternOut.model_validate(r, from_attributes=True) for r in rows]


@router.post("/recurring", response_model=RecurringPatternOut, status_code=status.HTTP_201_CREATED)
def add_recurring(payload: RecurringPatternIn, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    sydekyk = _mirror(db, user)
    permissions.assert_can_configure(db, user, sydekyk.id)
    row = MirrorRecurringPattern(
        tenant_id=user.tenant_id, sydekyk_id=sydekyk.id, partner_id=payload.partner_id,
        vendor_name=payload.vendor_name, amount=payload.amount, note=payload.note, created_by=user.email,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return RecurringPatternOut.model_validate(row, from_attributes=True)


@router.delete("/recurring/{pattern_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_recurring(pattern_id: uuid.UUID, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    sydekyk = _mirror(db, user)
    permissions.assert_can_configure(db, user, sydekyk.id)
    row = db.get(MirrorRecurringPattern, pattern_id)
    if row and row.tenant_id == user.tenant_id:
        db.delete(row)
        db.commit()


@router.post("/findings/{finding_id}/decision", status_code=status.HTTP_204_NO_CONTENT)
def decide_finding(finding_id: uuid.UUID, payload: FindingDecisionIn, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    """The learning loop: a clerk confirms/dismisses a flag. 'recurring' also whitelists the vendor+
    amount so future identical bills are checked but never flagged."""
    sydekyk = _mirror(db, user)
    permissions.assert_can_use(db, user, sydekyk.id)
    finding = db.get(MirrorFinding, finding_id)
    if finding is None or finding.tenant_id != user.tenant_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Finding not found")
    finding.human_decision = payload.decision
    finding.decided_by = user.email
    finding.decided_at = datetime.now(timezone.utc)
    if payload.decision == "recurring" and finding.partner_id:
        db.add(MirrorRecurringPattern(
            tenant_id=user.tenant_id, sydekyk_id=sydekyk.id, partner_id=finding.partner_id,
            vendor_name=finding.vendor_name, amount=finding.amount,
            note="Marked recurring from a flagged bill", created_by=user.email,
        ))
    db.commit()
