"""Scout's AI scoring call — reads a résumé (text-first, vision fallback) and scores the candidate
against the job description with an open-ended fitness analysis (highlights / strengths /
weaknesses). Goes through the shared `vision_ai` plumbing; metered by the caller."""

import json
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
this position — be honest and specific. Respond with ONLY a JSON object (no prose, no markdown \
fences) with exactly these keys:
{{
  "score": integer 0-100 (overall fit for THIS role),
  "summary": one-sentence verdict,
  "highlights": [short strings — the most notable things about this candidate],
  "strengths": [short strings — where they fit the role well],
  "weaknesses": [short strings — gaps or concerns for this role],
  "fit_reasoning": short paragraph explaining the score
}}

Role: {job_title}
Job description:
{job_description}
{rubric}"""


def _str_list(v) -> list[str]:
    return [str(x).strip() for x in (v or []) if str(x).strip()]


def score_applicant(
    virtual_key, model_alias, mode, value, *, job_title, job_description, rubric=None, timeout=90.0
):
    rubric_block = f"\nAdditional evaluation criteria from the hiring team:\n{rubric}" if rubric else ""
    base_prompt = _SCORE_TEMPLATE.format(
        job_title=job_title or "(unspecified — general résumé quality)",
        job_description=(job_description or "(no job description available — assess general employability)")[:4000],
        rubric=rubric_block,
    )
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
