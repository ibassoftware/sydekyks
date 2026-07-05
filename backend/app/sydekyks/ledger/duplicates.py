from dataclasses import dataclass


@dataclass
class DuplicateResult:
    is_duplicate: bool
    matched_move: dict | None  # the Odoo bill it matched, if any
    reason: str  # "invoice_number" | "amount_match" | "none" | "inconclusive"


def check_duplicate(invoice_number: str | None, exact_matches: list[dict], near_matches: list[dict]) -> DuplicateResult:
    """Vendor+invoice-number is authoritative when the bill has a number; otherwise fall back to
    vendor+amount proximity (weaker signal). exact_matches come from find_duplicate_bills,
    near_matches from find_bills_near."""
    if invoice_number and exact_matches:
        return DuplicateResult(True, exact_matches[0], "invoice_number")
    if not invoice_number and near_matches:
        return DuplicateResult(True, near_matches[0], "amount_match")
    return DuplicateResult(False, None, "none")
