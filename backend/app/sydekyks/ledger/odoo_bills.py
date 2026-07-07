"""Ledger-specific Odoo vendor-bill operations (account.move / move_type='in_invoice').

Verified against a live Odoo 19.0 instance: the minimal working create field set is
partner_id + invoice_date + ref + invoice_line_ids[(0,0,{name,quantity,price_unit,account_id})];
journal and currency auto-default; action_post posts it.
"""

import base64

from app.services.odoo import OdooClient, OdooError

_EXPENSE_TYPES = ["expense", "expense_direct_cost"]

# Fields we already populate on create; any *other* required field on a custom instance triggers
# the adaptive-review path in create_vendor_bill.
_FIELDS_WE_SET = {"partner_id", "invoice_date", "ref", "invoice_line_ids", "move_type"}
# Required fields Odoo auto-defaults, so their absence from our payload is fine.
_AUTO_DEFAULTED = {"currency_id", "journal_id", "date", "auto_post", "name", "company_id", "state"}


def find_duplicate_bills(client: OdooClient, partner_id: int, invoice_number: str) -> list[dict]:
    return client.search_read(
        "account.move",
        [["move_type", "=", "in_invoice"], ["partner_id", "=", partner_id], ["ref", "=", invoice_number]],
        ["id", "name", "ref", "state", "amount_total"],
    )


def find_bills_near(client: OdooClient, partner_id: int, total: float, epsilon: float = 0.01) -> list[dict]:
    """Fallback duplicate lookup when the bill has no invoice number: same vendor + same total."""
    return client.search_read(
        "account.move",
        [
            ["move_type", "=", "in_invoice"],
            ["partner_id", "=", partner_id],
            ["amount_total", ">=", total - epsilon],
            ["amount_total", "<=", total + epsilon],
        ],
        ["id", "name", "ref", "state", "amount_total", "invoice_date"],
    )


def get_historical_account_id(client: OdooClient, partner_id: int) -> int | None:
    """Most-frequently-used expense account on this vendor's prior bills, or None."""
    lines = client.search_read(
        "account.move.line",
        [
            ["move_id.move_type", "=", "in_invoice"],
            ["move_id.partner_id", "=", partner_id],
            ["account_id.account_type", "in", _EXPENSE_TYPES],
        ],
        ["account_id"],
        limit=200,
    )
    counts: dict[int, int] = {}
    for line in lines:
        acct = line.get("account_id")
        if acct:
            counts[acct[0]] = counts.get(acct[0], 0) + 1
    if not counts:
        return None
    return max(counts, key=counts.get)


def default_expense_account_id(client: OdooClient) -> int | None:
    """Last-resort fallback if even AI-grounded matching (see extraction.match_bill_to_odoo)
    comes back empty: the first plain 'expense' account."""
    accts = client.search_read(
        "account.account", [["account_type", "=", "expense"]], ["id", "code"], limit=1
    )
    return accts[0]["id"] if accts else None


def list_expense_accounts(client: OdooClient) -> list[dict]:
    """The tenant's chart of accounts, filtered to expense-type accounts — so an AI matching a
    bill's line items (e.g. "software subscription" -> an IT/Software expense account) can choose
    from what's REALLY configured here, not just history or a single generic default."""
    return client.search_read(
        "account.account", [["account_type", "in", _EXPENSE_TYPES]], ["id", "code", "name"], limit=200
    )


def list_active_purchase_taxes(client: OdooClient) -> list[dict]:
    """Every active purchase tax configured in this Odoo instance — id, name, and rate — so an AI
    can match a bill's stated tax against a REAL, specific tax rate instead of the code defaulting
    to whatever happened to be set on the expense account."""
    return client.search_read(
        "account.tax", [["type_tax_use", "=", "purchase"], ["active", "=", True]], ["id", "name", "amount"]
    )


def create_vendor_bill(
    client: OdooClient,
    *,
    partner_id: int,
    invoice_number: str | None,
    invoice_date: str | None,
    account_id: int,
    line_items: list[dict],
    narration: str,
    currency_id: int | None = None,
    tax_ids: list[int] | None = None,
) -> tuple[bool, str, int | None, list[str]]:
    """Creates a draft vendor bill. Returns (ok, message, move_id, unmet_required_fields).

    `currency_id`/`tax_ids` are resolved by the playbook's currency/tax steps and passed in
    explicitly rather than left to Odoo's defaults — see PLAYBOOK_STEPS "resolve_currency" /
    "resolve_tax" for why (both are correctness fixes: Odoo previously silently used the company's
    default currency and no tax regardless of what the bill actually stated).

    On failure due to a missing required field (custom Odoo modules), introspects the model's
    required fields and reports the ones we didn't set — so the Mission surfaces exactly what's
    blocking rather than an opaque error."""
    line_tax_cmd = [(6, 0, tax_ids)] if tax_ids else []
    lines = [
        (
            0,
            0,
            {
                "name": li.get("description") or "Item",
                "quantity": li.get("quantity") or 1,
                "price_unit": li.get("unit_price") or li.get("amount") or 0,
                "account_id": account_id,
                **({"tax_ids": line_tax_cmd} if line_tax_cmd else {}),
            },
        )
        for li in (line_items or [{"description": "Bill total", "quantity": 1, "unit_price": 0, "amount": 0}])
    ]
    values: dict = {
        "move_type": "in_invoice",
        "partner_id": partner_id,
        "invoice_line_ids": lines,
        "narration": narration,
    }
    if invoice_number:
        values["ref"] = invoice_number
    if invoice_date:
        values["invoice_date"] = invoice_date
    if currency_id is not None:
        values["currency_id"] = currency_id

    try:
        move_id = client.create("account.move", values)
        return True, "created", move_id, []
    except OdooError as exc:
        # Adapt: figure out which required fields we didn't populate.
        try:
            required = set(client.required_fields("account.move"))
        except OdooError:
            required = set()
        unmet = sorted(required - _FIELDS_WE_SET - _AUTO_DEFAULTED)
        if unmet:
            return (
                False,
                f"Odoo requires field(s) Ledger couldn't populate: {', '.join(unmet)}. "
                "This instance likely has custom required fields — needs manual review.",
                None,
                unmet,
            )
        return False, f"Odoo rejected the vendor bill: {exc}", None, []


def post_bill(client: OdooClient, move_id: int) -> tuple[bool, str]:
    try:
        client.call("account.move", "action_post", [move_id])
        return True, "posted"
    except OdooError as exc:
        return False, f"Could not post the bill: {exc}"


def read_bill(client: OdooClient, move_id: int) -> dict | None:
    rows = client.execute_kw(
        "account.move", "read", [[move_id]], {"fields": ["name", "state", "amount_total", "currency_id"]}
    )
    return rows[0] if rows else None


def attach_document(
    client: OdooClient, *, move_id: int, filename: str, content_bytes: bytes, mimetype: str
) -> tuple[bool, str]:
    """Attach the original uploaded bill (PDF/image, not the rasterized OCR pages) to the vendor
    bill record as an ir.attachment, so a human reviewing it in Odoo sees the source evidence next
    to the extracted data — not just Ledger's interpretation of it."""
    try:
        client.create(
            "ir.attachment",
            {
                "name": filename,
                "datas": base64.b64encode(content_bytes).decode("ascii"),
                "res_model": "account.move",
                "res_id": move_id,
                "mimetype": mimetype,
            },
        )
        return True, "attached"
    except OdooError as exc:
        return False, f"Could not attach the original document: {exc}"
