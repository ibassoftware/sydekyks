"""Nudge's deterministic staleness + prioritization math (no AI, no I/O). The silence score is days
stale weighted by how far past the stage's tolerance it is; value-at-risk multiplies that by the
opp's expected revenue so the highest-value-at-risk deals rank first."""


def stage_threshold(thresholds: dict | None, default_days: int, stage_id: int | None) -> int:
    """Days of silence tolerated for this stage — a per-stage override if the tenant set one, else the
    default. A fresh lead tolerates less silence than a late-stage negotiation."""
    if thresholds and stage_id is not None:
        v = thresholds.get(str(stage_id))
        if v is not None:
            try:
                return max(1, int(v))
            except (TypeError, ValueError):
                pass
    return max(1, int(default_days))


def is_stale(days_stale: int, threshold: int) -> bool:
    return days_stale >= threshold


def silence_score(days_stale: int, threshold: int) -> int:
    """0-100-ish: how overdue, so a deal 3× past its tolerance outranks one just over the line."""
    if threshold <= 0:
        return min(100, max(0, int(days_stale)))
    return min(100, round((days_stale / threshold) * 50))


def value_at_risk(expected_revenue: float | None, days_stale: int, threshold: int) -> float:
    """Revenue exposed, weighted by how overdue the follow-up is — the queue's ranking key."""
    rev = float(expected_revenue or 0.0)
    over = (days_stale / threshold) if threshold > 0 else 1.0
    return round(rev * over, 2)
