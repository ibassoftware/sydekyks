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


def test_list_active_currencies():
    client = _FakeClient(search_read_results={"res.currency": [{"id": 1, "name": "USD"}, {"id": 2, "name": "EUR"}]})
    assert odoo.list_active_currencies(client) == [{"id": 1, "name": "USD"}, {"id": 2, "name": "EUR"}]


def test_list_active_purchase_taxes():
    client = _FakeClient(search_read_results={"account.tax": [{"id": 5, "name": "10% VAT", "amount": 10}]})
    assert odoo_bills.list_active_purchase_taxes(client) == [{"id": 5, "name": "10% VAT", "amount": 10}]


def test_list_expense_accounts():
    client = _FakeClient(search_read_results={"account.account": [{"id": 10, "code": "6000", "name": "Office Expenses"}]})
    assert odoo_bills.list_expense_accounts(client) == [{"id": 10, "code": "6000", "name": "Office Expenses"}]


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
