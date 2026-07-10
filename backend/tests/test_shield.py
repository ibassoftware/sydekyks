"""Unit tests for Shield's fraud-risk rules (no DB, no network)."""

from datetime import datetime

from app.sydekyks.shield import detection

NOW = datetime(2026, 7, 10, 12, 0, 0)


def test_bank_change_before_payment_fires_on_unpaid_recent_change():
    bill = {"payment_state": "not_paid"}
    banks = [{"acc_number": "X", "write_date": "2026-07-08 09:00:00"}]
    flag = detection.rule_bank_change_before_payment(bill, banks, recent_days=14, now=NOW)
    assert flag and flag["code"] == "bank_change_before_payment"
    # Paid bill → no hard-hold.
    assert detection.rule_bank_change_before_payment({"payment_state": "paid"}, banks, recent_days=14, now=NOW) is None
    # Stale change → no flag.
    old = [{"acc_number": "X", "write_date": "2026-01-01 09:00:00"}]
    assert detection.rule_bank_change_before_payment(bill, old, recent_days=14, now=NOW) is None


def test_employee_vendor_collision_by_bank_and_vat():
    vendor = {"vat": "ID-999"}
    banks = [{"sanitized_acc_number": "ACC1"}]
    assert detection.rule_employee_vendor_collision(vendor, banks, employee_bank_numbers={"ACC1"}, employee_ids=set())
    assert detection.rule_employee_vendor_collision(vendor, [], employee_bank_numbers=set(), employee_ids={"ID-999"})
    assert detection.rule_employee_vendor_collision(vendor, banks, employee_bank_numbers={"OTHER"}, employee_ids=set()) is None


def test_segregation_of_duties():
    assert detection.rule_segregation_of_duties(bill_creator=2, vendor_creator=2, payment_creator=None)
    assert detection.rule_segregation_of_duties(bill_creator=2, vendor_creator=9, payment_creator=2)
    assert detection.rule_segregation_of_duties(bill_creator=2, vendor_creator=9, payment_creator=5) is None


def test_phantom_vendor():
    bill = {"amount_total": 8000}
    vendor = {"create_date": "2026-07-05 10:00:00", "supplier_invoice_count": 1}
    assert detection.rule_phantom_vendor(bill, vendor, recent_days=14, high_amount=5000, now=NOW)
    # Established vendor → no flag.
    old_vendor = {"create_date": "2024-01-01 10:00:00", "supplier_invoice_count": 40}
    assert detection.rule_phantom_vendor(bill, old_vendor, recent_days=14, high_amount=5000, now=NOW) is None


def test_amount_above_norm_and_round_and_offhours():
    bill = {"amount_total": 9000, "create_date": "2026-07-11 22:30:00"}  # Sat 22:30
    history = [{"amount_total": 1000}, {"amount_total": 1200}, {"amount_total": 800}]
    assert detection.rule_amount_above_norm(bill, history)
    assert detection.rule_round_number({"amount_total": 9000})
    assert detection.rule_round_number({"amount_total": 1234.56}) is None
    assert detection.rule_off_hours_entry(bill)  # weekend + late


def test_score_and_hold():
    flags = [
        {"code": "bank_change_before_payment", "weight": 40},
        {"code": "round_number", "weight": 7},
    ]
    total, hold = detection.score(flags)
    assert total == 47 and hold is True
    assert detection.score([{"code": "round_number", "weight": 7}]) == (7, False)
