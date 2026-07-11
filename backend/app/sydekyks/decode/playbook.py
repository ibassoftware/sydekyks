"""Decode's résumé-parsing playbook — registered under 'decode.resume_parse'.

Reads a résumé (text-first, vision fallback), then writes structured data onto an Odoo hr.applicant:
matched job (or pooling), AI-mapped fields, skills, a Note, and the processed tag. For Email/Manual
triggers it CREATES the applicant; for the cron trigger it enriches the existing applicant whose id
arrives in `mission.trigger_context`.
"""

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.core.crypto import decrypt_secret
from app.models.mission import Mission, MissionDocument
from app.services import document_storage, gadget_links, mission_ai, odoo, odoo_hr, review_assignment, tenant_issues, usage_guard, vision_ai
from app.services.missions import record_step, register_playbook

from app.sydekyks.decode import extraction
from app.sydekyks.decode.models import DecodeApplicant, DecodeTenantSettings

PLAYBOOK_KEY = "decode.resume_parse"

PLAYBOOK_STEPS = [
    {"key": "classify_document", "title": "Check it's a résumé",
     "description": "Confirm the uploaded/emailed document is a candidate résumé before parsing.",
     "likely_failures": "The document isn't a résumé (e.g. a random file) — Mission stops."},
    {"key": "extract_resume", "title": "Extract résumé data",
     "description": "Read the résumé with the assigned AI engine and pull name, contact, skills, experience.",
     "likely_failures": "AI engine not configured, or the model can't read the document."},
    {"key": "connect_odoo", "title": "Connect to Odoo",
     "description": "Open an authenticated session to the assigned Odoo instance.",
     "likely_failures": "No Odoo assigned, wrong credentials, or Odoo unreachable."},
    {"key": "resolve_position", "title": "Determine the position",
     "description": "Use the job you picked on upload; otherwise infer it from the email/résumé, or add the applicant to the pool.",
     "likely_failures": "No job selected and none could be inferred — the applicant is pooled (flagged for review)."},
    {"key": "upsert_applicant", "title": "Create / find the applicant",
     "description": "Create a new hr.applicant (email/manual) or use the existing one (cron).",
     "likely_failures": "Odoo rejects required fields."},
    {"key": "map_fields", "title": "Fill applicant fields",
     "description": "AI-map the parsed data onto the instance's real hr.applicant fields and write them.",
     "likely_failures": "None fatal — unmappable fields are skipped."},
    {"key": "attach_resume", "title": "Attach the résumé",
     "description": "Attach the original résumé file to the applicant record as evidence.",
     "likely_failures": "Best-effort — a failed attachment never fails the Mission."},
    {"key": "skills", "title": "Add skills",
     "description": "Map résumé skills to Odoo's skill taxonomy (creating missing ones only if enabled).",
     "likely_failures": "Skills not in the taxonomy are flagged when auto-create is off."},
    {"key": "post_note", "title": "Post a Note",
     "description": "Post a summary Note to the applicant's chatter.",
     "likely_failures": "Best-effort."},
    {"key": "tag_processed", "title": "Tag as processed",
     "description": "Stamp the processed tag so Decode won't re-process this applicant.",
     "likely_failures": "Best-effort."},
]


def _finish(db, mission, status, summary, error=None, failure_category=None):
    mission.status = status
    mission.result_summary = summary
    mission.error_message = error
    mission.failure_category = failure_category if status == "failed" else None
    mission.completed_at = datetime.now(timezone.utc)
    db.commit()


def _get_settings(db, tenant_id) -> DecodeTenantSettings:
    s = db.query(DecodeTenantSettings).filter(DecodeTenantSettings.tenant_id == tenant_id).first()
    if s is None:
        s = DecodeTenantSettings(tenant_id=tenant_id)
        db.add(s)
        db.commit()
        db.refresh(s)
    return s


def _build_note(resume, job_name, is_pooling) -> str:
    rows = [f"<p><b>Decode parsed this résumé.</b></p>"]
    if resume.current_title:
        rows.append(f"<p>Title: {resume.current_title}</p>")
    if resume.years_experience is not None:
        rows.append(f"<p>Experience: ~{resume.years_experience:g} years</p>")
    rows.append(f"<p>Position: {'Pool (no match)' if is_pooling else job_name}</p>")
    if resume.skills:
        rows.append("<p>Skills: " + ", ".join(resume.skills[:20]) + "</p>")
    if resume.summary:
        rows.append(f"<p>Summary: {resume.summary}</p>")
    return "".join(rows)


def run(db: Session, mission: Mission) -> None:
    idx = 0
    ctx = mission.trigger_context or {}
    existing_applicant_id = ctx.get("odoo_applicant_id")
    settings = _get_settings(db, mission.tenant_id)

    document = db.query(MissionDocument).filter(MissionDocument.mission_id == mission.id).first()
    document_bytes = document_storage.read_content(document) if document else None
    if document is None or document_bytes is None:
        record_step(db, mission, idx, "classify_document", "internal", "failed", error="Résumé bytes missing")
        _finish(db, mission, "failed", {}, "Résumé bytes missing", failure_category="validation")
        return

    llm, virtual_key, model_alias = mission_ai.get_llm(db, mission)
    if llm is None:
        record_step(db, mission, idx, "classify_document", "llm_call", "failed",
                    error="No AI engine configured for Decode. Pick one in the Roster AI Engine section.")
        _finish(db, mission, "failed", {}, "No AI engine configured", failure_category="setup")
        return

    allowed, deny = usage_guard.check_allowed(db, mission.tenant_id, mission.sydekyk_id, model_alias)
    if not allowed:
        record_step(db, mission, idx, "quota_check", "internal", "failed", error=deny)
        tenant_issues.report_issue(db, tenant_id=mission.tenant_id, sydekyk_id=mission.sydekyk_id,
                                   kind="quota_exceeded", title="AI usage limit reached — Decode paused",
                                   detail=deny, mission_id=mission.id)
        _finish(db, mission, "failed", {}, deny, failure_category="quota")
        return

    llm_mode, llm_value, in_err = vision_ai.document_to_llm_input(
        document_bytes, document.content_type, max_pages=settings.max_resume_pages
    )
    if in_err:
        record_step(db, mission, idx, "classify_document", "internal", "failed", error=in_err)
        _finish(db, mission, "failed", {}, in_err, failure_category="validation")
        return

    # --- Step 1: is this a résumé? ---------------------------------------------------------------
    ok, msg, cls, meta = extraction.classify_is_resume(virtual_key, model_alias, llm_mode, llm_value)
    mission_ai.emit_usage(db, mission, llm, meta)
    if not ok or cls is None:
        record_step(db, mission, idx, "classify_document", "llm_call", "failed", error=msg)
        _finish(db, mission, "failed", {}, msg, failure_category="transient")
        return
    if not cls.is_resume:
        reason = f"This doesn't look like a résumé (looks like: {cls.document_type_guess or 'unknown'}). {cls.reason}".strip()
        record_step(db, mission, idx, "classify_document", "llm_call", "failed", error=reason)
        _finish(db, mission, "failed", {}, reason, failure_category="validation")
        return
    record_step(db, mission, idx, "classify_document", "llm_call", "succeeded", output={"is_resume": True})
    idx += 1

    # --- Step 2: extract ------------------------------------------------------------------------
    ok, msg, resume, meta = extraction.extract_resume_data(virtual_key, model_alias, llm_mode, llm_value)
    mission_ai.emit_usage(db, mission, llm, meta)
    if not ok or resume is None:
        record_step(db, mission, idx, "extract_resume", "llm_call", "failed", error=msg)
        _finish(db, mission, "failed", {}, msg, failure_category="transient")
        return
    record_step(db, mission, idx, "extract_resume", "llm_call", "succeeded",
                output={"full_name": resume.full_name, "email": resume.email, "skills": len(resume.skills)})
    idx += 1

    # --- Step 3: connect Odoo -------------------------------------------------------------------
    link = gadget_links.find_assigned_link(db, tenant_id=mission.tenant_id, sydekyk_id=mission.sydekyk_id, role_key="erp")
    if link is None:
        record_step(db, mission, idx, "connect_odoo", "gadget_call", "failed",
                    error="No Odoo instance assigned to Decode. Assign one in Decode's settings.")
        _finish(db, mission, "failed", {"applicant_name": resume.full_name}, "No Odoo instance assigned",
                failure_category="setup")
        return
    ok, msg, client = odoo.connect(link.url, link.database, link.username, decrypt_secret(link.encrypted_secret))
    if not ok or client is None:
        record_step(db, mission, idx, "connect_odoo", "gadget_call", "failed", error=msg)
        _finish(db, mission, "failed", {"applicant_name": resume.full_name}, msg, failure_category="external")
        return
    record_step(db, mission, idx, "connect_odoo", "gadget_call", "succeeded", output={"instance": link.name})
    idx += 1

    try:
        # --- Step 4: resolve position -----------------------------------------------------------
        # Priority: the job the user explicitly picked on upload > AI-inferred from the email/résumé
        # > pool. An explicit pick skips the (billable) AI match entirely.
        jobs = odoo_hr.list_jobs(client)
        valid_job_ids = {j["id"] for j in jobs}
        job_id = None
        job_name = None
        is_pooling = True
        position_source = "pool"

        explicit_job_id = ctx.get("job_id")
        if explicit_job_id is not None and int(explicit_job_id) in valid_job_ids:
            job_id = int(explicit_job_id)
            job_name = next((j["name"] for j in jobs if j["id"] == job_id), None)
            is_pooling = False
            position_source = "selected"
        elif jobs:
            hint = f"{ctx.get('subject', '')}\n{ctx.get('text_body', '')}".strip()
            ok, msg, jm, meta = extraction.match_job(
                virtual_key, model_alias, hint=hint, summary=resume.summary, skills=resume.skills, available_jobs=jobs)
            mission_ai.emit_usage(db, mission, llm, meta)
            if ok and jm and jm.get("job_id"):
                job_id = jm["job_id"]
                job_name = next((j["name"] for j in jobs if j["id"] == job_id), None)
                is_pooling = False
                position_source = "ai_matched"
        record_step(db, mission, idx, "resolve_position", "gadget_call", "succeeded",
                    output={"job_id": job_id, "job_name": job_name, "pooling": is_pooling, "source": position_source})
        idx += 1

        # --- Step 5: create / find applicant ----------------------------------------------------
        if existing_applicant_id:
            applicant_id = int(existing_applicant_id)
            if job_id:
                odoo_hr.update_applicant(client, applicant_id, {"job_id": job_id})
            created = False
        else:
            base: dict = {"partner_name": resume.full_name}
            if resume.email:
                base["email_from"] = resume.email
            if resume.phone:
                base["partner_phone"] = resume.phone
            if job_id:
                base["job_id"] = job_id
            applicant_id = odoo_hr.create_applicant(client, base)
            created = True
        record_step(db, mission, idx, "upsert_applicant", "gadget_call", "succeeded",
                    output={"applicant_id": applicant_id, "created": created})
        idx += 1

        # --- Step 6: AI-map fields onto the real schema (scalars + selection + Degree) -----------
        schema = odoo_hr.applicant_fields(client)
        relational: dict = {}
        degree_field = odoo_hr.find_field_by_relation(schema, "hr.recruitment.degree")
        if degree_field:
            relational[degree_field] = odoo_hr.list_options(client, "hr.recruitment.degree")
        ok, msg, fields, meta = extraction.map_to_applicant_fields(
            virtual_key, model_alias, resume, schema, relational_options=relational)
        mission_ai.emit_usage(db, mission, llm, meta)
        written = []
        if ok and fields:
            odoo_hr.update_applicant(client, applicant_id, fields)
            written = list(fields.keys())
        record_step(db, mission, idx, "map_fields", "gadget_call", "succeeded", output={"fields": written})
        idx += 1

        # --- Step 7: attach résumé (create mode; existing already has it) ------------------------
        if not existing_applicant_id:
            odoo.attach_document(client, res_model="hr.applicant", res_id=applicant_id,
                                 filename=document.filename, content_bytes=document_bytes, mimetype=document.content_type)
        record_step(db, mission, idx, "attach_resume", "gadget_call", "succeeded", output={"attached": not existing_applicant_id})
        idx += 1

        # --- Step 8: skills ---------------------------------------------------------------------
        # The AI only categorizes each skill into an existing skill TYPE (by name — reliable). We
        # resolve the hr.skill id + level deterministically here: reuse an existing skill under that
        # type, else create it when auto-create is on; otherwise flag it for the recruiter.
        skill_specs: list[dict] = []
        flagged: list[str] = []
        if resume.skills:
            types = odoo_hr.list_skill_types(client)
            existing = odoo_hr.list_skills(client)

            def _type_id(s):
                t = s.get("skill_type_id")
                return t[0] if isinstance(t, list) else t

            existing_by_key = {(str(s["name"]).strip().lower(), _type_id(s)): s["id"] for s in existing}
            ok, msg, mapped, meta = extraction.map_skills(virtual_key, model_alias, resume.skills, types)
            mission_ai.emit_usage(db, mission, llm, meta)
            level_cache: dict = {}
            for m in (mapped or []):
                stype, sname = m["skill_type_id"], m["name"]
                sid = existing_by_key.get((sname.strip().lower(), stype))
                if sid is None:
                    if settings.auto_create_skills:
                        sid = odoo_hr.ensure_skill(client, sname, stype)
                    else:
                        flagged.append(sname)
                        continue
                if stype not in level_cache:
                    level_cache[stype] = odoo_hr.default_skill_level(client, stype)
                level = level_cache[stype]
                if level is None:
                    flagged.append(sname)
                    continue
                skill_specs.append({"skill_type_id": stype, "skill_id": sid, "skill_level_id": level})
            if skill_specs:
                odoo_hr.set_applicant_skills(client, applicant_id, skill_specs)
        record_step(db, mission, idx, "skills", "gadget_call", "succeeded",
                    output={"added": len(skill_specs), "flagged": flagged})
        if flagged and not settings.auto_create_skills:
            tenant_issues.report_issue(
                db, tenant_id=mission.tenant_id, sydekyk_id=mission.sydekyk_id, kind="decode_skill_gap",
                title="Decode found skills not in your Odoo taxonomy",
                detail="Enable auto-create skills, or add these in Odoo: " + ", ".join(sorted(set(flagged))[:20]),
                mission_id=mission.id)
        idx += 1

        # --- Step 9: note -----------------------------------------------------------------------
        odoo_hr.post_note(client, applicant_id, _build_note(resume, job_name, is_pooling))
        record_step(db, mission, idx, "post_note", "gadget_call", "succeeded")
        idx += 1

        # --- Step 10: tag processed -------------------------------------------------------------
        tag_id = odoo_hr.ensure_tag(client, settings.processed_tag_name)
        odoo_hr.add_tag(client, applicant_id, tag_id)
        record_step(db, mission, idx, "tag_processed", "gadget_call", "succeeded", output={"tag": settings.processed_tag_name})
        idx += 1

        needs_review = bool(flagged) or is_pooling
        review_reason = None
        if flagged and not settings.auto_create_skills:
            review_reason = "Some skills need adding to your Odoo taxonomy."
        elif is_pooling:
            review_reason = "No matching job — added to the pool."

        if needs_review:
            review_assignment.assign_on_flag(
                db, client, tenant_id=mission.tenant_id, sydekyk_id=mission.sydekyk_id,
                model="hr.applicant", res_id=applicant_id,
                summary=f"Review applicant — {resume.full_name}",
                note=f"<p>{review_reason or 'Flagged by Decode for review.'}</p>",
            )

        source = "odoo" if existing_applicant_id else (document.source or "web_upload")
        db.add(DecodeApplicant(
            tenant_id=mission.tenant_id, sydekyk_id=mission.sydekyk_id, mission_id=mission.id,
            odoo_applicant_id=applicant_id, applicant_name=resume.full_name, email=resume.email, phone=resume.phone,
            job_id=job_id, job_name=job_name, is_pooling=is_pooling, skills=resume.skills,
            years_experience=resume.years_experience, source=source, needs_review=needs_review, review_reason=review_reason,
        ))
        _finish(db, mission, "succeeded", {
            "applicant_id": applicant_id, "applicant_name": resume.full_name, "job_name": job_name,
            "pooling": is_pooling, "skills_added": len(skill_specs), "needs_review": needs_review,
            "review_reason": review_reason,
        })
    except odoo.OdooError as exc:
        record_step(db, mission, idx, "odoo_error", "gadget_call", "failed", error=str(exc))
        _finish(db, mission, "failed", {"applicant_name": resume.full_name}, str(exc), failure_category="external")


register_playbook(PLAYBOOK_KEY, run)
