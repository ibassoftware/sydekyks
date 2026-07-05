"""Ledger-specific Odoo vendor-bill operations (account.move / move_type='in_invoice').

Verified against a live Odoo 19.0 instance: the minimal working create field set is
partner_id + invoice_date + ref + invoice_line_ids[(0,0,{name,quantity,price_unit,account_id})];
journal and currency auto-default; action_post posts it.
"""

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
    """A reasonable generic fallback: the first plain 'expense' account."""
    accts = client.search_read(
        "account.account", [["account_type", "=", "expense"]], ["id", "code"], limit=1
    )
    return accts[0]["id"] if accts else None


def get_account_default_taxes(client: OdooClient, account_id: int) -> list[int]:
    """The purchase tax(es) configured as this expense account's default, if any."""
    rows = client.execute_kw("account.account", "read", [[account_id]], {"fields": ["tax_ids"]})
    if not rows:
        return []
    return rows[0].get("tax_ids") or []


def has_purchase_taxes_configured(client: OdooClient) -> bool:
    """Whether this Odoo instance has ANY active purchase tax defined at all — distinguishes
    "nobody set a default tax on this account" from "this instance has no tax config at all"."""
    rows = client.search_read(
        "account.tax", [["type_tax_use", "=", "purchase"], ["active", "=", True]], ["id"], limit=1
    )
    return bool(rows)


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
