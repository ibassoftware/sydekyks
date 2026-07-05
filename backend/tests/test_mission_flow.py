"""End-to-end Mission execution with a fake Odoo + fake extraction (DB-gated).

Exercises the Ledger playbook success path, a setup-failure path (with failure_category), retry
lineage, usage emission, the opt-in auto-post gate, currency resolution, and tax-config flagging —
all without a real Odoo or LLM.
"""

import uuid

import pytest
from sqlalchemy.orm import sessionmaker

from app.models.gadget_requirement import TenantSydekykGadgetAssignment, SydekykGadgetRequirement
from app.models.mission import Mission
from app.models.tenant_issue import TenantIssue
from app.models.usage_record import UsageRecord
from app.services import missions as missions_svc
from app.sydekyks.ledger import extraction, odoo_bills, playbook
from app.sydekyks.ledger.models import LedgerTenantSettings
from app.services import odoo


def _fake_bill(currency="USD", tax_amount=None):
    return extraction.BillExtraction(
        vendor_name="ACME", total=88.0, invoice_number="INV-1", invoice_date="2026-07-01",
        currency=currency, llm_confidence=95, tax_amount=tax_amount,
        line_items=[extraction.BillLineItem("Widget", 2, 25.0, 50.0)],
    )


def _patch_happy_path(monkeypatch, engine, *, bill=None, currency_id=1, account_tax_ids=None, any_purchase_tax=True):
    # run_mission opens its own SessionLocal — bind it to the test engine.
    monkeypatch.setattr(missions_svc, "SessionLocal", sessionmaker(bind=engine))

    monkeypatch.setattr(
        extraction, "extract_bill_data",
        lambda *a, **k: (True, "ok", bill or _fake_bill(),
                         {"usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
                          "request_id": f"req-{uuid.uuid4()}", "model": "ledger-hosted", "cost_usd": 0.0042}),
    )
    monkeypatch.setattr(odoo, "connect", lambda *a, **k: (True, "ok", object()))
    monkeypatch.setattr(odoo, "find_partner", lambda *a, **k: {"id": 1, "name": "ACME"})
    monkeypatch.setattr(odoo, "find_currency_id", lambda *a, **k: currency_id)
    monkeypatch.setattr(odoo_bills, "find_duplicate_bills", lambda *a, **k: [])
    monkeypatch.setattr(odoo_bills, "find_bills_near", lambda *a, **k: [])
    monkeypatch.setattr(odoo_bills, "get_historical_account_id", lambda *a, **k: 10)
    monkeypatch.setattr(odoo_bills, "default_expense_account_id", lambda *a, **k: 10)
    monkeypatch.setattr(odoo_bills, "get_account_default_taxes", lambda *a, **k: account_tax_ids or [])
    monkeypatch.setattr(odoo_bills, "has_purchase_taxes_configured", lambda *a, **k: any_purchase_tax)
    monkeypatch.setattr(odoo_bills, "create_vendor_bill", lambda *a, **k: (True, "ok", 100, []))
    monkeypatch.setattr(odoo_bills, "post_bill", lambda *a, **k: (True, "ok"))
    monkeypatch.setattr(odoo_bills, "read_bill", lambda *a, **k: {"name": "BILL/100"})


def _make_mission(db, seeded, signal="manual_upload"):
    return missions_svc.create_mission_for_document(
        db, tenant_id=seeded["tenant"].id, sydekyk=seeded["ledger"], user_id=None,
        document_bytes=b"fake-image-bytes", filename="bill.png", content_type="image/png",
        sha256_hash="abc", source="web_upload" if signal == "manual_upload" else "email", signal_type=signal,
    )


def _enable_auto_post(db, tenant_id, threshold=90):
    s = db.query(LedgerTenantSettings).filter(LedgerTenantSettings.tenant_id == tenant_id).first()
    if s is None:
        s = LedgerTenantSettings(tenant_id=tenant_id)
        db.add(s)
    s.auto_post_enabled = True
    s.auto_post_threshold = threshold
    db.commit()


def test_playbook_success_and_usage(db, engine, seeded, monkeypatch):
    _patch_happy_path(monkeypatch, engine)
    _enable_auto_post(db, seeded["tenant"].id)  # auto-post is opt-in (default False)
    mission = _make_mission(db, seeded)

    missions_svc.run_mission(mission.id)

    db.expire_all()
    done = db.get(Mission, mission.id)
    assert done.status == "succeeded"
    assert done.result_summary["posted"] is True
    assert done.result_summary["odoo_move_id"] == 100
    # VS-15: a usage record was attributed to this Mission.
    usage = db.query(UsageRecord).filter(UsageRecord.mission_id == mission.id).all()
    assert len(usage) == 1
    assert usage[0].total_tokens == 15
    assert usage[0].cost_usd == 0.0042  # VS-15: per-call cost captured from LiteLLM header


def test_auto_post_disabled_by_default_never_posts(db, engine, seeded, monkeypatch):
    """Even at 95% confidence, a bill never auto-posts unless auto_post_enabled is explicitly on."""
    _patch_happy_path(monkeypatch, engine)
    mission = _make_mission(db, seeded)

    missions_svc.run_mission(mission.id)

    db.expire_all()
    done = db.get(Mission, mission.id)
    assert done.status == "succeeded"
    assert done.result_summary["posted"] is False
    assert done.result_summary["odoo_move_id"] == 100  # still created as a draft


def test_unresolvable_currency_blocks_bill_creation(db, engine, seeded, monkeypatch):
    """A stated currency that isn't enabled in Odoo must never be silently defaulted."""
    _patch_happy_path(monkeypatch, engine, bill=_fake_bill(currency="EUR"), currency_id=None)
    _enable_auto_post(db, seeded["tenant"].id)
    mission = _make_mission(db, seeded)

    missions_svc.run_mission(mission.id)

    db.expire_all()
    done = db.get(Mission, mission.id)
    assert done.status == "succeeded"
    assert done.result_summary["needs_review"] is True
    assert "EUR" in done.result_summary["review_reason"]
    assert "odoo_move_id" not in done.result_summary  # no bill created


def test_missing_tax_config_blocks_auto_post_and_reports_issue(db, engine, seeded, monkeypatch):
    """A bill with tax but no matching Odoo tax config: draft is created, never auto-posted, and a
    standing TenantIssue is opened (upserted, not duplicated per Mission)."""
    _patch_happy_path(
        monkeypatch, engine, bill=_fake_bill(tax_amount=8.0),
        account_tax_ids=[], any_purchase_tax=False,
    )
    _enable_auto_post(db, seeded["tenant"].id)

    mission = _make_mission(db, seeded)
    missions_svc.run_mission(mission.id)

    db.expire_all()
    done = db.get(Mission, mission.id)
    assert done.status == "succeeded"
    assert done.result_summary["odoo_move_id"] == 100  # draft still created
    assert done.result_summary["posted"] is False  # never auto-posted despite high confidence
    assert done.result_summary["needs_review"] is True

    issues = db.query(TenantIssue).filter(TenantIssue.tenant_id == seeded["tenant"].id).all()
    assert len(issues) == 1
    assert issues[0].kind == "missing_tax_config"
    assert issues[0].occurrence_count == 1

    # A second bill hitting the same gap upserts the SAME issue rather than creating a duplicate.
    mission2 = _make_mission(db, seeded)
    missions_svc.run_mission(mission2.id)
    db.expire_all()
    issues = db.query(TenantIssue).filter(TenantIssue.tenant_id == seeded["tenant"].id).all()
    assert len(issues) == 1
    assert issues[0].occurrence_count == 2


def test_missing_odoo_marks_setup_failure(db, engine, seeded, monkeypatch):
    _patch_happy_path(monkeypatch, engine)
    # Remove the Odoo assignment so the playbook fails at connect_odoo.
    req = db.query(SydekykGadgetRequirement).filter(
        SydekykGadgetRequirement.sydekyk_id == seeded["ledger"].id,
        SydekykGadgetRequirement.role_key == "erp",
    ).first()
    db.query(TenantSydekykGadgetAssignment).filter(
        TenantSydekykGadgetAssignment.requirement_id == req.id
    ).delete()
    db.commit()

    mission = _make_mission(db, seeded)
    missions_svc.run_mission(mission.id)

    db.expire_all()
    done = db.get(Mission, mission.id)
    assert done.status == "failed"
    assert done.failure_category == "setup"


def test_retry_creates_linked_mission(db, engine, seeded, monkeypatch):
    _patch_happy_path(monkeypatch, engine)
    original = _make_mission(db, seeded)
    original.status = "failed"
    original.failure_category = "setup"
    db.commit()

    retried = missions_svc.retry_mission(db, original)
    assert retried.parent_mission_id == original.id
    assert retried.root_mission_id == original.id
    assert retried.attempt_number == 2
    assert retried.playbook_key == original.playbook_key
    # A non-failed Mission cannot be retried.
    with pytest.raises(ValueError):
        missions_svc.retry_mission(db, retried)
