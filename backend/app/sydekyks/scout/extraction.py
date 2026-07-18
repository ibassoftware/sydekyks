"""Scout's AI scoring call - reads a résumé (text-first, vision fallback) and scores the candidate
against the job description with an open-ended fitness analysis (highlights / strengths /
weaknesses). Goes through the shared `vision_ai` plumbing; metered by the caller."""

import re
from dataclasses import dataclass, field

from app.services import vision_ai


@dataclass
class ResumeScore:
    score: int
    summary: str = ""
    highlights: list[str] = field(default_factory=list)
    strengths: list[str] = field(default_factory=list)
    weaknesses: list[str] = field(default_factory=list)
    fit_reasoning: str = ""


_SCORE_TEMPLATE = """You are Scout, an expert technical recruiter. Read the candidate's résumé and \
score how well they fit the role below. Judge overall résumé quality AND their specific fitness for \
this position against EVERY requirement the hiring team specified - the description, the written \
requirements, the expected degree, and the expected skills. Be honest and specific. Respond with \
ONLY a JSON object (no prose, no markdown fences) with exactly these keys:
{{
  "score": integer 0-100 (overall fit for THIS role, weighing all requirements below),
  "summary": one-sentence verdict,
  "highlights": [short strings - the most notable things about this candidate],
  "strengths": [short strings - where they meet the role's requirements],
  "weaknesses": [short strings - requirements they miss or fall short on],
  "fit_reasoning": short paragraph explaining the score against the requirements
}}

=== ROLE REQUIREMENTS ===
{job_block}"""


def _str_list(v) -> list[str]:
    return [str(x).strip() for x in (v or []) if str(x).strip()]


def _strip_html(html: str) -> str:
    return re.sub(r"<[^>]+>", " ", html or "").strip()


def _build_job_block(job: dict | None, job_title: str | None) -> str:
    """Render the job position's full requirement profile (description, requirements, expected degree,
    expected skills) as the scoring rubric - grounded entirely in what HR set on the Odoo hr.job."""
    job = job or {}
    title = job.get("name") or job_title
    lines = [f"Role: {title or '(unspecified - assess general résumé quality)'}"]
    desc = _strip_html(job.get("description") or "")
    if desc:
        lines.append(f"Job description:\n{desc[:3500]}")
    if job.get("requirements"):
        lines.append(f"Requirements:\n{str(job['requirements'])[:2000]}")
    if job.get("expected_degree"):
        lines.append(f"Expected degree: {job['expected_degree']}")
    if job.get("expected_skills"):
        lines.append("Expected skills: " + ", ".join(job["expected_skills"][:40]))
    if not desc and not job.get("requirements"):
        lines.append("(No written description/requirements available - assess general employability.)")
    return "\n\n".join(lines)


def score_applicant(virtual_key, model_alias, mode, value, *, job=None, job_title=None, timeout=90.0):
    """Score a candidate against a job's FULL profile. `job` is the dict from
    odoo_hr.read_job_profile (description + requirements + expected degree + expected skills)."""
    base_prompt = _SCORE_TEMPLATE.format(job_block=_build_job_block(job, job_title))
    prompt, images = vision_ai.build_content(base_prompt, mode, value)
    ok, msg, raw, meta = vision_ai.llm_completion(virtual_key, model_alias, prompt, images, timeout)
    if not ok or raw is None:
        return ok, msg, None, meta
    try:
        score = int(round(float(raw.get("score") or 0)))
    except (TypeError, ValueError):
        score = 0
    return True, "ok", ResumeScore(
        score=score,
        summary=str(raw.get("summary") or ""),
        highlights=_str_list(raw.get("highlights")),
        strengths=_str_list(raw.get("strengths")),
        weaknesses=_str_list(raw.get("weaknesses")),
        fit_reasoning=str(raw.get("fit_reasoning") or ""),
    ), meta
