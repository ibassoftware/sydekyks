"""Scout scoring helpers — clamp the AI score and map it to Odoo's priority (Evaluation) stars.
Kept small and deterministic so the score→stars mapping is auditable and tunable."""


def clamp_score(ai_score) -> int:
    try:
        return max(0, min(100, int(round(float(ai_score)))))
    except (TypeError, ValueError):
        return 0


def priority_band(score: int) -> int:
    """hr.applicant.priority is 0..3 stars. Map score bands onto them."""
    if score >= 85:
        return 3
    if score >= 70:
        return 2
    if score >= 50:
        return 1
    return 0
