"""Decode's AI functions - résumé classification, extraction, and grounded mapping onto real Odoo
config (job, hr.applicant fields, skills). All calls go through the shared `vision_ai` plumbing
(text-first, image-fallback) and are metered by the caller. Every returned Odoo id is validated
against the offered set (never trust a hallucinated id - same discipline as Ledger's matcher).
"""

import json
from dataclasses import dataclass, field

from app.services import vision_ai

_CLASSIFY_PROMPT = """You are Decode, a recruitment assistant. Decide whether the attached document \
is a candidate's résumé / CV - a document describing ONE person's work experience, education, and \
skills. Respond with ONLY a JSON object (no prose, no markdown fences):
{"is_resume": boolean, "document_type_guess": short string describing what the document actually is, "reason": short string}

Answer true for a résumé/CV even if unusually formatted or in another language. Answer FALSE for \
anything that is clearly NOT a résumé - e.g. an invoice or receipt, a contract, a job description or \
job posting, an ID card, a certificate/diploma on its own, a standalone cover letter with no CV, a \
random photo, a screenshot, or a blank/unreadable page."""

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
Map the candidate's data onto the ACTUAL fields of THIS Odoo instance. Each field lists its technical \
name, type, label, and - for selection/relation fields - the allowed options.

Candidate data:
{resume_json}

Writable hr.applicant fields:
{fields_json}

Respond with ONLY a JSON object mapping technical_field_name -> value, using ONLY field names above:
- text / char / html: a string
- float / integer: a number
- date: "YYYY-MM-DD"
- selection: one of the field's "options" codes (exactly)
- relation: the integer "id" of the best-matching entry from the field's "options" (e.g. map the \
candidate's education to the closest Degree)
Fill every field you reasonably can from the résumé (name, email, phone, summary/notes, degree, \
etc.). Omit only fields you genuinely cannot determine. Never invent field names, option codes, or ids."""

# Scalar field types the AI writes directly. Selection + specific many2one fields (passed via
# relational_options, e.g. Degree) are also offered, with their allowed values, and validated.
_SCALAR_TYPES = {"char", "text", "html", "float", "integer", "date", "monetary"}

# Fields Decode must NEVER set from a résumé - recruiter/pipeline/system fields, and priority
# (that's Scout's evaluation score). Everything else writable is fair game.
_EXCLUDE_FIELDS = {
    "priority", "kanban_state", "stage_id", "active", "color", "id", "display_name",
    "create_uid", "write_uid", "create_date", "write_date", "user_id", "company_id",
    "department_id", "source_id", "medium_id", "job_id", "manager_id", "interviewer_ids",
    "date_closed", "date_open", "refuse_reason_id",
}


def map_to_applicant_fields(
    virtual_key, model_alias, resume: ResumeExtraction, fields_schema: dict, relational_options: dict | None = None, timeout=45.0
):
    """Map résumé data onto the instance's real hr.applicant fields - scalars, selection fields (from
    fields_get), and any many2one fields whose options are supplied in `relational_options`
    ({field_name: [{id,name}]}, e.g. the Degree field). Every value is validated against the offered
    options; nothing is invented. Version-safe: everything comes from `fields_get(hr.applicant)`."""
    relational_options = relational_options or {}
    catalog: list[dict] = []
    handlers: dict = {}  # name -> (kind, scalar_type, allowed_set)
    for name, meta_f in fields_schema.items():
        if meta_f.get("readonly") or name in _EXCLUDE_FIELDS:
            continue
        ftype = meta_f.get("type")
        if ftype in _SCALAR_TYPES:
            catalog.append({"name": name, "type": ftype, "label": meta_f.get("string")})
            handlers[name] = ("scalar", ftype, None)
        elif ftype == "selection" and meta_f.get("selection"):
            options = [str(s[0]) for s in meta_f["selection"]]
            catalog.append({"name": name, "type": "selection", "label": meta_f.get("string"), "options": options})
            handlers[name] = ("selection", None, set(options))
        elif ftype == "many2one" and relational_options.get(name):
            opts = [{"id": o["id"], "name": o["name"]} for o in relational_options[name]]
            catalog.append({"name": name, "type": "relation", "label": meta_f.get("string"), "options": opts})
            handlers[name] = ("relation", None, {o["id"] for o in opts})

    resume_json = json.dumps({
        "full_name": resume.full_name, "email": resume.email, "phone": resume.phone,
        "location": resume.location, "linkedin": resume.linkedin, "current_title": resume.current_title,
        "summary": resume.summary, "years_experience": resume.years_experience,
        "education": resume.education, "work_history": resume.work_history,
    })
    prompt = _MAP_FIELDS_TEMPLATE.format(resume_json=resume_json, fields_json=json.dumps(catalog))
    ok, msg, raw, meta = vision_ai.llm_completion(virtual_key, model_alias, prompt, [], timeout)
    if not ok or raw is None:
        return ok, msg, None, meta

    out: dict = {}
    for name, val in (raw or {}).items():
        info = handlers.get(name)
        if info is None or val is None or val == "":
            continue
        kind, scalar_type, allowed = info
        try:
            if kind == "scalar":
                if scalar_type in ("float", "monetary"):
                    out[name] = float(val)
                elif scalar_type == "integer":
                    out[name] = int(val)
                else:
                    out[name] = str(val)
            elif kind == "selection":
                if str(val) in allowed:
                    out[name] = str(val)
            elif kind == "relation":
                iv = int(val)
                if iv in allowed:
                    out[name] = iv
        except (TypeError, ValueError):
            continue
    return True, "ok", out, meta


_MAP_SKILLS_TEMPLATE = """You are Decode, categorizing a candidate's skills into this Odoo instance's \
skill categories. For each résumé skill, choose the single best-fitting category by NAME from the \
list below (judge by meaning). If none fits well, use "{fallback}".

Résumé skills: {skills_json}

Available skill categories: {categories_json}

Respond with ONLY a JSON array, one object per skill:
[{{"name": the skill string, "category": exactly one category name from the list}}]
Use only category names from the list. Include every skill."""


def map_skills(virtual_key, model_alias, resume_skills, skill_types, timeout=45.0):
    """Categorize each résumé skill into an existing skill TYPE (by name - reliable for an LLM, unlike
    id-matching). Returns a validated list of {name, skill_type_id}; the playbook then resolves/creates
    the hr.skill + attaches it with the type's level. Unknown categories fall back to the first type."""
    if not skill_types:
        return True, "ok", [], {}
    by_name = {str(t["name"]).strip().lower(): t["id"] for t in skill_types}
    fallback_id = skill_types[0]["id"]
    prompt = _MAP_SKILLS_TEMPLATE.format(
        skills_json=json.dumps(resume_skills[:60]),
        categories_json=json.dumps([t["name"] for t in skill_types]),
        fallback=skill_types[0]["name"],
    )
    ok, msg, raw, meta = vision_ai.llm_completion(virtual_key, model_alias, prompt, [], timeout)
    if not ok:
        return ok, msg, None, meta
    rows = raw if isinstance(raw, list) else (raw.get("skills") if isinstance(raw, dict) else None)
    out = []
    seen = set()
    for item in rows or []:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        if not name or name.lower() in seen:
            continue
        seen.add(name.lower())
        type_id = by_name.get(str(item.get("category") or "").strip().lower(), fallback_id)
        out.append({"name": name, "skill_type_id": type_id})
    return True, "ok", out, meta
