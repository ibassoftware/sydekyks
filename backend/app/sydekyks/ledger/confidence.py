def compute_confidence(
    llm_confidence: int,
    *,
    partner_matched_exact: bool,
    partner_auto_created: bool,
    account_source: str,  # "history" | "guessed"
    duplicate_check: str,  # "clear" | "flagged" | "inconclusive"
) -> int:
    """Blend the model's self-reported confidence with deterministic penalties. Ledger's own
    tunable heuristic — the constants below are the knobs to iterate on post-launch."""
    score = max(0, min(100, llm_confidence))

    if partner_auto_created:
        score -= 15  # we guessed the vendor didn't exist and created it
    elif not partner_matched_exact:
        score -= 5  # fuzzy match, not exact

    if account_source == "guessed":
        score -= 20  # no history to anchor the expense account

    if duplicate_check == "inconclusive":
        score -= 15

    return max(0, min(100, score))
