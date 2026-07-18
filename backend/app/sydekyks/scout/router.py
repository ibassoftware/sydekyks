from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.deps import require_tenant_member
from app.db.session import get_db
from app.models.sydekyk import Sydekyk
from app.models.user import User
from app.services import permissions, recruitment_poll

from app.sydekyks.scout import insights as insights_svc
from app.sydekyks.scout import readiness as readiness_svc
from app.sydekyks.scout.models import ScoutTenantSettings
from app.sydekyks.scout.playbook import PLAYBOOK_KEY, PLAYBOOK_STEPS
from app.sydekyks.scout.schemas import (
    RunNowOut,
    ScoutInsightsOut,
    ScoutPlaybook,
    ScoutReadiness,
    ScoutSettingsOut,
    ScoutSettingsUpdate,
)

router = APIRouter(prefix="/api/tenant/scout", tags=["scout"], dependencies=[Depends(require_tenant_member)])


def _scout_sydekyk(db: Session, user: User) -> Sydekyk:
    sydekyk = (
        db.query(Sydekyk)
        .filter(
            Sydekyk.slug == "scout",
            Sydekyk.is_published.is_(True),
            or_(Sydekyk.tenant_id.is_(None), Sydekyk.tenant_id == user.tenant_id),
        )
        .first()
    )
    if sydekyk is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scout Sydekyk not found")
    return sydekyk


def _settings(db: Session, tenant_id) -> ScoutTenantSettings:
    s = db.query(ScoutTenantSettings).filter(ScoutTenantSettings.tenant_id == tenant_id).first()
    if s is None:
        s = ScoutTenantSettings(tenant_id=tenant_id)
        db.add(s)
        db.commit()
        db.refresh(s)
    return s


def _settings_out(s: ScoutTenantSettings) -> ScoutSettingsOut:
    return ScoutSettingsOut(
        processed_tag_name=s.processed_tag_name, estimated_hourly_wage=s.estimated_hourly_wage,
        estimated_minutes_per_candidate=s.estimated_minutes_per_candidate,
        cron_enabled=s.cron_enabled, cron_poll_limit=s.cron_poll_limit,
    )


@router.get("/settings", response_model=ScoutSettingsOut)
def get_settings(user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    return _settings_out(_settings(db, user.tenant_id))


@router.put("/settings", response_model=ScoutSettingsOut)
def update_settings(payload: ScoutSettingsUpdate, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    permissions.assert_can_configure(db, user, _scout_sydekyk(db, user).id)
    s = _settings(db, user.tenant_id)
    s.processed_tag_name = payload.processed_tag_name
    s.estimated_hourly_wage = payload.estimated_hourly_wage
    s.estimated_minutes_per_candidate = payload.estimated_minutes_per_candidate
    s.cron_enabled = payload.cron_enabled
    s.cron_poll_limit = payload.cron_poll_limit
    db.commit()
    db.refresh(s)
    return _settings_out(s)


@router.get("/insights", response_model=ScoutInsightsOut)
def get_insights(user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    sydekyk = _scout_sydekyk(db, user)
    activated = insights_svc.scout_activated(db, user.tenant_id, sydekyk.id)
    return ScoutInsightsOut(activated=activated, **insights_svc.compute_insights(db, user.tenant_id, sydekyk.id))


@router.get("/readiness", response_model=ScoutReadiness)
def get_readiness(user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    sydekyk = _scout_sydekyk(db, user)
    return ScoutReadiness(**readiness_svc.compute_readiness(db, user.tenant_id, sydekyk.id))


@router.get("/playbook", response_model=ScoutPlaybook)
def get_playbook(user: User = Depends(require_tenant_member)):
    return ScoutPlaybook(playbook_key=PLAYBOOK_KEY, editable=False, steps=PLAYBOOK_STEPS)


@router.post("/run-now", response_model=RunNowOut)
async def run_now(user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    """Manual trigger: enqueue a scoring Mission for every applicant not yet scored (unprocessed
    only, ≤30) - the same routine the cron runs, on demand."""
    sydekyk = _scout_sydekyk(db, user)
    permissions.assert_can_use(db, user, sydekyk.id)
    s = _settings(db, user.tenant_id)
    queued = await recruitment_poll.enqueue_untagged_applicants(
        db, tenant_id=user.tenant_id, sydekyk_id=sydekyk.id, tag_name=s.processed_tag_name,
        limit=s.cron_poll_limit, require_job=True,  # Scout scores against the job - skip unassigned applicants
    )
    return RunNowOut(queued=queued)
