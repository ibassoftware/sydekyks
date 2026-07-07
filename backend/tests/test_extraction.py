"""Unit tests for bill-extraction JSON parsing/coercion (no network, no DB)."""

from app.sydekyks.ledger import extraction


def test_parse_json_plain():
    assert extraction._parse_json('{"a": 1}') == {"a": 1}


def test_parse_json_strips_markdown_fences():
    assert extraction._parse_json('```json\n{"a": 1}\n```') == {"a": 1}


def test_parse_json_extracts_outermost_block():
    assert extraction._parse_json('here you go: {"a": 1} thanks') == {"a": 1}


def test_parse_json_returns_none_on_garbage():
    assert extraction._parse_json("not json at all") is None


def test_coerce_fills_defaults_for_missing_fields():
    bill = extraction._coerce({})
    assert bill.vendor_name == "Unknown Vendor"
    assert bill.total == 0.0
    assert bill.line_items == []
    assert bill.invoice_number is None


def test_coerce_normalizes_currency_and_numbers():
    bill = extraction._coerce({
        "vendor_name": "ACME",
        "currency": "usd",
        "total": "88.00",
        "invoice_number": 42,
        "line_items": [{"description": "Widget", "quantity": "2", "unit_price": "25", "amount": "50"}],
    })
    assert bill.currency == "USD"
    assert bill.total == 88.0
    assert bill.invoice_number == "42"
    assert bill.line_items[0].quantity == 2.0
    assert bill.line_items[0].amount == 50.0


def test_document_to_image_uris_passthrough_for_images():
    uris, err = extraction.document_to_image_uris(b"\x89PNG fake", "image/png")
    assert err is None
    assert len(uris) == 1 and uris[0].startswith("data:image/png;base64,")


def test_document_to_image_uris_rasterizes_pdf_to_png():
    import io

    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (200, 200), "white").save(buf, format="PDF")
    uris, err = extraction.document_to_image_uris(buf.getvalue(), "application/pdf")
    assert err is None
    # A PDF becomes one-or-more PNG image parts (not a PDF data URI).
    assert len(uris) >= 1 and all(u.startswith("data:image/png;base64,") for u in uris)


def test_document_to_image_uris_caps_pdf_pages_at_three():
    import io

    from PIL import Image

    pages = [Image.new("RGB", (100, 100), "white") for _ in range(5)]
    buf = io.BytesIO()
    pages[0].save(buf, format="PDF", save_all=True, append_images=pages[1:])
    uris, err = extraction.document_to_image_uris(buf.getvalue(), "application/pdf")
    assert err is None
    assert len(uris) == 3  # capped, even though the PDF has 5 pages


def test_coerce_classification_defaults():
    c = extraction._coerce_classification({})
    assert c.is_bill is False
    assert c.document_type_guess == ""
    assert c.reason == ""


def test_coerce_classification_reads_fields():
    c = extraction._coerce_classification({
        "is_bill": True, "document_type_guess": "invoice", "reason": "has vendor, total, line items",
    })
    assert c.is_bill is True
    assert c.document_type_guess == "invoice"
    assert c.reason == "has vendor, total, line items"


def test_coerce_skips_unparseable_line_items():
    bill = extraction._coerce({
        "vendor_name": "ACME", "total": 10,
        "line_items": [{"description": "ok", "quantity": 1, "unit_price": 10, "amount": 10},
                       {"description": "bad", "quantity": "abc", "unit_price": None, "amount": None}],
    })
    # The malformed row is dropped, the good one survives.
    assert len(bill.line_items) == 1


def _fake_bill_for_match():
    return extraction.BillExtraction(vendor_name="ACME", total=88.0, currency="USD", tax_amount=8.0)


def test_match_bill_to_odoo_accepts_ids_actually_offered(monkeypatch):
    monkeypatch.setattr(
        extraction, "_llm_completion",
        lambda *a, **k: (True, "ok", {"currency_id": 1, "tax_id": 5, "account_id": 10, "reasoning": "matches"},
                         {"usage": None, "request_id": "r1", "model": "m", "cost_usd": 0.0}),
    )
    ok, msg, match, meta = extraction.match_bill_to_odoo(
        "vkey", "model", _fake_bill_for_match(),
        available_currencies=[{"id": 1, "name": "USD"}],
        available_taxes=[{"id": 5, "name": "10% VAT", "amount": 10}],
        available_accounts=[{"id": 10, "code": "6000", "name": "Office"}],
    )
    assert ok is True
    assert match.currency_id == 1
    assert match.tax_id == 5
    assert match.account_id == 10
    assert match.reasoning == "matches"


def test_match_bill_to_odoo_never_trusts_a_hallucinated_id(monkeypatch):
    """If the model returns an id that was never in the list we offered it, treat it as no match
    — never silently apply a currency/tax/account we didn't actually present as an option."""
    monkeypatch.setattr(
        extraction, "_llm_completion",
        lambda *a, **k: (True, "ok", {"currency_id": 999, "tax_id": 999, "account_id": 999, "reasoning": "hallucinated"},
                         {"usage": None, "request_id": "r1", "model": "m", "cost_usd": 0.0}),
    )
    ok, msg, match, meta = extraction.match_bill_to_odoo(
        "vkey", "model", _fake_bill_for_match(),
        available_currencies=[{"id": 1, "name": "USD"}],
        available_taxes=[{"id": 5, "name": "10% VAT", "amount": 10}],
        available_accounts=[{"id": 10, "code": "6000", "name": "Office"}],
    )
    assert ok is True
    assert match.currency_id is None
    assert match.tax_id is None
    assert match.account_id is None


def test_match_bill_to_odoo_passes_through_null_fields(monkeypatch):
    monkeypatch.setattr(
        extraction, "_llm_completion",
        lambda *a, **k: (True, "ok", {"currency_id": None, "tax_id": None, "account_id": None, "reasoning": "unsure"},
                         {"usage": None, "request_id": "r1", "model": "m", "cost_usd": 0.0}),
    )
    ok, msg, match, meta = extraction.match_bill_to_odoo(
        "vkey", "model", _fake_bill_for_match(), available_currencies=[], available_taxes=[], available_accounts=[],
    )
    assert ok is True
    assert match.currency_id is None and match.tax_id is None and match.account_id is None
