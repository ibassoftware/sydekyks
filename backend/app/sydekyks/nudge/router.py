import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.crypto import decrypt_secret
from app.core.deps import require_tenant_member
from app.db.session import get_db
from app.models.sydekyk import Sydekyk
from app.models.user import User
from app.services import gadget_links, lead_poll, mission_events, odoo, odoo_crm, permissions
from app.services.missions import create_mission

from app.sydekyks.nudge import insights as insights_svc
from app.sydekyks.nudge import readiness as readiness_svc
from app.sydekyks.nudge.models import NudgeFinding, NudgeSnooze, NudgeTenantSettings
from app.sydekyks.nudge.playbook import PLAYBOOK_KEY, PLAYBOOK_STEPS
from app.sydekyks.nudge.schemas import (
    NudgeDecisionIn,
    NudgeInsightsOut,
    NudgePlaybook,
    NudgeQueuePage,
    NudgeReadiness,
    NudgeSettingsOut,
    NudgeSettingsUpdate,
    OpportunityOut,
    RunNowOut,
    SnoozeIn,
    SnoozeOut,
    StageOut,
    StageThreshold,
)

router = APIRouter(prefix="/api/tenant/nudge", tags=["nudge"], dependencies=[Depends(require_tenant_member)])


def _nudge(db: Session, user: User) -> Sydekyk:
    sydekyk = (
        db.query(Sydekyk)
        .filter(Sydekyk.slug == "nudge", Sydekyk.is_published.is_(True),
                or_(Sydekyk.tenant_id.is_(None), Sydekyk.tenant_id == user.tenant_id))
        .first()
    )
    if sydekyk is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nudge Sydekyk not found")
    return sydekyk


def _settings(db: Session, tenant_id) -> NudgeTenantSettings:
    s = db.query(NudgeTenantSettings).filter(NudgeTenantSettings.tenant_id == tenant_id).first()
    if s is None:
        s = NudgeTenantSettings(tenant_id=tenant_id)
        db.add(s)
        db.commit()
        db.refresh(s)
    return s


def _thresholds_out(s: NudgeTenantSettings) -> list[StageThreshold]:
    raw = s.stage_thresholds or {}
    out = []
    for k, v in raw.items():
        try:
            out.append(StageThreshold(stage_id=int(k), days=int(v)))
        except (TypeError, ValueError):
            continue
    return out


def _settings_out(s: NudgeTenantSettings) -> NudgeSettingsOut:
    now = datetime.now(timezone.utc)
    candidates = [now.replace(minute=minute, second=0, microsecond=0) for minute in (12, 42)]
    next_run = next((candidate for candidate in candidates if candidate > now), None)
    if next_run is None:
        next_run = (now + timedelta(hours=1)).replace(minute=12, second=0, microsecond=0)
    return NudgeSettingsOut(
        default_stale_days=s.default_stale_days, stage_thresholds=_thresholds_out(s),
        cadence_days=s.cadence_days, activity_days=s.activity_days,
        estimated_hourly_wage=s.estimated_hourly_wage,
        estimated_minutes_per_followup=s.estimated_minutes_per_followup,
        cron_enabled=s.cron_enabled, cron_poll_limit=s.cron_poll_limit,
        cron_schedule_label="Twice an hour, at :12 and :42",
        cron_next_run_at=next_run.isoformat() if s.cron_enabled else None,
        cron_last_checked_at=s.cron_last_checked_at,
        skip_tag_name=s.skip_tag_name,
    )


def _connect(db: Session, tenant_id, sydekyk_id):
    link = gadget_links.find_assigned_link(db, tenant_id=tenant_id, sydekyk_id=sydekyk_id, role_key="erp")
    if link is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="No Odoo instance assigned to Nudge")
    ok, msg, client = odoo.connect(link.url, link.database, link.username, decrypt_secret(link.encrypted_secret))
    if not ok or client is None:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=msg or "Odoo connection failed")
    return client


@router.get("/settings", response_model=NudgeSettingsOut)
def get_settings(user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    return _settings_out(_settings(db, user.tenant_id))


@router.put("/settings", response_model=NudgeSettingsOut)
def update_settings(payload: NudgeSettingsUpdate, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    permissions.assert_can_configure(db, user, _nudge(db, user).id)
    s = _settings(db, user.tenant_id)
    s.default_stale_days = payload.default_stale_days
    s.stage_thresholds = {str(t.stage_id): t.days for t in payload.stage_thresholds} or None
    s.cadence_days = payload.cadence_days
    s.activity_days = payload.activity_days
    s.estimated_hourly_wage = payload.estimated_hourly_wage
    s.estimated_minutes_per_followup = payload.estimated_minutes_per_followup
    s.cron_enabled = payload.cron_enabled
    s.cron_poll_limit = payload.cron_poll_limit
    s.skip_tag_name = payload.skip_tag_name.strip()
    db.commit()
    db.refresh(s)
    return _settings_out(s)


@router.get("/stages", response_model=list[StageOut])
def get_stages(user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    """Live CRM stages, so the settings UI can set a per-stage silence threshold on each."""
    client = _connect(db, user.tenant_id, _nudge(db, user).id)
    try:
        stages = odoo_crm.list_stages(client)
    except odoo.OdooError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))
    stages.sort(key=lambda s: s.get("sequence") or 0)
    return [StageOut(id=s["id"], name=s.get("name"), is_won=bool(s.get("is_won"))) for s in stages]


@router.get("/opportunities", response_model=list[OpportunityOut])
def search_opportunities(q: str = "", user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    """Search open Odoo opportunities so the 'pause a deal' picker chooses from real records."""
    client = _connect(db, user.tenant_id, _nudge(db, user).id)

    def _rel(v):
        return v[1] if isinstance(v, list) and len(v) > 1 else None

    try:
        rows = odoo_crm.search_opportunities(client, query=q.strip() or None, won_ids=odoo_crm.won_stage_ids(client))
    except odoo.OdooError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))
    return [
        OpportunityOut(
            id=r["id"], name=r.get("name"), partner_name=_rel(r.get("partner_id")),
            stage_name=_rel(r.get("stage_id")), salesperson=_rel(r.get("user_id")),
            expected_revenue=r.get("expected_revenue"),
        )
        for r in rows
    ]


@router.get("/readiness", response_model=NudgeReadiness)
def get_readiness(user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    sydekyk = _nudge(db, user)
    return NudgeReadiness(**readiness_svc.compute_readiness(db, user.tenant_id, sydekyk.id))


@router.get("/playbook", response_model=NudgePlaybook)
def get_playbook(user: User = Depends(require_tenant_member)):
    return NudgePlaybook(playbook_key=PLAYBOOK_KEY, editable=False, steps=PLAYBOOK_STEPS)


@router.get("/insights", response_model=NudgeInsightsOut)
def get_insights(user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    sydekyk = _nudge(db, user)
    activated = insights_svc.nudge_activated(db, user.tenant_id, sydekyk.id)
    return NudgeInsightsOut(activated=activated, **insights_svc.compute_insights(db, user.tenant_id, sydekyk.id))


@router.get("/queue", response_model=NudgeQueuePage)
def get_queue(limit: int = 8, offset: int = 0, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    """Paged follow-up queue - drafted nudges awaiting the rep's send / dismiss."""
    sydekyk = _nudge(db, user)
    limit = max(1, min(limit, 50))
    return NudgeQueuePage(**insights_svc.pending_nudges(db, user.tenant_id, sydekyk.id, limit=limit, offset=max(0, offset)))


@router.post("/run-now", response_model=RunNowOut)
async def run_now(user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    """Scan for stale opportunities now and enqueue a follow-up Mission for each (≤30)."""
    sydekyk = _nudge(db, user)
    permissions.assert_can_use(db, user, sydekyk.id)
    s = _settings(db, user.tenant_id)
    queued, breakdown = await lead_poll.enqueue_stale_opportunities(
        db, tenant_id=user.tenant_id, sydekyk_id=sydekyk.id, store_model=NudgeFinding,
        snooze_model=NudgeSnooze, cadence_days=s.cadence_days, min_stale_days=s.default_stale_days,
        limit=s.cron_poll_limit, skip_tag_name=s.skip_tag_name,
    )
    if breakdown is not None:
        s.last_open_total = breakdown["open_total"]
    s.cron_last_checked_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    db.commit()

    # Always leave a visible "sweep" Mission - the run's receipt - carrying the full disposition of the
    # pipeline so a check accounts for EVERY open opp (handled / recently-nudged / queued), not silence.
    sweep = create_mission(
        db, tenant_id=user.tenant_id, sydekyk=sydekyk, user_id=user.id,
        source="manual", signal_type="manual", trigger_context={"mode": "nudge_sweep"},
    )
    sweep.status = "running"
    sweep.started_at = datetime.now(timezone.utc)
    db.commit()
    mission_events.publish(sweep.id, "mission.started", {"playbook_key": sweep.playbook_key})
    sweep.status = "succeeded"
    sweep.result_summary = {"mode": "nudge_sweep", **(breakdown or {"open_total": 0, "scheduled": 0, "tagged_skip": 0,
                                                                     "snoozed": 0, "recently_nudged": 0,
                                                                     "enqueued": queued})}
    sweep.completed_at = datetime.now(timezone.utc)
    db.commit()
    mission_events.publish(sweep.id, "mission.completed", {"status": "succeeded"})
    return RunNowOut(queued=queued)


@router.post("/findings/{finding_id}/decision", status_code=status.HTTP_204_NO_CONTENT)
def decide_nudge(finding_id: uuid.UUID, payload: NudgeDecisionIn, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    """The learning loop: the rep marks the drafted follow-up sent or dismissed."""
    sydekyk = _nudge(db, user)
    permissions.assert_can_use(db, user, sydekyk.id)
    finding = db.get(NudgeFinding, finding_id)
    if finding is None or finding.tenant_id != user.tenant_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Finding not found")
    finding.human_decision = payload.decision
    finding.decided_by = user.email
    finding.decided_at = datetime.now(timezone.utc)
    db.commit()


# --- Snooze / whitelist memory (paused deals) -------------------------------------------------------

@router.get("/snoozes", response_model=list[SnoozeOut])
def list_snoozes(user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    sydekyk = _nudge(db, user)
    rows = (
        db.query(NudgeSnooze)
        .filter(NudgeSnooze.tenant_id == user.tenant_id, NudgeSnooze.sydekyk_id == sydekyk.id)
        .order_by(NudgeSnooze.created_at.desc())
        .all()
    )
    return [SnoozeOut(id=r.id, odoo_lead_id=r.odoo_lead_id, opp_name=r.opp_name,
                      snooze_until=r.snooze_until, note=r.note, created_by=r.created_by) for r in rows]


@router.post("/snoozes", response_model=SnoozeOut)
def create_snooze(payload: SnoozeIn, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    """Pause a legitimately-quiet deal: `snooze_until=<date>` suppresses nudges until then; omit it to
    never nudge (whitelist). Best-effort reads the opp name for display."""
    sydekyk = _nudge(db, user)
    permissions.assert_can_use(db, user, sydekyk.id)
    opp_name = None
    try:
        client = _connect(db, user.tenant_id, sydekyk.id)
        lead = odoo_crm.read_lead(client, payload.odoo_lead_id, fields=["name"])
        opp_name = (lead or {}).get("name")
    except HTTPException:
        pass  # snooze still records even if Odoo is briefly unreachable
    row = NudgeSnooze(
        tenant_id=user.tenant_id, sydekyk_id=sydekyk.id, odoo_lead_id=payload.odoo_lead_id,
        opp_name=opp_name, snooze_until=payload.snooze_until, note=payload.note, created_by=user.email,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return SnoozeOut(id=row.id, odoo_lead_id=row.odoo_lead_id, opp_name=row.opp_name,
                     snooze_until=row.snooze_until, note=row.note, created_by=row.created_by)


@router.delete("/snoozes/{snooze_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_snooze(snooze_id: uuid.UUID, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    sydekyk = _nudge(db, user)
    permissions.assert_can_use(db, user, sydekyk.id)
    row = db.get(NudgeSnooze, snooze_id)
    if row is None or row.tenant_id != user.tenant_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Snooze not found")
    db.delete(row)
    db.commit()
