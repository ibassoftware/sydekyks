"""Unit tests for Mirror's deterministic duplicate detection + AI adjudication (no DB, no network)."""

from app.services import vision_ai
from app.services.odoo_finance import normalize_ref
from app.sydekyks.mirror import detection, extraction


def test_normalize_ref_collapses_variants():
    assert normalize_ref("INV-0012") == normalize_ref("inv 12") == normalize_ref("#12") == "12"
    assert normalize_ref("TEST-INV-9001") == "testinv9001"
    assert normalize_ref(None) == ""
    assert normalize_ref("  ") == ""


def _bill(id, partner, ref=None, amount=0.0, day="2026-06-10"):
    return {"id": id, "partner_id": [partner, "V"], "ref": ref, "amount_total": amount, "invoice_date": day}


def test_exact_match_same_normalized_ref():
    bill = _bill(1, 9, "INV-0012", 100)
    others = [_bill(2, 9, "inv 12", 999), _bill(3, 9, "OTHER", 100)]
    ids, reasons, conf = detection.exact_match(bill, others)
    assert ids == [2] and conf >= 90 and reasons


def test_exact_match_ignores_blank_ref():
    ids, _r, _c = detection.exact_match(_bill(1, 9, None, 100), [_bill(2, 9, None, 100)])
    assert ids == []  # no reference to match on — that's the fuzzy tier's job


def test_fuzzy_match_same_amount_within_window_diff_ref():
    bill = _bill(1, 9, "A-1", 250, "2026-06-10")
    within = _bill(2, 9, "B-2", 250, "2026-06-20")   # same amount, 10 days, different ref
    outside = _bill(3, 9, "C-3", 250, "2026-04-01")  # same amount but 70 days away
    diff_amt = _bill(4, 9, "D-4", 251, "2026-06-11")
    ids, _r, conf = detection.fuzzy_match(bill, [within, outside, diff_amt], window_days=30)
    assert ids == [2] and conf >= 70


def test_adjudicate_duplicate_parses_and_clamps(monkeypatch):
    monkeypatch.setattr(vision_ai, "llm_completion",
                        lambda *a, **k: (True, "ok", {"is_duplicate": True, "confidence": 140, "reasoning": "same purchase"}, {}))
    candidate = {"vendor_name": "Acme", "ref": "A", "amount": 100, "currency": "USD", "invoice_date": "2026-06-01", "lines": []}
    ok, _m, verdict, _meta = extraction.adjudicate_duplicate("v", "m", candidate, [candidate])
    assert ok and verdict["is_duplicate"] is True and verdict["confidence"] == 100  # clamped
    assert verdict["reasoning"] == "same purchase"


def test_cross_vendor_same_amount_shared_vat():
    bill = _bill(1, 9, "X", 500, "2026-06-10")
    other_partner_bills = {22: [_bill(7, 22, "Y", 500, "2026-06-12")]}
    ids, reasons, conf = detection.cross_vendor_match(
        bill, {"id": 9}, other_partner_bills,
        same_vat_partner_ids={22}, same_bank_partner_ids=set(), window_days=30,
    )
    assert ids == [7] and conf >= 70 and "Tax ID" in reasons[0]
