"""Quill's AI steps - the parts that need a model.

`generate_proposal_stream` turns a template + the rep's notes (+ optional grounded Odoo facts) into a
polished HTML proposal, streamed over `vision_ai.llm_stream` so the rep watches it write itself (raw
HTML, not a JSON envelope). `refine_proposal` is the "Ask Quill" co-editing turn: given the current
HTML and an instruction, it returns the FULL updated HTML plus a short chat reply and a one-line
summary of what changed - it stays buffered on `vision_ai.llm_completion` (structured multi-field
output, not renderable as a partial).

Grounding discipline (§12): every factual claim about the customer must trace to a fact we passed in.
If a fact isn't supplied, the draft says "confirm" rather than inventing.
"""

from app.services import vision_ai

_GENERATE_TEMPLATE = """You are Quill, a proposal writer. Produce a polished, client-ready business \
proposal as clean semantic HTML (a document fragment - headings, paragraphs, lists, and a simple \
table where useful; NO <html>/<head>/<body> wrapper, no inline styles, no markdown fences).

Use the TEMPLATE below as the structure and tone to follow, and fill it out from the rep's NOTES. \
Only state facts about the customer that appear in the NOTES or GROUNDED FACTS; never invent numbers, \
names, dates, or commitments - where a detail is missing, write a clear "[confirm …]" placeholder.

TEMPLATE ({template_format}):
{template}

NOTES FROM THE REP:
{notes}

GROUNDED FACTS (from Odoo - authoritative, may be empty):
{facts}

Respond with ONLY the proposal itself as an HTML fragment - begin with a single <h1> holding a short \
proposal title, then the sections. No JSON, no <html>/<head>/<body> wrapper, no markdown fences, and no \
commentary before or after the fragment."""


_REFINE_TEMPLATE = """You are Quill, editing an in-progress proposal for a sales rep. You are given the \
CURRENT proposal HTML and the rep's INSTRUCTION. Return the FULL updated HTML fragment with the \
requested change applied - change only what's asked, and preserve everything else exactly: existing \
structure, wording you weren't asked to touch, and especially any images (keep every \
<img src="/api/tenant/quill/assets/..."> tag intact). No <html>/<body> wrapper, no markdown fences, \
no invented facts.

RECENT CONVERSATION (oldest first, for context):
{history}

CURRENT PROPOSAL HTML:
{current_html}

REP'S INSTRUCTION:
{message}

Respond with ONLY a JSON object (no prose, no markdown fences):
{{"reply": "a one-sentence chat reply to the rep", "html": "the FULL updated HTML fragment", "changed_summary": "a short past-tense summary of what you changed"}}"""


def _fmt_facts(facts: dict | None) -> str:
    if not facts:
        return "(none supplied)"
    lines = [f"- {k}: {v}" for k, v in facts.items() if v not in (None, "", [])]
    return "\n".join(lines) or "(none supplied)"


def _fmt_history(history: list[dict]) -> str:
    lines = []
    for m in history[-8:]:
        who = "Rep" if m.get("role") == "user" else "Quill"
        body = (m.get("content") or "").strip()
        if body:
            lines.append(f"- {who}: {body[:300]}")
    return "\n".join(lines) or "(no prior turns)"


def generate_proposal_stream(
    virtual_key, model_alias, *, template_body, template_format, notes, facts=None,
    on_delta=None, timeout: float = 240.0,
):
    """Stream a draft over the shared `vision_ai.llm_stream` transport. Forwards each token chunk to
    `on_delta` (for live SSE display; `None` for a buffered/headless run) and returns
    `(ok, msg, {html, title, customer} | None, meta)` once the full HTML fragment is assembled. Title
    is derived from the leading heading; customer is grounded by the playbook, not the model."""
    prompt = _GENERATE_TEMPLATE.format(
        template=(template_body or "(no template - use a standard proposal structure)").strip(),
        template_format=template_format or "html",
        notes=(notes or "(no notes supplied)").strip(),
        facts=_fmt_facts(facts),
    )
    html = ""
    meta = vision_ai.empty_meta(model_alias)
    for event in vision_ai.llm_stream(virtual_key, model_alias, prompt, [], timeout):
        if event["type"] == "delta":
            if on_delta is not None:
                on_delta(event["text"])
        elif event["type"] == "error":
            return False, event["msg"], None, event["meta"]
        else:  # done - full assembled text + usage/cost meta
            html, meta = event["text"], event["meta"]

    html = vision_ai.strip_code_fences(html)
    if not html:
        return False, "The AI engine returned an empty draft.", None, meta
    return True, "ok", {"html": html, "title": vision_ai.title_from_html(html), "customer": ""}, meta


def refine_proposal(virtual_key, model_alias, *, current_html, message, history=None, timeout: float = 240.0):
    """Returns (ok, msg, {reply, html, changed_summary} | None, meta)."""
    prompt = _REFINE_TEMPLATE.format(
        history=_fmt_history(history or []),
        current_html=(current_html or "(empty document)").strip(),
        message=(message or "").strip(),
    )
    ok, msg, raw, meta = vision_ai.llm_completion(virtual_key, model_alias, prompt, [], timeout)
    if not ok or raw is None:
        return ok, msg, None, meta
    return True, "ok", {
        "reply": str(raw.get("reply") or "Done.").strip(),
        "html": str(raw.get("html") or "").strip(),
        "changed_summary": str(raw.get("changed_summary") or "Revised the proposal").strip(),
    }, meta
