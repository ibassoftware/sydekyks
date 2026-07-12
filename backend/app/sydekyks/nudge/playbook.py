"""Nudge's follow-up playbook — registered under 'nudge.followup'.

Works ONE open opportunity (id in `mission.trigger_context`). The cron does the catching
(deterministic per-stage staleness); this playbook confirms the opp is genuinely stale, respects the
snooze/whitelist memory and the cadence guard, then has the AI draft a context-aware follow-up
grounded in the real last exchange. Definition of done: a `mail.activity` (the next touch) exists on
the opp assigned to its salesperson, the suggested body is logged to the opp's chatter for the rep to
edit and send, and a NudgeFinding tags this cycle so the cron skips the opp until it goes stale again.
Nudge never sends on the rep's behalf — it drafts.
"""

from datetime import date, datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.core.crypto import decrypt_secret
from app.models.mission import Mission
from app.services import gadget_links, mission_ai, odoo, odoo_activity, odoo_crm, usage_guard
from app.services.missions import record_step, register_playbook

from app.sydekyks.nudge import extraction, scoring
from app.sydekyks.nudge.models import NudgeFinding, NudgeSnooze, NudgeTenantSettings

PLAYBOOK_KEY = "nudge.followup"

PLAYBOOK_STEPS = [
    {"key": "connect_odoo", "title": "Connect to Odoo",
     "description": "Open an authenticated session to the assigned Odoo instance.",
     "likely_failures": "No Odoo assigned, wrong credentials, or Odoo unreachable."},
    {"key": "load_opp", "title": "Load the opportunity",
     "description": "Read the opportunity, its stage, salesperson, and recent thread.",
     "likely_failures": "The opportunity was deleted, won, or lost."},
    {"key": "check_guards", "title": "Check snooze & cadence",
     "description": "Skip paused/whitelisted deals, ones already nudged this cycle, and ones with a future touch scheduled.",
     "likely_failures": "None fatal — a guarded opp is skipped cleanly."},
    {"key": "measure_staleness", "title": "Measure silence",
     "description": "Compute days since the last real touch and compare against the stage's tolerance.",
     "likely_failures": "None fatal — a fresh opp needs no nudge."},
    {"key": "draft", "title": "Draft the follow-up",
     "description": "AI drafts a follow-up that references the last exchange and fits the stage.",
     "likely_failures": "No AI engine configured — falls back to a plain reminder."},
    {"key": "record", "title": "Create the nudge",
     "description": "Create a follow-up To-Do for the salesperson and log the suggested message to chatter.",
     "likely_failures": "Best-effort writes to Odoo."},
]


def _finish(db, mission, status, summary, error=None, failure_category=None):
    mission.status = status
    mission.result_summary = summary
    mission.error_message = error
    mission.failure_category = failure_category if status == "failed" else None
    mission.completed_at = datetime.now(timezone.utc)
    db.commit()


def _settings(db, tenant_id) -> NudgeTenantSettings:
    s = db.query(NudgeTenantSettings).filter(NudgeTenantSettings.tenant_id == tenant_id).first()
    if s is None:
        s = NudgeTenantSettings(tenant_id=tenant_id)
        db.add(s)
        db.commit()
        db.refresh(s)
    return s


def _rel(v) -> tuple[int | None, str | None]:
    """Unpack an Odoo many2one [id, name]."""
    if isinstance(v, list) and v:
        return v[0], (v[1] if len(v) > 1 else None)
    return None, None


def _is_snoozed(db, mission, lead_id: int, today: date) -> bool:
    row = (
        db.query(NudgeSnooze)
        .filter(
            NudgeSnooze.tenant_id == mission.tenant_id,
            NudgeSnooze.sydekyk_id == mission.sydekyk_id,
            NudgeSnooze.odoo_lead_id == lead_id,
        )
        .order_by(NudgeSnooze.created_at.desc())
        .first()
    )
    if row is None:
        return False
    return row.snooze_until is None or row.snooze_until >= today  # None = never nudge


def _nudged_within_cadence(db, mission, lead_id: int, cadence_days: int) -> bool:
    # Any finding = a nudge we already drafted (to a To-Do and/or the chatter) — respect the cadence
    # regardless of whether a salesperson was set to receive the activity.
    since = datetime.now(timezone.utc) - timedelta(days=max(1, cadence_days))
    return (
        db.query(NudgeFinding.id)
        .filter(
            NudgeFinding.tenant_id == mission.tenant_id,
            NudgeFinding.sydekyk_id == mission.sydekyk_id,
            NudgeFinding.odoo_lead_id == lead_id,
            NudgeFinding.created_at >= since,
        )
        .first()
        is not None
    )


def _draft_note(draft: dict | None, days_stale: int, overdue: bool) -> str:
    head = "<p><b>Nudge — suggested follow-up.</b> " + (
        f"This opportunity has been silent for {days_stale} days." if days_stale else "This opportunity is due for a touch."
    ) + "</p>"
    if overdue:
        head += "<p>An activity on this opp is already <b>overdue</b> — Nudge did not create a duplicate; please action the existing one.</p>"
    if not draft or not draft.get("body"):
        return head + "<p>Reach out to move this deal forward, referencing your last exchange.</p>"
    body_html = draft["body"].replace("\n", "<br/>")
    out = head + f"<p><b>Subject:</b> {draft.get('subject') or 'Following up'}</p><p>{body_html}</p>"
    if draft.get("reasoning"):
        out += f"<p><i>Why now: {draft['reasoning']}</i></p>"
    out += "<p><i>Draft only — edit and send from your side.</i></p>"
    return out


def run(db: Session, mission: Mission) -> None:
    idx = 0
    ctx = mission.trigger_context or {}
    lead_id = ctx.get("odoo_lead_id")
    settings = _settings(db, mission.tenant_id)
    today = date.today()

    if not lead_id:
        record_step(db, mission, idx, "load_opp", "internal", "failed", error="No target opportunity supplied")
        _finish(db, mission, "failed", {}, "No target opportunity supplied", failure_category="validation")
        return

    link = gadget_links.find_assigned_link(db, tenant_id=mission.tenant_id, sydekyk_id=mission.sydekyk_id, role_key="erp")
    if link is None:
        record_step(db, mission, idx, "connect_odoo", "gadget_call", "failed", error="No Odoo instance assigned to Nudge.")
        _finish(db, mission, "failed", {}, "No Odoo instance assigned", failure_category="setup")
        return
    ok, msg, client = odoo.connect(link.url, link.database, link.username, decrypt_secret(link.encrypted_secret))
    if not ok or client is None:
        record_step(db, mission, idx, "connect_odoo", "gadget_call", "failed", error=msg)
        _finish(db, mission, "failed", {}, msg, failure_category="external")
        return
    record_step(db, mission, idx, "connect_odoo", "gadget_call", "succeeded", output={"instance": link.name})
    idx += 1

    try:
        lead = odoo_crm.read_lead(client, int(lead_id))
        if lead is None or lead.get("type") != "opportunity" or not lead.get("active"):
            record_step(db, mission, idx, "load_opp", "gadget_call", "failed", error="Not an open opportunity")
            _finish(db, mission, "failed", {}, "Not an open opportunity", failure_category="validation")
            return
        stage_id, stage_name = _rel(lead.get("stage_id"))
        sp_id, sp_name = _rel(lead.get("user_id"))
        _pid, partner_name = _rel(lead.get("partner_id"))
        partner_name = partner_name or lead.get("partner_name") or lead.get("contact_name")
        currency = _rel(lead.get("currency_id"))[1] if lead.get("currency_id") else None
        expected_revenue = round(float(lead.get("expected_revenue") or 0.0), 2)
        record_step(db, mission, idx, "load_opp", "gadget_call", "succeeded",
                    output={"name": lead.get("name"), "stage": stage_name, "salesperson": sp_name})
        idx += 1

        # --- Guards: snooze/whitelist, cadence, and an already-scheduled future touch --------------
        if _is_snoozed(db, mission, int(lead_id), today):
            record_step(db, mission, idx, "check_guards", "internal", "succeeded", output={"skipped": "snoozed"})
            _finish(db, mission, "succeeded", {"odoo_lead_id": int(lead_id), "skipped": "snoozed",
                                               "opp_name": lead.get("name")})
            return
        if _nudged_within_cadence(db, mission, int(lead_id), settings.cadence_days):
            record_step(db, mission, idx, "check_guards", "internal", "succeeded", output={"skipped": "cadence"})
            _finish(db, mission, "succeeded", {"odoo_lead_id": int(lead_id), "skipped": "cadence",
                                               "opp_name": lead.get("name")})
            return
        if odoo_crm.has_future_activity(client, int(lead_id)):
            # A future-dated activity is an implicit "handled" — the rep already planned the next touch.
            record_step(db, mission, idx, "check_guards", "internal", "succeeded", output={"skipped": "future_activity"})
            _finish(db, mission, "succeeded", {"odoo_lead_id": int(lead_id), "skipped": "future_activity",
                                               "opp_name": lead.get("name")})
            return
        record_step(db, mission, idx, "check_guards", "internal", "succeeded", output={"skipped": None})
        idx += 1

        # --- Staleness: days silent vs this stage's tolerance --------------------------------------
        last_touch = odoo_crm.last_touch_date(client, lead)
        days_stale = (today - last_touch).days if last_touch else 999
        threshold = scoring.stage_threshold(settings.stage_thresholds, settings.default_stale_days, stage_id)
        overdue = odoo_crm.has_overdue_activity(client, int(lead_id))
        if not scoring.is_stale(days_stale, threshold):
            record_step(db, mission, idx, "measure_staleness", "internal", "succeeded",
                        output={"days_stale": days_stale, "threshold": threshold, "stale": False})
            _finish(db, mission, "succeeded", {"odoo_lead_id": int(lead_id), "opp_name": lead.get("name"),
                                               "days_stale": days_stale, "threshold": threshold, "stale": False})
            return
        silence = scoring.silence_score(days_stale, threshold)
        at_risk = scoring.value_at_risk(expected_revenue, days_stale, threshold)
        record_step(db, mission, idx, "measure_staleness", "internal", "succeeded",
                    output={"days_stale": days_stale, "threshold": threshold, "silence_score": silence,
                            "value_at_risk": at_risk, "overdue": overdue})
        idx += 1

        # --- Draft: AI writes the follow-up grounded in the real thread ----------------------------
        draft = None
        thread = odoo_crm.read_thread(client, int(lead_id))
        llm, virtual_key, model_alias = mission_ai.get_llm(db, mission)
        if llm is not None:
            allowed, _deny = usage_guard.check_allowed(db, mission.tenant_id, mission.sydekyk_id, model_alias)
            if allowed:
                ok_ai, _m, draft, meta = extraction.draft_followup(
                    virtual_key, model_alias, name=lead.get("name"), stage=stage_name,
                    contact=partner_name, days_stale=days_stale, thread=thread,
                )
                mission_ai.emit_usage(db, mission, llm, meta)
        record_step(db, mission, idx, "draft", "internal", "succeeded",
                    output={"drafted": bool(draft and draft.get("body")), "ai": llm is not None})
        idx += 1

        # --- Record: create the follow-up To-Do + log the suggested message ------------------------
        activity_created = False
        note = _draft_note(draft, days_stale, overdue)
        if sp_id and not overdue:
            summary = f"Follow up: {lead.get('name') or 'opportunity'} — silent {days_stale}d"
            act_id = odoo_activity.create_activity(
                client, model="crm.lead", res_id=int(lead_id), user_id=sp_id,
                summary=summary, note=note, days=settings.activity_days,
            )
            activity_created = act_id is not None
        # Always log the suggested body to chatter so the rep can lift it even if there's an overdue one.
        odoo_crm.post_note(client, int(lead_id), note)

        db.add(NudgeFinding(
            tenant_id=mission.tenant_id, sydekyk_id=mission.sydekyk_id, mission_id=mission.id,
            odoo_lead_id=int(lead_id), opp_name=lead.get("name"), partner_name=partner_name,
            salesperson=sp_name, stage_name=stage_name, expected_revenue=expected_revenue, currency=currency,
            days_stale=days_stale, silence_score=silence, value_at_risk=at_risk, overdue=overdue,
            activity_created=activity_created, draft_body=(draft or {}).get("body") if draft else None,
        ))
        record_step(db, mission, idx, "record", "gadget_call", "succeeded",
                    output={"activity_created": activity_created, "salesperson": sp_name})
        idx += 1

        _finish(db, mission, "succeeded", {
            "odoo_lead_id": int(lead_id), "opp_name": lead.get("name"), "partner_name": partner_name,
            "salesperson": sp_name, "stage_name": stage_name, "expected_revenue": expected_revenue,
            "currency": currency, "days_stale": days_stale, "silence_score": silence,
            "value_at_risk": at_risk, "overdue": overdue, "activity_created": activity_created,
            "draft_subject": (draft or {}).get("subject") if draft else None,
            "review_reason": f"Silent {days_stale}d in {stage_name or 'stage'} — follow-up drafted.",
        })
    except odoo.OdooError as exc:
        record_step(db, mission, idx, "odoo_error", "gadget_call", "failed", error=str(exc))
        _finish(db, mission, "failed", {"opp_name": None}, str(exc), failure_category="external")


register_playbook(PLAYBOOK_KEY, run)
