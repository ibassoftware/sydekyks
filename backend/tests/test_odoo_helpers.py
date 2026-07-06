"""Unit tests for currency/tax Odoo lookups (fake client, no DB/network)."""

from app.services import odoo
from app.sydekyks.ledger import odoo_bills


class _FakeClient:
    """Duck-typed stand-in for OdooClient — the helpers only call search_read/execute_kw/create."""

    def __init__(self, search_read_results=None, execute_kw_results=None, raise_on=None):
        self._search_read_results = search_read_results or {}
        self._execute_kw_results = execute_kw_results or {}
        self._raise_on = raise_on or set()

    def search_read(self, model, domain, fields, limit=None):
        return self._search_read_results.get(model, [])

    def execute_kw(self, model, method, args, kwargs=None):
        if (model, method) in self._raise_on:
            raise odoo.OdooError(f"{model}.{method} failed")
        return self._execute_kw_results.get((model, method), [])

    def create(self, model, values):
        return self.execute_kw(model, "create", [values])


def test_find_currency_id_prefers_active_and_is_case_insensitive():
    client = _FakeClient(search_read_results={
        "res.currency": [{"id": 1, "active": False}, {"id": 2, "active": True}],
    })
    assert odoo.find_currency_id(client, "usd") == 2


def test_find_currency_id_returns_none_when_absent():
    client = _FakeClient(search_read_results={"res.currency": []})
    assert odoo.find_currency_id(client, "XYZ") is None


def test_get_account_default_taxes_reads_account_tax_ids():
    client = _FakeClient(execute_kw_results={("account.account", "read"): [{"tax_ids": [5, 6]}]})
    assert odoo_bills.get_account_default_taxes(client, 10) == [5, 6]


def test_get_account_default_taxes_empty_when_none_set():
    client = _FakeClient(execute_kw_results={("account.account", "read"): [{"tax_ids": False}]})
    assert odoo_bills.get_account_default_taxes(client, 10) == []


def test_has_purchase_taxes_configured():
    with_taxes = _FakeClient(search_read_results={"account.tax": [{"id": 1}]})
    without_taxes = _FakeClient(search_read_results={"account.tax": []})
    assert odoo_bills.has_purchase_taxes_configured(with_taxes) is True
    assert odoo_bills.has_purchase_taxes_configured(without_taxes) is False


def test_attach_document_success():
    client = _FakeClient(execute_kw_results={("ir.attachment", "create"): 999})
    ok, msg = odoo_bills.attach_document(
        client, move_id=5, filename="bill.pdf", content_bytes=b"%PDF-1.4", mimetype="application/pdf"
    )
    assert ok is True
    assert msg == "attached"


def test_attach_document_failure_is_reported_not_raised():
    """A failed attachment must never propagate as an exception — the caller (playbook) treats it
    as best-effort and keeps the already-created bill."""
    client = _FakeClient(raise_on={("ir.attachment", "create")})
    ok, msg = odoo_bills.attach_document(
        client, move_id=5, filename="bill.pdf", content_bytes=b"x", mimetype="application/pdf"
    )
    assert ok is False
    assert "Could not attach" in msg
