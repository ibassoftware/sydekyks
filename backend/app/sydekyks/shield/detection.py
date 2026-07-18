"""Shield's fraud-risk rules (deterministic). Each rule inspects the gathered context and either
fires a flag {code,label,weight,evidence} or returns None. The playbook gathers the Odoo data; these
functions stay pure and testable. Framing is always 'warrants review', never an accusation - an AI
step (extraction.py) turns the fired flags into the auditor-facing narrative.

Shield defers duplicate detection to Mirror, so there is deliberately no duplicate rule here.
"""

from datetime import datetime


def _parse_dt(v) -> datetime | None:
    if not v:
        return None
    try:
        return datetime.fromisoformat(str(v).replace("Z", "").split(".")[0])
    except ValueError:
        return None


def _san(banks: list[dict]) -> set[str]:
    return {str(b.get("sanitized_acc_number")) for b in banks if b.get("sanitized_acc_number")}


def rule_bank_change_before_payment(bill, vendor_banks, *, recent_days, now) -> dict | None:
    """The highest-ROI check (business-email-compromise): a vendor bank account created/edited right
    before an as-yet-unpaid bill. Hard-hold."""
    if bill.get("payment_state") not in ("not_paid", "partial", "in_payment"):
        return None
    for b in vendor_banks:
        touched = _parse_dt(b.get("write_date")) or _parse_dt(b.get("create_date"))
        if touched and (now - touched).days <= recent_days:
            return {
                "code": "bank_change_before_payment", "weight": 40,
                "label": "Vendor bank account changed just before an unpaid bill",
                "evidence": f"Bank account {b.get('acc_number') or '(hidden)'} was updated {(now - touched).days} day(s) ago and this bill is not yet paid.",
            }
    return None


def rule_employee_vendor_collision(vendor, vendor_banks, *, employee_bank_numbers, employee_ids) -> dict | None:
    """Vendor bank account or Tax ID matching an employee - shell-vendor / collusion signal."""
    shared = _san(vendor_banks) & employee_bank_numbers
    if shared:
        return {"code": "employee_vendor_collision", "weight": 35,
                "label": "Vendor shares a bank account with an employee",
                "evidence": "A bank account on this vendor matches an employee's bank account."}
    vat = (vendor or {}).get("vat")
    if vat and str(vat) in employee_ids:
        return {"code": "employee_vendor_collision", "weight": 35,
                "label": "Vendor Tax ID matches an employee identification",
                "evidence": f"Vendor Tax ID {vat} matches an employee's identification number."}
    return None


def rule_segregation_of_duties(*, bill_creator, vendor_creator, payment_creator) -> dict | None:
    """Same user created the vendor and entered the bill, or entered and paid it - an SoD break."""
    reasons = []
    if bill_creator and vendor_creator and bill_creator == vendor_creator:
        reasons.append("the vendor record was created by the same user who entered this bill")
    if bill_creator and payment_creator and bill_creator == payment_creator:
        reasons.append("the same user both entered and paid this bill")
    if reasons:
        return {"code": "segregation_of_duties", "weight": 22,
                "label": "Segregation-of-duties break",
                "evidence": "Review: " + "; ".join(reasons) + "."}
    return None


def rule_phantom_vendor(bill, vendor, *, recent_days, high_amount, now) -> dict | None:
    """Brand-new vendor, little/no history, high first invoice - a phantom-vendor marker."""
    created = _parse_dt((vendor or {}).get("create_date"))
    if not created or (now - created).days > recent_days:
        return None
    invoices = (vendor or {}).get("supplier_invoice_count") or 0
    amount = float(bill.get("amount_total") or 0.0)
    if invoices <= 1 and amount >= high_amount:
        return {"code": "phantom_vendor", "weight": 20,
                "label": "New vendor with a high first invoice",
                "evidence": f"Vendor created {(now - created).days} day(s) ago with {invoices} prior bill(s); this invoice is {amount:g}."}
    return None


def rule_amount_above_norm(bill, vendor_other_bills) -> dict | None:
    """This bill is well above the vendor's own historical norm (PO/history deviation, simplified)."""
    amounts = [float(o.get("amount_total") or 0.0) for o in vendor_other_bills if float(o.get("amount_total") or 0.0) > 0]
    if len(amounts) < 3:
        return None
    mean = sum(amounts) / len(amounts)
    amt = float(bill.get("amount_total") or 0.0)
    if mean > 0 and amt >= 3 * mean:
        return {"code": "amount_above_norm", "weight": 15,
                "label": "Amount well above this vendor's norm",
                "evidence": f"This bill ({amt:g}) is {amt / mean:.1f}× the vendor's average of {mean:.0f}."}
    return None


def rule_round_number(bill) -> dict | None:
    """Round-number amounts cluster in fabricated invoices."""
    amt = float(bill.get("amount_total") or 0.0)
    if amt >= 500 and amt == int(amt) and int(amt) % 100 == 0:
        return {"code": "round_number", "weight": 7,
                "label": "Suspiciously round amount",
                "evidence": f"The total ({amt:g}) is an exact round number."}
    return None


def rule_off_hours_entry(bill) -> dict | None:
    """Weekend / late-night bill entry is a mild anomaly worth noting."""
    created = _parse_dt(bill.get("create_date"))
    if not created:
        return None
    if created.weekday() >= 5 or created.hour < 6 or created.hour >= 20:
        when = "on a weekend" if created.weekday() >= 5 else f"at {created.hour:02d}:00"
        return {"code": "off_hours_entry", "weight": 7,
                "label": "Entered outside business hours",
                "evidence": f"This bill was entered {when}."}
    return None


def score(flags: list[dict]) -> tuple[int, bool]:
    """Combine fired flags into a 0-100 risk score + a hard-hold signal."""
    total = min(100, sum(int(f.get("weight", 0)) for f in flags))
    hold = any(f.get("code") == "bank_change_before_payment" for f in flags)
    return total, hold
