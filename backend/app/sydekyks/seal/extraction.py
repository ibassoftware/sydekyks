"""Seal's AI steps — the parts that need a model.

`generate_contract_stream` turns a template + the drafter's brief (+ optional grounded Odoo facts) into
a polished HTML contract. `refine_contract` is the "Ask Seal" co-editing turn. `review_contract` is the
wow factor: it reads the contract clause-by-clause and returns a list of grounded risk findings, each
quoting the offending clause text so an accepted redline can be applied deterministically.

`generate_contract_stream` rides the shared `vision_ai.llm_stream` transport and emits raw HTML so the
tokens are meaningful as they arrive (the drafter watches the contract write itself); `refine`/`review`
stay buffered on `vision_ai.llm_completion` because their outputs are structured (full-document rewrite
+ chat reply; a findings array) where a partial is not renderable.

Grounding discipline (§12): every factual claim about a party must trace to a fact we passed in; if a
fact isn't supplied, the draft says "confirm" rather than inventing. For review, every finding must
quote real clause text — the router drops any finding whose anchor can't be located in the source.
"""

from app.services import vision_ai

# The validated set the review model must pick a category from. Anything else is dropped by the router.
REVIEW_CATEGORIES = {
    "liability_cap",
    "indemnity",
    "auto_renewal",
    "payment_terms",
    "termination",
    "ip_ownership",
    "confidentiality",
    "governing_law",
    "warranty",
    "data_privacy",
    "missing_clause",
    "other",
}
REVIEW_SEVERITIES = {"high", "medium", "low"}

_GENERATE_TEMPLATE = """You are Seal, a contract writer. Produce a clean, professional contract as \
semantic HTML (a document fragment — a title, numbered clause headings, paragraphs, lists, and a \
simple table where useful; NO <html>/<head>/<body> wrapper, no inline styles, no markdown fences).

Use the TEMPLATE below as the structure and legal tone to follow, and fill it out from the drafter's \
BRIEF. Only state facts about the parties (names, dates, amounts, governing law, term) that appear in \
the BRIEF or GROUNDED FACTS; never invent them — where a detail is missing, write a clear \
"[confirm …]" placeholder. Keep standard protective clauses that the template implies.

TEMPLATE ({template_format}):
{template}

BRIEF FROM THE DRAFTER:
{notes}

GROUNDED FACTS (from Odoo — authoritative, may be empty):
{facts}

Respond with ONLY the contract itself as an HTML fragment — begin with a single <h1> holding a short \
contract title, then the clauses. No JSON, no <html>/<head>/<body> wrapper, no markdown fences, and no \
commentary before or after the fragment."""


_REFINE_TEMPLATE = """You are Seal, editing an in-progress contract for a drafter. You are given the \
CURRENT contract HTML and the drafter's INSTRUCTION. Return the FULL updated HTML fragment with the \
requested change applied — change only what's asked, and preserve everything else exactly: existing \
clause structure, wording you weren't asked to touch, and especially any images (keep every \
<img src="/api/tenant/seal/assets/..."> tag intact). No <html>/<body> wrapper, no markdown fences, \
no invented facts.

RECENT CONVERSATION (oldest first, for context):
{history}

CURRENT CONTRACT HTML:
{current_html}

DRAFTER'S INSTRUCTION:
{message}

Respond with ONLY a JSON object (no prose, no markdown fences):
{{"reply": "a one-sentence chat reply to the drafter", "html": "the FULL updated HTML fragment", "changed_summary": "a short past-tense summary of what you changed"}}"""


_REVIEW_TEMPLATE = """You are Seal, a contract reviewer acting for the party identified in the review \
guidelines. Read the CONTRACT clause-by-clause and surface risky, one-sided, or missing clauses. You \
FLAG and SUGGEST — you never rewrite the document yourself; a human accepts or rejects each finding.

Ground your judgment in the tenant's REVIEW GUIDELINES (their standard positions and risk tolerance). \
For every finding you MUST quote the exact offending clause text from the contract in "clause_anchor" \
(copy it verbatim so it can be located); for a MISSING clause, set "clause_anchor" to an empty string. \
Propose replacement wording in "suggested_redline". Do not invent facts.

Pick "category" from EXACTLY this set: liability_cap, indemnity, auto_renewal, payment_terms, \
termination, ip_ownership, confidentiality, governing_law, warranty, data_privacy, missing_clause, \
other. Pick "severity" from: high, medium, low.

REVIEW GUIDELINES:
{guidelines}

CONTRACT:
{contract}

Respond with ONLY a JSON object (no prose, no markdown fences):
{{"findings": [{{"clause_label": "short label", "category": "one of the set", "severity": "high|medium|low", "issue": "what's wrong, one or two sentences", "rationale": "why it matters", "clause_anchor": "verbatim clause text or empty", "suggested_redline": "proposed replacement wording"}}]}}"""


def _fmt_facts(facts: dict | None) -> str:
    if not facts:
        return "(none supplied)"
    lines = [f"- {k}: {v}" for k, v in facts.items() if v not in (None, "", [])]
    return "\n".join(lines) or "(none supplied)"


def _fmt_history(history: list[dict]) -> str:
    lines = []
    for m in history[-8:]:
        who = "Drafter" if m.get("role") == "user" else "Seal"
        body = (m.get("content") or "").strip()
        if body:
            lines.append(f"- {who}: {body[:300]}")
    return "\n".join(lines) or "(no prior turns)"


def generate_contract_stream(
    virtual_key, model_alias, *, template_body, template_format, notes, facts=None,
    on_delta=None, timeout: float = 240.0,
):
    """Stream a draft over the shared `vision_ai.llm_stream` transport. Forwards each token chunk to
    `on_delta` (for live SSE display; `None` for a buffered/headless run) and returns
    `(ok, msg, {html, title, counterparty} | None, meta)` once the full HTML fragment is assembled.
    Title is derived from the leading heading; counterparty is grounded by the playbook, not the model."""
    prompt = _GENERATE_TEMPLATE.format(
        template=(template_body or "(no template — use a standard contract structure)").strip(),
        template_format=template_format or "html",
        notes=(notes or "(no brief supplied)").strip(),
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
        else:  # done — full assembled text + usage/cost meta
            html, meta = event["text"], event["meta"]

    html = vision_ai.strip_code_fences(html)
    if not html:
        return False, "The AI engine returned an empty draft.", None, meta
    return True, "ok", {"html": html, "title": vision_ai.title_from_html(html), "counterparty": ""}, meta


def refine_contract(virtual_key, model_alias, *, current_html, message, history=None, timeout: float = 240.0):
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
        "changed_summary": str(raw.get("changed_summary") or "Revised the contract").strip(),
    }, meta


def review_contract(virtual_key, model_alias, *, contract_text, guidelines, timeout: float = 240.0):
    """Returns (ok, msg, [finding, ...] | None, meta). Findings are validated against the category and
    severity sets; anything outside them is coerced to `other` / `low` rather than dropped here — the
    router drops findings whose non-empty anchor can't be located in the source."""
    prompt = _REVIEW_TEMPLATE.format(
        guidelines=(guidelines or "(no guidelines supplied — apply standard commercial-contract best practice)").strip(),
        contract=(contract_text or "(empty document)").strip(),
    )
    ok, msg, raw, meta = vision_ai.llm_completion(virtual_key, model_alias, prompt, [], timeout)
    if not ok or raw is None:
        return ok, msg, None, meta
    findings = []
    for f in (raw.get("findings") or []):
        if not isinstance(f, dict):
            continue
        category = str(f.get("category") or "other").strip().lower()
        severity = str(f.get("severity") or "low").strip().lower()
        findings.append({
            "clause_label": str(f.get("clause_label") or "").strip()[:200],
            "category": category if category in REVIEW_CATEGORIES else "other",
            "severity": severity if severity in REVIEW_SEVERITIES else "low",
            "issue": str(f.get("issue") or "").strip(),
            "rationale": str(f.get("rationale") or "").strip(),
            "clause_anchor": str(f.get("clause_anchor") or "").strip(),
            "suggested_redline": str(f.get("suggested_redline") or "").strip(),
        })
    return True, "ok", findings, meta
