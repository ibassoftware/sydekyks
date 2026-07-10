"""Shield's AI step — turns the deterministically-fired rule flags into a concise, auditor-facing
narrative. The rules decide WHAT fired; the model only phrases WHY it warrants a look. Framing is
strict: it describes risk and recommends review, it never accuses or concludes 'fraud'.
"""

from app.services import vision_ai

_TEMPLATE = """You are Shield, an internal-audit assistant. Below is one vendor bill and the risk \
signals that fired on it. Write a SHORT briefing (1-2 sentences) for a human auditor explaining what \
warrants a review. Be factual and specific about the signals. This is advisory only — describe risk \
and recommend review; NEVER accuse anyone of fraud, and NEVER state a conclusion of wrongdoing.

Vendor: {vendor}
Amount: {amount}
Signals that fired:
{flags}

Respond with ONLY a JSON object (no prose, no markdown fences):
{{"summary": "1-2 sentence review briefing, advisory tone"}}"""


def summarize_risk(virtual_key, model_alias, *, vendor, amount, flags: list[dict], timeout: float = 45.0):
    """Returns (ok, msg, summary_str, meta). Best-effort — the caller falls back to joining the flag
    labels if the model is unavailable."""
    flag_lines = "\n".join(f"- {f['label']}: {f.get('evidence', '')}" for f in flags) or "- (none)"
    prompt = _TEMPLATE.format(vendor=vendor or "(unknown)", amount=amount, flags=flag_lines)
    ok, msg, raw, meta = vision_ai.llm_completion(virtual_key, model_alias, prompt, [], timeout)
    if not ok or raw is None:
        return ok, msg, None, meta
    summary = str(raw.get("summary") or "").strip()
    return True, "ok", summary or None, meta
