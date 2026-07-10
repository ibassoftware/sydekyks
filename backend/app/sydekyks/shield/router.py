from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.deps import require_tenant_member
from app.db.session import get_db
from app.models.sydekyk import Sydekyk
from app.models.user import User
from app.services import bill_poll, permissions

from app.sydekyks.shield import insights as insights_svc
from app.sydekyks.shield import readiness as readiness_svc
from app.sydekyks.shield.models import ShieldFinding, ShieldSuppression, ShieldTenantSettings
from app.sydekyks.shield.playbook import PLAYBOOK_KEY, PLAYBOOK_STEPS
from app.sydekyks.shield.schemas import (
    AlertDecisionIn,
    RunNowOut,
    ShieldInsightsOut,
    ShieldPlaybook,
    ShieldReadiness,
    ShieldSettingsOut,
    ShieldSettingsUpdate,
)

router = APIRouter(prefix="/api/tenant/shield", tags=["shield"], dependencies=[Depends(require_tenant_member)])


def _shield(db: Session, user: User) -> Sydekyk:
    sydekyk = (
        db.query(Sydekyk)
        .filter(Sydekyk.slug == "shield", Sydekyk.is_published.is_(True),
                or_(Sydekyk.tenant_id.is_(None), Sydekyk.tenant_id == user.tenant_id))
        .first()
    )
    if sydekyk is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shield Sydekyk not found")
    return sydekyk


def _settings(db: Session, tenant_id) -> ShieldTenantSettings:
    s = db.query(ShieldTenantSettings).filter(ShieldTenantSettings.tenant_id == tenant_id).first()
    if s is None:
        s = ShieldTenantSettings(tenant_id=tenant_id)
        db.add(s)
        db.commit()
        db.refresh(s)
    return s


def _settings_out(s: ShieldTenantSettings) -> ShieldSettingsOut:
    return ShieldSettingsOut(
        recent_change_days=s.recent_change_days, high_amount_threshold=s.high_amount_threshold,
        flag_threshold=s.flag_threshold, estimated_hourly_wage=s.estimated_hourly_wage,
        estimated_minutes_per_review=s.estimated_minutes_per_review, cron_enabled=s.cron_enabled,
        cron_poll_limit=s.cron_poll_limit, cron_days_back=s.cron_days_back,
    )


@router.get("/settings", response_model=ShieldSettingsOut)
def get_settings(user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    return _settings_out(_settings(db, user.tenant_id))


@router.put("/settings", response_model=ShieldSettingsOut)
def update_settings(payload: ShieldSettingsUpdate, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    permissions.assert_can_configure(db, user, _shield(db, user).id)
    s = _settings(db, user.tenant_id)
    s.recent_change_days = payload.recent_change_days
    s.high_amount_threshold = payload.high_amount_threshold
    s.flag_threshold = payload.flag_threshold
    s.estimated_hourly_wage = payload.estimated_hourly_wage
    s.estimated_minutes_per_review = payload.estimated_minutes_per_review
    s.cron_enabled = payload.cron_enabled
    s.cron_poll_limit = payload.cron_poll_limit
    s.cron_days_back = payload.cron_days_back
    db.commit()
    db.refresh(s)
    return _settings_out(s)


@router.get("/readiness", response_model=ShieldReadiness)
def get_readiness(user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    sydekyk = _shield(db, user)
    return ShieldReadiness(**readiness_svc.compute_readiness(db, user.tenant_id, sydekyk.id))


@router.get("/playbook", response_model=ShieldPlaybook)
def get_playbook(user: User = Depends(require_tenant_member)):
    return ShieldPlaybook(playbook_key=PLAYBOOK_KEY, editable=False, steps=PLAYBOOK_STEPS)


@router.get("/insights", response_model=ShieldInsightsOut)
def get_insights(user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    sydekyk = _shield(db, user)
    activated = insights_svc.shield_activated(db, user.tenant_id, sydekyk.id)
    return ShieldInsightsOut(activated=activated, **insights_svc.compute_insights(db, user.tenant_id, sydekyk.id))


@router.post("/run-now", response_model=RunNowOut)
async def run_now(user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    """Scan forward from the last-checked watermark and risk-assess unchecked vendor bills."""
    sydekyk = _shield(db, user)
    permissions.assert_can_use(db, user, sydekyk.id)
    s = _settings(db, user.tenant_id)
    queued, newest = await bill_poll.enqueue_recent_bills(
        db, tenant_id=user.tenant_id, sydekyk_id=sydekyk.id, store_model=ShieldFinding,
        days_back=s.cron_days_back, limit=s.cron_poll_limit, since=s.cron_last_checked_at,
    )
    if newest:
        s.cron_last_checked_at = newest
        db.commit()
    return RunNowOut(queued=queued)


@router.post("/findings/{finding_id}/decision", status_code=status.HTTP_204_NO_CONTENT)
def decide_alert(finding_id, payload: AlertDecisionIn, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    """The learning loop: the auditor adjudicates. 'cleared' (false positive) can suppress a rule for
    that vendor so it stops firing."""
    sydekyk = _shield(db, user)
    permissions.assert_can_use(db, user, sydekyk.id)
    finding = db.get(ShieldFinding, finding_id)
    if finding is None or finding.tenant_id != user.tenant_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Finding not found")
    finding.human_decision = payload.decision
    finding.decided_by = user.email
    finding.decided_at = datetime.now(timezone.utc)
    if payload.decision == "cleared" and payload.rule_code and finding.partner_id:
        db.add(ShieldSuppression(
            tenant_id=user.tenant_id, sydekyk_id=sydekyk.id, partner_id=finding.partner_id,
            rule_code=payload.rule_code, note="Cleared as a false positive", created_by=user.email,
        ))
    db.commit()
