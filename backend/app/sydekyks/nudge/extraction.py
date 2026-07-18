"""Nudge's AI step - the one part that needs a model. The cron does the catching (deterministic
staleness); the LLM only writes the follow-up, grounded in the opp's fields and the actual last
exchange, matched to the stage - so it references what really happened, not a generic 'just checking
in'. The rep edits and sends.
"""

import re

from app.services import vision_ai

_TEMPLATE = """You are Nudge, a sales rep's follow-up assistant. Draft a short, warm follow-up \
message for this opportunity that references the REAL last exchange (below) and fits the deal's \
stage - never a generic "just checking in". Be specific, friendly, and end with one clear, low-\
friction next step. Keep it to 3-5 sentences.

Opportunity: {name}
Stage: {stage}
Contact: {contact}
Days since last contact: {days}

Recent thread (newest first):
{thread}

Respond with ONLY a JSON object (no prose, no markdown fences):
{{"subject": "short email subject", "body": "the follow-up message (plain text, no signature)", "reasoning": "one short sentence on the angle you took"}}"""


def _strip_html(html: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html or "")).strip()


def _fmt_thread(messages: list[dict]) -> str:
    lines = []
    for m in messages[:6]:
        who = m.get("author_id")[1] if isinstance(m.get("author_id"), list) else "?"
        when = str(m.get("date") or "")[:10]
        body = _strip_html(m.get("body") or "")[:400]
        if body:
            lines.append(f"- [{when}] {who}: {body}")
    return "\n".join(lines) or "(no prior messages on record)"


def draft_followup(virtual_key, model_alias, *, name, stage, contact, days_stale, thread, timeout: float = 45.0):
    """Returns (ok, msg, {subject, body, reasoning} | None, meta)."""
    prompt = _TEMPLATE.format(
        name=name or "(unnamed opportunity)", stage=stage or "(unknown stage)",
        contact=contact or "the contact", days=days_stale, thread=_fmt_thread(thread),
    )
    ok, msg, raw, meta = vision_ai.llm_completion(virtual_key, model_alias, prompt, [], timeout)
    if not ok or raw is None:
        return ok, msg, None, meta
    return True, "ok", {
        "subject": str(raw.get("subject") or "Following up").strip(),
        "body": str(raw.get("body") or "").strip(),
        "reasoning": str(raw.get("reasoning") or "").strip(),
    }, meta
