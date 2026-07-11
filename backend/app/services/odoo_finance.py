"""Shared Odoo accounts-payable reads for the audit agents (Mirror = duplicate detection, Shield =
fraud risk). Built on the generic OdooClient; field names verified against Odoo 18's account.move /
account.move.line / res.partner / res.partner.bank but read defensively so it survives versions.
"""

import re

from app.services import odoo
from app.services.odoo import OdooClient, OdooError

# The columns both agents need on a vendor bill.
BILL_FIELDS = [
    "id", "name", "ref", "partner_id", "commercial_partner_id", "amount_total", "amount_untaxed",
    "currency_id", "invoice_date", "invoice_date_due", "state", "payment_state", "move_type",
    "create_uid", "create_date", "write_date", "partner_bank_id", "invoice_origin", "payment_ids",
]


def normalize_ref(ref: str | None) -> str:
    """Aggressively normalize a vendor invoice reference so "INV-0012", "inv 12" and "#12" collapse
    to the same key: lower-case, drop everything non-alphanumeric, strip a common leading prefix
    (INV/BILL/REF/NO), then strip leading zeros. Returns "" for an empty/blank reference."""
    if not ref:
        return ""
    s = re.sub(r"[^a-z0-9]+", "", str(ref).lower())
    s = re.sub(r"^(invoice|inv|bill|ref|no)+", "", s)
    s = s.lstrip("0")
    return s


def read_bill(client: OdooClient, move_id: int, fields: list[str] | None = None) -> dict | None:
    rows = client.execute_kw("account.move", "read", [[move_id]], {"fields": fields or BILL_FIELDS})
    return rows[0] if rows else None


def bill_lines(client: OdooClient, move_id: int) -> list[dict]:
    """The product lines of a bill — label, product, qty, unit price, subtotal — for line-item
    comparison (Mirror) and PO/history deviation (Shield)."""
    rows = client.search_read(
        "account.move.line",
        [["move_id", "=", move_id], ["display_type", "=", False]],
        ["name", "product_id", "quantity", "price_unit", "price_subtotal"],
    )
    return rows


DEFAULT_STATES = ["draft", "posted"]


def list_recent_bills(
    client: OdooClient, *, since: str | None, cutoff: str, limit: int = 30, states: list[str] | None = None
) -> list[dict]:
    """Vendor bills created on/after `cutoff` (and strictly after the `since` watermark when given),
    oldest first, so the agent scans forward from where it last checked. `states` limits which move
    states are scanned (e.g. ["posted"] to skip unposted drafts)."""
    domain: list = [
        ["move_type", "=", "in_invoice"],
        ["state", "in", states or DEFAULT_STATES],
        ["create_date", ">=", cutoff],
    ]
    if since:
        domain.append(["create_date", ">", since])
    return client.execute_kw(
        "account.move", "search_read", [domain],
        {"fields": BILL_FIELDS, "order": "create_date asc, id asc", "limit": limit},
    )


def search_vendor_bills(
    client: OdooClient, *, partner_id: int | None = None, exclude_id: int | None = None,
    fields: list[str] | None = None, limit: int = 200, states: list[str] | None = None,
) -> list[dict]:
    """Other vendor bills to compare a candidate against (optionally scoped to one vendor / states)."""
    domain: list = [["move_type", "=", "in_invoice"], ["state", "in", states or DEFAULT_STATES]]
    if partner_id:
        domain.append(["partner_id", "=", partner_id])
    if exclude_id:
        domain.append(["id", "!=", exclude_id])
    return client.execute_kw(
        "account.move", "search_read", [domain], {"fields": fields or BILL_FIELDS, "limit": limit}
    )


def partner_info(client: OdooClient, partner_id: int) -> dict | None:
    """Vendor profile used for cross-vendor and phantom-vendor checks."""
    fields = [
        "id", "name", "commercial_company_name", "vat", "same_vat_partner_id", "bank_ids",
        "supplier_invoice_count", "supplier_rank", "create_uid", "create_date", "email", "phone",
        "street", "street2",
    ]
    rows = client.execute_kw("res.partner", "read", [[partner_id]], {"fields": fields})
    return rows[0] if rows else None


def bank_accounts(client: OdooClient, partner_id: int) -> list[dict]:
    return client.search_read(
        "res.partner.bank", [["partner_id", "=", partner_id]],
        ["id", "acc_number", "sanitized_acc_number", "acc_holder_name", "write_date", "create_date"],
    )


def post_bill_note(client: OdooClient, move_id: int, body: str) -> tuple[bool, str]:
    return odoo.post_message(client, model="account.move", res_id=move_id, body=body)


# --- Shield helpers: employee cross-check + who paid the bill -----------------------------------


def employee_bank_numbers(client: OdooClient) -> set[str]:
    """Sanitized bank-account numbers belonging to employees — to catch a vendor bank matching an
    employee's (shell-vendor / collusion). Empty set if the HR module isn't installed."""
    try:
        emps = client.search_read("hr.employee", [["bank_account_ids", "!=", False]], ["bank_account_ids"], limit=1000)
    except OdooError:
        return set()
    bank_ids = {bid for e in emps for bid in (e.get("bank_account_ids") or [])}
    if not bank_ids:
        return set()
    banks = client.search_read("res.partner.bank", [["id", "in", list(bank_ids)]], ["sanitized_acc_number"])
    return {str(b["sanitized_acc_number"]) for b in banks if b.get("sanitized_acc_number")}


def employee_identifications(client: OdooClient) -> set[str]:
    """Employee identification numbers — to catch a vendor Tax ID matching an employee's ID."""
    try:
        emps = client.search_read("hr.employee", [["identification_id", "!=", False]], ["identification_id"], limit=2000)
    except OdooError:
        return set()
    return {str(e["identification_id"]) for e in emps if e.get("identification_id")}


def bill_payment_creator_uid(client: OdooClient, bill: dict) -> int | None:
    """The user who created a payment against this bill (for the segregation-of-duties check)."""
    pay_ids = bill.get("payment_ids") or []
    if not pay_ids:
        return None
    rows = client.execute_kw("account.payment", "read", [pay_ids], {"fields": ["create_uid"]})
    for r in rows:
        cu = r.get("create_uid")
        if isinstance(cu, list) and cu:
            return cu[0]
    return None
