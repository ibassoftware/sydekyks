"""Mirror's AI step — the only part that genuinely needs a model. When two bills have different
references but suspiciously similar totals, an LLM judges whether their LINE ITEMS describe the same
underlying purchase (a resubmitted invoice), which plain string matching can't tell. Everything else
(exact ref, amount/date fuzzy, cross-vendor) is deterministic in detection.py.
"""

from app.services import vision_ai

_TEMPLATE = """You are Mirror, an accounts-payable duplicate detector. Two vendor bills have similar \
totals but different reference numbers. Decide whether they are the SAME underlying purchase billed \
twice (a resubmitted/duplicated invoice) by comparing their line items — judge by meaning, not exact \
text ("Consulting - June" ≈ "June consulting services").

Bill A line items:
{lines_a}

Bill B line items:
{lines_b}

Respond with ONLY a JSON object (no prose, no markdown fences):
{{"similarity": integer 0-100 (how likely the SAME purchase), "same_items": boolean, "reasoning": one short sentence}}"""


def _fmt(lines: list[dict]) -> str:
    rows = []
    for ln in lines[:40]:
        rows.append(
            f"- {ln.get('name') or '(no label)'} | qty {ln.get('quantity')} | unit {ln.get('price_unit')} | subtotal {ln.get('price_subtotal')}"
        )
    return "\n".join(rows) or "(no line items)"


def compare_line_items(virtual_key, model_alias, lines_a: list[dict], lines_b: list[dict], timeout: float = 45.0):
    """Returns (ok, msg, {similarity:int, same_items:bool, reasoning:str} | None, meta)."""
    prompt = _TEMPLATE.format(lines_a=_fmt(lines_a), lines_b=_fmt(lines_b))
    ok, msg, raw, meta = vision_ai.llm_completion(virtual_key, model_alias, prompt, [], timeout)
    if not ok or raw is None:
        return ok, msg, None, meta
    try:
        sim = max(0, min(100, int(round(float(raw.get("similarity") or 0)))))
    except (TypeError, ValueError):
        sim = 0
    return True, "ok", {
        "similarity": sim,
        "same_items": bool(raw.get("same_items")),
        "reasoning": str(raw.get("reasoning") or ""),
    }, meta
