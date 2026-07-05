"""Unit tests for duplicate detection and confidence scoring (no DB)."""

from app.sydekyks.ledger.confidence import compute_confidence
from app.sydekyks.ledger.duplicates import check_duplicate


def test_duplicate_by_invoice_number():
    res = check_duplicate("INV-1", exact_matches=[{"name": "BILL/1"}], near_matches=[])
    assert res.is_duplicate is True
    assert res.reason == "invoice_number"


def test_duplicate_by_amount_when_no_invoice_number():
    res = check_duplicate(None, exact_matches=[], near_matches=[{"name": "BILL/2"}])
    assert res.is_duplicate is True
    assert res.reason == "amount_match"


def test_not_duplicate_when_nothing_matches():
    res = check_duplicate("INV-9", exact_matches=[], near_matches=[])
    assert res.is_duplicate is False
    assert res.reason == "none"


def test_invoice_number_takes_priority_over_amount():
    # With an invoice number present, near (amount) matches are ignored.
    res = check_duplicate("INV-1", exact_matches=[], near_matches=[{"name": "BILL/x"}])
    assert res.is_duplicate is False


def test_confidence_clamps_and_penalizes():
    # Perfect signals: no penalties.
    assert compute_confidence(95, partner_matched_exact=True, partner_auto_created=False,
                              account_source="history", duplicate_check="clear") == 95
    # Auto-created vendor (-15) + guessed account (-20).
    assert compute_confidence(95, partner_matched_exact=False, partner_auto_created=True,
                              account_source="guessed", duplicate_check="clear") == 60
    # Fuzzy match (-5) only.
    assert compute_confidence(90, partner_matched_exact=False, partner_auto_created=False,
                              account_source="history", duplicate_check="clear") == 85


def test_confidence_never_negative():
    assert compute_confidence(0, partner_matched_exact=False, partner_auto_created=True,
                              account_source="guessed", duplicate_check="inconclusive") == 0
