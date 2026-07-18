"""Shield's AI judgment. The deterministic rules (detection.py) fire grounded, factual signals - a
bank change on an unpaid bill, an employee bank match, an SoD break. The model then reasons over
those signals PLUS the bill and vendor context to produce a holistic risk assessment: it weighs the
signals in context (a bank change on a brand-new high-value vendor is graver than on a long-trusted
one), can surface additional things worth a look, and writes the auditor briefing. Framing is strict:
it describes risk and recommends review - it never accuses or concludes fraud.
"""

from app.services import vision_ai

_ASSESS_TEMPLATE = """You are Shield, an internal-audit assistant. Review this vendor bill and the \
risk signals that fired on it, then give a holistic risk assessment for a human auditor. Weigh the \
signals IN CONTEXT (e.g. a vendor bank-account change is far more concerning on a brand-new, \
high-value vendor than on a long-established one; several weak signals together can matter more than \
one alone). You may note additional things worth checking. This is ADVISORY ONLY: describe risk and \
recommend review - NEVER accuse anyone, and NEVER state a conclusion of fraud or wrongdoing.

Bill: {bill}
Vendor context: {vendor}
Signals that fired (grounded facts):
{flags}

Respond with ONLY a JSON object (no prose, no markdown fences):
{{"risk_score": integer 0-100, "priority": "high" | "medium" | "low", "summary": "1-2 sentence advisory briefing", "extra_concerns": ["short strings", "optional"]}}"""


def _str_list(v) -> list[str]:
    return [str(x).strip() for x in (v or []) if str(x).strip()]


def assess_risk(virtual_key, model_alias, *, bill: str, vendor: str, flags: list[dict], timeout: float = 45.0):
    """Holistically assess risk from the grounded flags + context. Returns
    (ok, msg, {risk_score, priority, summary, extra_concerns} | None, meta)."""
    flag_lines = "\n".join(f"- {f['label']}: {f.get('evidence', '')}" for f in flags) or "- (none)"
    prompt = _ASSESS_TEMPLATE.format(bill=bill, vendor=vendor or "(unknown)", flags=flag_lines)
    ok, msg, raw, meta = vision_ai.llm_completion(virtual_key, model_alias, prompt, [], timeout)
    if not ok or raw is None:
        return ok, msg, None, meta
    try:
        score = max(0, min(100, int(round(float(raw.get("risk_score") or 0)))))
    except (TypeError, ValueError):
        score = 0
    priority = str(raw.get("priority") or "").lower()
    if priority not in ("high", "medium", "low"):
        priority = "high" if score >= 70 else "medium" if score >= 40 else "low"
    return True, "ok", {
        "risk_score": score,
        "priority": priority,
        "summary": str(raw.get("summary") or "").strip(),
        "extra_concerns": _str_list(raw.get("extra_concerns")),
    }, meta
