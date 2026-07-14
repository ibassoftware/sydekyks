"""Odoo Sales (`sale.order`) helpers — the first `sale.order` integration in the platform.

Version-safe like the rest of the Odoo layer: discover fields at runtime, never confirm an order
(draft quotations only), and degrade gracefully. Used by Quill to optionally spin a draft quotation
off a proposal, read it back, fetch its official PDF, and attach the merged proposal PDF to it.
Reusable by any future Sales Sydekyk (e.g. Comparex).
"""

from app.services import odoo


def _rel(v):
    if isinstance(v, list) and len(v) > 1:
        return v[1]
    return None


def create_quotation(client: odoo.OdooClient, *, partner_id: int, lines: list[dict] | None = None) -> int:
    """Create a DRAFT sale.order for a partner. Returns the order id. Lines are added best-effort
    afterwards (a stock sale.order.line requires a product on many instances, so a free-text line may
    be rejected — we never let that fail the quotation)."""
    order_id = client.create("sale.order", {"partner_id": int(partner_id)})
    for line in lines or []:
        _add_line_best_effort(client, order_id, line)
    return order_id


def _add_line_best_effort(client: odoo.OdooClient, order_id: int, line: dict) -> None:
    values = {
        "order_id": order_id,
        "name": str(line.get("name") or "").strip() or "Item",
        "product_uom_qty": float(line.get("quantity") or 1.0),
        "price_unit": float(line.get("price_unit") or 0.0),
    }
    try:
        client.create("sale.order.line", values)
    except odoo.OdooError:
        # Instance requires a product on order lines — skip this line rather than fail the quotation.
        pass


def read_order(client: odoo.OdooClient, order_id: int) -> dict | None:
    rows = client.execute_kw(
        "sale.order", "read", [[int(order_id)]],
        {"fields": ["name", "state", "amount_total", "currency_id", "partner_id"]},
    )
    if not rows:
        return None
    r = rows[0]
    return {
        "id": r["id"],
        "name": r.get("name"),
        "state": r.get("state"),
        "amount_total": r.get("amount_total"),
        "currency": _rel(r.get("currency_id")),
        "partner": _rel(r.get("partner_id")),
    }


def partner_id_for_lead(client: odoo.OdooClient, lead_id: int) -> int | None:
    """The res.partner id linked to a crm.lead, if any (so a quotation can be raised for that customer)."""
    try:
        rows = client.execute_kw("crm.lead", "read", [[int(lead_id)]], {"fields": ["partner_id"]})
    except odoo.OdooError:
        return None
    if not rows:
        return None
    v = rows[0].get("partner_id")
    return int(v[0]) if isinstance(v, list) and v else None


def fetch_quotation_pdf(client: odoo.OdooClient, order_id: int) -> bytes | None:
    """Best-effort fetch of the official quotation PDF from Odoo. Rendering a QWeb report over XML-RPC
    is version-dependent and may not marshal binary cleanly on every instance — on any failure we
    return None so the caller falls back to the proposal-only PDF rather than erroring."""
    import base64

    for report_ref in ("sale.report_saleorder", "sale.action_report_saleorder"):
        for method in ("_render_qweb_pdf", "render_qweb_pdf"):
            try:
                result = client.execute_kw("ir.actions.report", method, [report_ref, [int(order_id)]])
            except odoo.OdooError:
                continue
            data = result[0] if isinstance(result, (list, tuple)) and result else result
            raw = _coerce_pdf_bytes(data, base64)
            if raw:
                return raw
    return None


def _coerce_pdf_bytes(data, base64_mod) -> bytes | None:
    if data is None:
        return None
    # xmlrpc may hand back a Binary wrapper, raw bytes, or a base64 string.
    if hasattr(data, "data"):
        data = data.data
    if isinstance(data, bytes):
        return data if data[:4] == b"%PDF" else None
    if isinstance(data, str):
        try:
            decoded = base64_mod.b64decode(data)
        except (ValueError, TypeError):
            return None
        return decoded if decoded[:4] == b"%PDF" else None
    return None
