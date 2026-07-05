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


def test_coerce_skips_unparseable_line_items():
    bill = extraction._coerce({
        "vendor_name": "ACME", "total": 10,
        "line_items": [{"description": "ok", "quantity": 1, "unit_price": 10, "amount": 10},
                       {"description": "bad", "quantity": "abc", "unit_price": None, "amount": None}],
    })
    # The malformed row is dropped, the good one survives.
    assert len(bill.line_items) == 1
