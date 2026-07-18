"""Scout's résumé-scoring playbook - registered under 'scout.resume_score'.

Runs over an existing Odoo hr.applicant (id supplied in `mission.trigger_context` by the run-now
endpoint or the cron poller). Reads the résumé (text-first, vision fallback), scores fitness against
the applicant's job with an open-ended analysis, writes the priority stars + a Note, and tags the
record processed. Independent of Decode.
"""

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.core.crypto import decrypt_secret
from app.models.mission import Mission, MissionDocument
from app.services import document_storage, gadget_links, mission_ai, odoo, odoo_hr, usage_guard, vision_ai
from app.services.missions import record_step, register_playbook

from app.sydekyks.scout import extraction, scoring
from app.sydekyks.scout.models import ScoutApplicant, ScoutTenantSettings

PLAYBOOK_KEY = "scout.resume_score"

PLAYBOOK_STEPS = [
    {"key": "connect_odoo", "title": "Connect to Odoo",
     "description": "Open an authenticated session to the assigned Odoo instance.",
     "likely_failures": "No Odoo assigned, wrong credentials, or Odoo unreachable."},
    {"key": "resolve_job", "title": "Load the role",
     "description": "Read the applicant and the job they're applied to (for the scoring context).",
     "likely_failures": "Applicant missing; scored against general quality if no job."},
    {"key": "score", "title": "Score the candidate",
     "description": "AI reads the résumé and scores fitness for the role (highlights/strengths/weaknesses).",
     "likely_failures": "AI engine not configured, or the résumé can't be read."},
    {"key": "record_score", "title": "Record the score",
     "description": "Set the Evaluation stars and post a scoring Note to the applicant.",
     "likely_failures": "Best-effort writes to Odoo."},
    {"key": "tag_processed", "title": "Tag as scored",
     "description": "Stamp the processed tag so Scout won't re-score this applicant.",
     "likely_failures": "Best-effort."},
]


def _finish(db, mission, status, summary, error=None, failure_category=None):
    mission.status = status
    mission.result_summary = summary
    mission.error_message = error
    mission.failure_category = failure_category if status == "failed" else None
    mission.completed_at = datetime.now(timezone.utc)
    db.commit()


def _get_settings(db, tenant_id) -> ScoutTenantSettings:
    s = db.query(ScoutTenantSettings).filter(ScoutTenantSettings.tenant_id == tenant_id).first()
    if s is None:
        s = ScoutTenantSettings(tenant_id=tenant_id)
        db.add(s)
        db.commit()
        db.refresh(s)
    return s


def _build_note(result, job_name) -> str:
    rows = [f"<p><b>Scout scored this candidate: {result.score}/100</b> for {job_name or 'general fit'}.</p>"]
    if result.summary:
        rows.append(f"<p>{result.summary}</p>")
    if result.strengths:
        rows.append("<p><b>Strengths:</b> " + "; ".join(result.strengths[:8]) + "</p>")
    if result.weaknesses:
        rows.append("<p><b>Weaknesses:</b> " + "; ".join(result.weaknesses[:8]) + "</p>")
    return "".join(rows)


def run(db: Session, mission: Mission) -> None:
    idx = 0
    ctx = mission.trigger_context or {}
    applicant_id = ctx.get("odoo_applicant_id")
    settings = _get_settings(db, mission.tenant_id)

    if not applicant_id:
        record_step(db, mission, idx, "resolve_job", "internal", "failed", error="No target applicant supplied")
        _finish(db, mission, "failed", {}, "No target applicant supplied", failure_category="validation")
        return

    document = db.query(MissionDocument).filter(MissionDocument.mission_id == mission.id).first()
    document_bytes = document_storage.read_content(document) if document else None
    if document is None or document_bytes is None:
        record_step(db, mission, idx, "score", "internal", "failed", error="Résumé bytes missing")
        _finish(db, mission, "failed", {}, "Résumé bytes missing", failure_category="validation")
        return

    llm, virtual_key, model_alias = mission_ai.get_llm(db, mission)
    if llm is None:
        record_step(db, mission, idx, "score", "llm_call", "failed",
                    error="No AI engine configured for Scout. Pick one in the Roster AI Engine section.")
        _finish(db, mission, "failed", {}, "No AI engine configured", failure_category="setup")
        return

    allowed, deny = usage_guard.check_allowed(db, mission.tenant_id, mission.sydekyk_id, model_alias)
    if not allowed:
        from app.services import tenant_issues
        record_step(db, mission, idx, "score", "internal", "failed", error=deny)
        tenant_issues.report_issue(db, tenant_id=mission.tenant_id, sydekyk_id=mission.sydekyk_id,
                                   kind="quota_exceeded", title="AI usage limit reached - Scout paused",
                                   detail=deny, mission_id=mission.id)
        _finish(db, mission, "failed", {}, deny, failure_category="quota")
        return

    # --- Step 1: connect Odoo -------------------------------------------------------------------
    link = gadget_links.find_assigned_link(db, tenant_id=mission.tenant_id, sydekyk_id=mission.sydekyk_id, role_key="erp")
    if link is None:
        record_step(db, mission, idx, "connect_odoo", "gadget_call", "failed",
                    error="No Odoo instance assigned to Scout. Assign one in Scout's settings.")
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
        # --- Step 2: load applicant + the job's FULL requirement profile ------------------------
        applicant = odoo_hr.read_applicant(client, int(applicant_id), ["partner_name", "job_id"])
        applicant_name = (applicant or {}).get("partner_name") or "Candidate"
        job_field = (applicant or {}).get("job_id")
        job_id = job_field[0] if isinstance(job_field, list) and job_field else None
        job_name = job_field[1] if isinstance(job_field, list) and len(job_field) > 1 else None
        job_profile = None
        if job_id:
            # Everything HR specified on the position - description, requirements, expected degree,
            # expected skills - becomes the scoring rubric (grounded in Odoo, not a manual field).
            job_profile = odoo_hr.read_job_profile(client, job_id)
            job_name = job_profile.get("name") or job_name
        record_step(db, mission, idx, "resolve_job", "gadget_call", "succeeded",
                    output={"applicant_id": applicant_id, "job_name": job_name,
                            "skills_expected": len((job_profile or {}).get("expected_skills") or []),
                            "degree_expected": (job_profile or {}).get("expected_degree")})
        idx += 1

        # --- Step 3: score ---------------------------------------------------------------------
        llm_mode, llm_value, in_err = vision_ai.document_to_llm_input(document_bytes, document.content_type, max_pages=5)
        if in_err:
            record_step(db, mission, idx, "score", "internal", "failed", error=in_err)
            _finish(db, mission, "failed", {"applicant_name": applicant_name}, in_err, failure_category="validation")
            return
        ok, msg, result, meta = extraction.score_applicant(
            virtual_key, model_alias, llm_mode, llm_value, job=job_profile, job_title=job_name)
        mission_ai.emit_usage(db, mission, llm, meta)
        if not ok or result is None:
            record_step(db, mission, idx, "score", "llm_call", "failed", error=msg)
            _finish(db, mission, "failed", {"applicant_name": applicant_name}, msg, failure_category="transient")
            return
        score = scoring.clamp_score(result.score)
        record_step(db, mission, idx, "score", "llm_call", "succeeded", output={"score": score})
        idx += 1

        # --- Step 4: record score (stars + note) -----------------------------------------------
        odoo_hr.set_priority(client, int(applicant_id), scoring.priority_band(score))
        odoo_hr.post_note(client, int(applicant_id), _build_note(result, job_name))
        record_step(db, mission, idx, "record_score", "gadget_call", "succeeded",
                    output={"stars": scoring.priority_band(score)})
        idx += 1

        # --- Step 5: tag processed -------------------------------------------------------------
        tag_id = odoo_hr.ensure_tag(client, settings.processed_tag_name)
        odoo_hr.add_tag(client, int(applicant_id), tag_id)
        record_step(db, mission, idx, "tag_processed", "gadget_call", "succeeded",
                    output={"tag": settings.processed_tag_name})
        idx += 1

        # Scout never flags for human review - scoring is advisory; the stars + Note speak for
        # themselves and a recruiter decides. It just records the score and moves on.
        db.add(ScoutApplicant(
            tenant_id=mission.tenant_id, sydekyk_id=mission.sydekyk_id, mission_id=mission.id,
            odoo_applicant_id=int(applicant_id), applicant_name=applicant_name, job_id=job_id, job_name=job_name,
            score=score, summary=result.summary, highlights=result.highlights, strengths=result.strengths,
            weaknesses=result.weaknesses, needs_review=False, review_reason=None,
            source="odoo",
        ))
        _finish(db, mission, "succeeded", {
            "applicant_id": applicant_id, "applicant_name": applicant_name, "job_name": job_name, "score": score,
        })
    except odoo.OdooError as exc:
        record_step(db, mission, idx, "odoo_error", "gadget_call", "failed", error=str(exc))
        _finish(db, mission, "failed", {}, str(exc), failure_category="external")


register_playbook(PLAYBOOK_KEY, run)
