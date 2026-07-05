def build_narration(confidence: int, account_source: str, posted: bool) -> str:
    """Hero-toned note stamped onto the Odoo bill so a human knows Ledger created it. Kept in one
    place so the copy can be iterated without touching the pipeline."""
    verdict = "posted automatically" if posted else "left in draft for your review"
    account_note = (
        "matched to this vendor's usual expense account"
        if account_source == "history"
        else "assigned a best-guess expense account"
    )
    return (
        f"⚡ Filed by Ledger, your finance Sydekyk.\n"
        f"Confidence: {confidence}% — {account_note}.\n"
        f"This bill was {verdict}. Give it a once-over, Commander."
    )
