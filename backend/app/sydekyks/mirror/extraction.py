"""Mirror's AI judgment. The deterministic tiers (detection.py) surface CANDIDATE matches grounded in
real data - same vendor, same reference, same amount, shared VAT/bank. The model then adjudicates
holistically: given the candidate bill and the specific bills it was matched against (with their line
items), is this truly the same purchase billed twice? It weighs vendor identity, reference, amount,
date proximity and line-item meaning - so a coincidental same-round-amount is cleared while a
resubmitted invoice under a fresh number is caught. The model can only judge the candidates the
deterministic layer found; it cannot invent a match.
"""

from app.services import vision_ai

_ADJUDICATE_TEMPLATE = """You are Mirror, an accounts-payable duplicate detector. A candidate vendor \
bill was matched against one or more existing bills by deterministic checks. Judge, holistically, \
whether the candidate is TRULY a duplicate of any of them - i.e. the same purchase billed more than \
once. Weigh vendor identity, reference number, amount, how close the dates are, and whether the line \
items describe the same goods/services (by meaning, not exact text).

Rules of thumb: two bills with the same round amount but clearly different goods/services are NOT \
duplicates; a resubmitted invoice under a different reference number IS; the same vendor + same \
reference is almost always a duplicate.

Candidate bill:
{candidate}

Matched against:
{matches}

Respond with ONLY a JSON object (no prose, no markdown fences):
{{"is_duplicate": boolean, "confidence": integer 0-100, "reasoning": "one or two short sentences"}}"""


def _fmt_bill(b: dict, lines: list[dict]) -> str:
    head = (
        f"vendor={b.get('vendor_name')!r} ref={b.get('ref')!r} "
        f"amount={b.get('amount')} {b.get('currency') or ''} date={b.get('invoice_date')}"
    )
    items = "; ".join(
        f"{ln.get('name') or '(no label)'} x{ln.get('quantity')} @ {ln.get('price_unit')}"
        for ln in (lines or [])[:20]
    ) or "(no line items)"
    return f"{head}\n  line items: {items}"


def adjudicate_duplicate(virtual_key, model_alias, candidate: dict, matches: list[dict], timeout: float = 45.0):
    """Given the candidate bill and the matched bills (each a dict with vendor_name/ref/amount/
    currency/invoice_date + a 'lines' list), return (ok, msg, {is_duplicate, confidence, reasoning}, meta)."""
    cand_txt = _fmt_bill(candidate, candidate.get("lines") or [])
    match_txt = "\n".join(f"[{i + 1}] {_fmt_bill(m, m.get('lines') or [])}" for i, m in enumerate(matches[:4])) or "(none)"
    prompt = _ADJUDICATE_TEMPLATE.format(candidate=cand_txt, matches=match_txt)
    ok, msg, raw, meta = vision_ai.llm_completion(virtual_key, model_alias, prompt, [], timeout)
    if not ok or raw is None:
        return ok, msg, None, meta
    try:
        conf = max(0, min(100, int(round(float(raw.get("confidence") or 0)))))
    except (TypeError, ValueError):
        conf = 0
    return True, "ok", {
        "is_duplicate": bool(raw.get("is_duplicate")),
        "confidence": conf,
        "reasoning": str(raw.get("reasoning") or ""),
    }, meta
