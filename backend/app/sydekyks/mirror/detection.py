"""Mirror's deterministic duplicate-detection tiers (no AI). Given the candidate bill and the
vendor's other bills, find matches by exact reference, strong fuzzy (amount + date window), and
cross-vendor-record (same VAT / same bank across different partner records). Line-item similarity is
the one tier that needs AI - it lives in extraction.py and is only invoked when these are ambiguous.

Each tier returns (matched_move_ids, reasons, base_confidence) so the playbook can pick the strongest
signal and attach the "why" to the finding.
"""

from datetime import date

from app.services.odoo_finance import normalize_ref


def _to_date(v) -> date | None:
    if not v:
        return None
    try:
        return date.fromisoformat(str(v)[:10])
    except ValueError:
        return None


def _amount(b: dict) -> float:
    return round(float(b.get("amount_total") or 0.0), 2)


def exact_match(bill: dict, others: list[dict]) -> tuple[list[int], list[str], int]:
    """Same vendor + same normalized reference. The most confident tier."""
    ref = normalize_ref(bill.get("ref"))
    if not ref:
        return [], [], 0
    hits = [o["id"] for o in others if normalize_ref(o.get("ref")) == ref]
    if hits:
        return hits, [f"Same vendor and same invoice reference (‘{bill.get('ref')}’)"], 96
    return [], [], 0


def fuzzy_match(bill: dict, others: list[dict], *, window_days: int) -> tuple[list[int], list[str], int]:
    """Same vendor + same amount + date within a window, where the reference is missing or different.
    Catches the 'entered manually and via OCR' case."""
    amt = _amount(bill)
    if amt <= 0:
        return [], [], 0
    d = _to_date(bill.get("invoice_date"))
    ref = normalize_ref(bill.get("ref"))
    hits = []
    for o in others:
        if _amount(o) != amt:
            continue
        if normalize_ref(o.get("ref")) == ref and ref:
            continue  # that's the exact tier, not fuzzy
        od = _to_date(o.get("invoice_date"))
        if d and od and abs((d - od).days) > window_days:
            continue
        hits.append(o["id"])
    if hits:
        return hits, [f"Same vendor and identical amount ({amt:g}) within {window_days} days, reference differs"], 82
    return [], [], 0


def cross_vendor_match(
    bill: dict, partner: dict | None, others_by_partner: dict[int, list[dict]],
    *, same_vat_partner_ids: set[int], same_bank_partner_ids: set[int], window_days: int,
) -> tuple[list[int], list[str], int]:
    """Same amount billed under a DIFFERENT vendor record that shares this vendor's VAT or bank
    account - the classic 'ACME Inc' vs 'ACME Incorporated' split under one real supplier."""
    amt = _amount(bill)
    if amt <= 0:
        return [], [], 0
    related = same_vat_partner_ids | same_bank_partner_ids
    if not related:
        return [], [], 0
    d = _to_date(bill.get("invoice_date"))
    hits = []
    for pid in related:
        for o in others_by_partner.get(pid, []):
            if _amount(o) != amt:
                continue
            od = _to_date(o.get("invoice_date"))
            if d and od and abs((d - od).days) > window_days:
                continue
            hits.append(o["id"])
    if hits:
        why = "same Tax ID" if same_vat_partner_ids else "same bank account"
        return hits, [f"Identical amount ({amt:g}) billed under a different vendor record with the {why}"], 78
    return [], [], 0
