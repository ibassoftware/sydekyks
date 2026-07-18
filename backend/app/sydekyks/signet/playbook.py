"""Signet's playbooks - dispatching an envelope's invitations and (optionally) a metered reminder pass.

  - ``signet.dispatch`` - send the signing invitations for an envelope. Deterministic by default; when
                          the envelope is in AI email-copy mode it generates one invitation body via a
                          metered model call (with a template fallback) and personalises the greeting.
  - ``signet.remind``   - a manual "remind now" pass surfaced as a Mission for the activity feed
                          (template reminders, no AI).

The reminder cron calls ``service.process_due_reminders`` directly (deterministic, no mission), so
running Signet's follow-ups never depends on the AI engine.
"""

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models.mission import Mission
from app.services import mission_ai, usage_guard
from app.services.missions import record_step, register_playbook

from app.sydekyks.signet import emails, service
from app.sydekyks.signet.models import SignetEnvelope

PLAYBOOK_KEY = "signet.dispatch"
PLAYBOOK_KEY_REMIND = "signet.remind"

PLAYBOOK_STEPS = [
    {"key": "load_envelope", "title": "Load the envelope",
     "description": "Read the envelope, its signers, and the source document.",
     "likely_failures": "The envelope was deleted, or has no signers."},
    {"key": "compose", "title": "Compose the invitation",
     "description": "Write the signing invitation (AI-personalised or from a template).",
     "likely_failures": "None fatal - falls back to the standard template."},
    {"key": "send", "title": "Send the invitations",
     "description": "Email each signer a secure signing link.",
     "likely_failures": "Outbound email isn't configured (set the Postmark server token)."},
]

PLAYBOOK_STEPS_REMIND = [
    {"key": "load_envelope", "title": "Load the envelope",
     "description": "Read the envelope and its still-pending signers.",
     "likely_failures": "The envelope was deleted."},
    {"key": "send", "title": "Send reminders",
     "description": "Email a reminder to each pending signer, respecting the max-reminder cap.",
     "likely_failures": "Outbound email isn't configured, or the cap is reached."},
]


def _finish(db, mission, status, summary, error=None, failure_category=None):
    mission.status = status
    mission.result_summary = summary
    mission.error_message = error
    mission.failure_category = failure_category if status == "failed" else None
    mission.completed_at = datetime.now(timezone.utc)
    db.commit()


def _envelope(db, mission) -> SignetEnvelope | None:
    ctx = mission.trigger_context or {}
    eid = ctx.get("envelope_id")
    if not eid:
        return None
    row = db.get(SignetEnvelope, eid)
    if row is None or row.tenant_id != mission.tenant_id:
        return None
    return row


def run_dispatch(db: Session, mission: Mission) -> None:
    idx = 0
    envelope = _envelope(db, mission)
    if envelope is None:
        record_step(db, mission, idx, "load_envelope", "internal", "failed", error="Envelope not found")
        _finish(db, mission, "failed", {}, "Envelope not found", failure_category="validation")
        return
    recipients = service.recipients_for_send(db, envelope)
    if not recipients:
        record_step(db, mission, idx, "load_envelope", "internal", "failed", error="No pending signers")
        _finish(db, mission, "failed", {"envelope_id": str(envelope.id)},
                "This envelope has no pending signers.", failure_category="validation")
        return
    record_step(db, mission, idx, "load_envelope", "internal", "succeeded", output={"recipients": len(recipients)})
    idx += 1

    sender = envelope.created_by or "Your counterparty"
    ai_body = None
    ai_subject = None
    if envelope.email_copy_mode == "ai":
        llm, virtual_key, model_alias = mission_ai.get_llm(db, mission)
        if llm is not None:
            allowed, _deny = usage_guard.check_allowed(db, mission.tenant_id, mission.sydekyk_id, model_alias)
            if allowed:
                ok, copy, meta = emails.ai_copy(
                    virtual_key, model_alias, kind="invitation", signer_name="",
                    title=envelope.title, sender=sender, prompt=envelope.email_prompt,
                    extra=(f"Note from sender: {envelope.message}" if envelope.message else ""),
                )
                mission_ai.emit_usage(db, mission, llm, meta)
                if ok and copy:
                    ai_subject = copy["subject"]
                    ai_body = copy["body_html"]
    record_step(db, mission, idx, "compose", "internal", "succeeded",
                output={"mode": "ai" if ai_body else "template"})
    idx += 1

    sent = 0
    for signer in recipients:
        if ai_body:
            ok = service.deliver_invitation(db, envelope, signer, subject=ai_subject, body_html=ai_body)
        else:
            ok = service.send_template_invitation(db, envelope, signer, sender=sender)
        if ok:
            sent += 1
    db.commit()
    service.mark_sent(db, envelope)
    record_step(db, mission, idx, "send", "internal", "succeeded" if sent else "failed",
                output={"sent": sent})

    if sent == 0:
        _finish(db, mission, "failed", {"envelope_id": str(envelope.id), "title": envelope.title},
                "Could not send any invitations - check that outbound email is configured.",
                failure_category="setup")
        return
    _finish(db, mission, "succeeded", {
        "envelope_id": str(envelope.id), "title": envelope.title, "action": "sent", "sent": sent,
        "odoo_sign_request_id": None,
    })


def run_remind(db: Session, mission: Mission) -> None:
    idx = 0
    envelope = _envelope(db, mission)
    if envelope is None:
        record_step(db, mission, idx, "load_envelope", "internal", "failed", error="Envelope not found")
        _finish(db, mission, "failed", {}, "Envelope not found", failure_category="validation")
        return
    record_step(db, mission, idx, "load_envelope", "internal", "succeeded", output={"status": envelope.status})
    idx += 1
    sent = service.remind_envelope(db, envelope, force=True)
    record_step(db, mission, idx, "send", "internal", "succeeded", output={"sent": sent})
    _finish(db, mission, "succeeded", {
        "envelope_id": str(envelope.id), "title": envelope.title, "action": "reminded", "sent": sent,
    })


register_playbook(PLAYBOOK_KEY, run_dispatch)
register_playbook(PLAYBOOK_KEY_REMIND, run_remind)
