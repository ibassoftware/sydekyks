"""Decode's AI functions — résumé classification, extraction, and grounded mapping onto real Odoo
config (job, hr.applicant fields, skills). All calls go through the shared `vision_ai` plumbing
(text-first, image-fallback) and are metered by the caller. Every returned Odoo id is validated
against the offered set (never trust a hallucinated id — same discipline as Ledger's matcher).
"""

import json
from dataclasses import dataclass, field

from app.services import vision_ai

_CLASSIFY_PROMPT = """You are Decode, a recruitment assistant. Decide whether the attached document \
is a candidate's résumé / CV. Respond with ONLY a JSON object (no prose, no markdown fences):
{"is_resume": boolean, "document_type_guess": short string, "reason": short string}
Answer true for anything that is plausibly a résumé/CV even if unusually formatted."""

_EXTRACT_PROMPT = """You are Decode, a meticulous recruitment assistant. Read the candidate's \
résumé and extract their details. Respond with ONLY a JSON object (no prose, no markdown fences) \
with exactly these keys:
{
  "full_name": string,
  "email": string or null,
  "phone": string or null,
  "location": string or null,
  "linkedin": string or null,
  "current_title": string or null,
  "summary": short professional summary string or null,
  "years_experience": number or null,
  "skills": [string, ...],
  "languages": [string, ...],
  "education": [string, ...],
  "work_history": [short "Title at Company (dates)" string, ...]
}
If a field is not present, use null (or an empty array). Never invent values."""


@dataclass
class ResumeClassification:
    is_resume: bool
    document_type_guess: str = ""
    reason: str = ""


@dataclass
class ResumeExtraction:
    full_name: str
    email: str | None = None
    phone: str | None = None
    location: str | None = None
    linkedin: str | None = None
    current_title: str | None = None
    summary: str | None = None
    years_experience: float | None = None
    skills: list[str] = field(default_factory=list)
    languages: list[str] = field(default_factory=list)
    education: list[str] = field(default_factory=list)
    work_history: list[str] = field(default_factory=list)


def _str_list(v) -> list[str]:
    return [str(x).strip() for x in (v or []) if str(x).strip()]


def _coerce_resume(raw: dict) -> ResumeExtraction:
    try:
        years = float(raw["years_experience"]) if raw.get("years_experience") is not None else None
    except (TypeError, ValueError):
        years = None
    return ResumeExtraction(
        full_name=str(raw.get("full_name") or "Unknown Candidate"),
        email=(str(raw["email"]) if raw.get("email") else None),
        phone=(str(raw["phone"]) if raw.get("phone") else None),
        location=raw.get("location") or None,
        linkedin=raw.get("linkedin") or None,
        current_title=raw.get("current_title") or None,
        summary=raw.get("summary") or None,
        years_experience=years,
        skills=_str_list(raw.get("skills")),
        languages=_str_list(raw.get("languages")),
        education=_str_list(raw.get("education")),
        work_history=_str_list(raw.get("work_history")),
    )


def classify_is_resume(virtual_key, model_alias, mode, value, timeout=45.0):
    prompt, images = vision_ai.build_content(_CLASSIFY_PROMPT, mode, value)
    ok, msg, raw, meta = vision_ai.llm_completion(virtual_key, model_alias, prompt, images, timeout)
    if not ok or raw is None:
        return ok, msg, None, meta
    return True, "ok", ResumeClassification(
        is_resume=bool(raw.get("is_resume")),
        document_type_guess=str(raw.get("document_type_guess") or ""),
        reason=str(raw.get("reason") or ""),
    ), meta


def extract_resume_data(virtual_key, model_alias, mode, value, timeout=90.0):
    prompt, images = vision_ai.build_content(_EXTRACT_PROMPT, mode, value)
    ok, msg, raw, meta = vision_ai.llm_completion(virtual_key, model_alias, prompt, images, timeout)
    if not ok or raw is None:
        return ok, msg, None, meta
    return True, "ok", _coerce_resume(raw), meta


_MATCH_JOB_TEMPLATE = """You are Decode, matching a candidate to the RIGHT open position in this \
company's Odoo. Given the candidate summary + the hint of what they applied for, choose the single \
best-fitting job from the list, or null if none plausibly fit (they go to a general pool).

Applied-for hint (from the email/subject, may be empty): {hint}
Candidate summary: {summary}
Candidate skills: {skills}

Open positions in Odoo (id: name):
{jobs_json}

Respond with ONLY JSON: {{"job_id": integer id from the list or null, "reasoning": short string}}
Only return an id EXACTLY present in the list above; never invent one."""


def match_job(virtual_key, model_alias, *, hint, summary, skills, available_jobs, timeout=45.0):
    prompt = _MATCH_JOB_TEMPLATE.format(
        hint=(hint or "")[:500], summary=(summary or "")[:1000], skills=json.dumps(skills[:40]),
        jobs_json=json.dumps([{"id": j["id"], "name": j["name"]} for j in available_jobs]),
    )
    ok, msg, raw, meta = vision_ai.llm_completion(virtual_key, model_alias, prompt, [], timeout)
    if not ok or raw is None:
        return ok, msg, None, meta
    valid = {j["id"] for j in available_jobs}
    job_id = raw.get("job_id")
    if job_id is not None and job_id not in valid:
        job_id = None
    return True, "ok", {"job_id": job_id, "reasoning": str(raw.get("reasoning") or "")}, meta


_MAP_FIELDS_TEMPLATE = """You are Decode, filling an Odoo hr.applicant record from a parsed résumé. \
Map the candidate's data onto the ACTUAL writable fields of this Odoo instance (listed below with \
their technical name, type, and label). Return ONLY the fields you can confidently fill.

Candidate data:
{resume_json}

Writable hr.applicant fields (technical_name: type — label):
{fields_json}

Respond with ONLY a JSON object mapping technical_field_name -> value, using ONLY field names from \
the list above. Use the correct primitive type (string for char/text/html, number for float, \
"YYYY-MM-DD" for date). Omit any field you cannot fill. Never invent field names or values."""

# Field types we let the AI write directly (relational fields — job, skills, tags — are handled
# explicitly by the playbook, never by the free-form mapper).
_WRITABLE_TYPES = {"char", "text", "html", "float", "integer", "date", "monetary"}


def map_to_applicant_fields(virtual_key, model_alias, resume: ResumeExtraction, fields_schema: dict, timeout=45.0):
    """Ask the AI to map résumé data onto the instance's real writable scalar hr.applicant fields.
    `fields_schema` is `fields_get(hr.applicant)`. Returns a validated dict of settable field→value."""
    catalog = [
        {"name": n, "type": m.get("type"), "label": m.get("string")}
        for n, m in fields_schema.items()
        if m.get("type") in _WRITABLE_TYPES and not m.get("readonly")
    ]
    catalog_names = {c["name"]: c["type"] for c in catalog}
    resume_json = json.dumps({
        "full_name": resume.full_name, "email": resume.email, "phone": resume.phone,
        "location": resume.location, "linkedin": resume.linkedin, "current_title": resume.current_title,
        "summary": resume.summary, "years_experience": resume.years_experience,
        "education": resume.education, "work_history": resume.work_history,
    })
    prompt = _MAP_FIELDS_TEMPLATE.format(
        resume_json=resume_json, fields_json=json.dumps(catalog),
    )
    ok, msg, raw, meta = vision_ai.llm_completion(virtual_key, model_alias, prompt, [], timeout)
    if not ok or raw is None:
        return ok, msg, None, meta

    out: dict = {}
    for name, val in (raw or {}).items():
        typ = catalog_names.get(name)
        if typ is None or val is None or val == "":
            continue
        try:
            if typ in ("float", "monetary"):
                out[name] = float(val)
            elif typ == "integer":
                out[name] = int(val)
            else:
                out[name] = str(val)
        except (TypeError, ValueError):
            continue
    return True, "ok", out, meta


_MAP_SKILLS_TEMPLATE = """You are Decode, mapping a candidate's skills onto this Odoo instance's \
skill taxonomy. For each résumé skill, match it to an EXISTING hr.skill when possible (by meaning, \
not just exact text); otherwise propose creating it under the most appropriate existing skill type.

Résumé skills: {skills_json}

Existing skill types (id: name):
{types_json}

Existing skills (id: name, skill_type_id):
{skills_catalog_json}

Respond with ONLY a JSON array; one object per skill you can place:
[{{"name": string, "skill_type_id": integer id from the types list, "skill_id": integer existing hr.skill id or null if it must be created}}]
Only use ids EXACTLY present in the lists above. Skip a skill entirely if you cannot pick a skill_type_id."""


def map_skills(virtual_key, model_alias, resume_skills, skill_types, existing_skills, timeout=45.0):
    """Map résumé skills to (skill_type_id, skill_id|None). Returns a validated list; ids not in the
    offered sets are dropped/nulled."""
    prompt = _MAP_SKILLS_TEMPLATE.format(
        skills_json=json.dumps(resume_skills[:60]),
        types_json=json.dumps([{"id": t["id"], "name": t["name"]} for t in skill_types]),
        skills_catalog_json=json.dumps([
            {"id": s["id"], "name": s["name"],
             "skill_type_id": s["skill_type_id"][0] if isinstance(s.get("skill_type_id"), list) else s.get("skill_type_id")}
            for s in existing_skills
        ]),
    )
    ok, msg, raw, meta = vision_ai.llm_completion(virtual_key, model_alias, prompt, [], timeout)
    if not ok:
        return ok, msg, None, meta
    valid_types = {t["id"] for t in skill_types}
    valid_skills = {s["id"] for s in existing_skills}
    rows = raw if isinstance(raw, list) else (raw.get("skills") if isinstance(raw, dict) else None)
    out = []
    for item in rows or []:
        if not isinstance(item, dict):
            continue
        stype = item.get("skill_type_id")
        if stype not in valid_types:
            continue
        sid = item.get("skill_id")
        if sid is not None and sid not in valid_skills:
            sid = None
        out.append({"name": str(item.get("name") or "").strip(), "skill_type_id": stype, "skill_id": sid})
    return True, "ok", out, meta
