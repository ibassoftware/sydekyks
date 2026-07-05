"""End-to-end Mission execution with a fake Odoo + fake extraction (DB-gated).

Exercises the Ledger playbook success path, a setup-failure path (with failure_category), retry
lineage, and usage emission — all without a real Odoo or LLM.
"""

import uuid

import pytest
from sqlalchemy.orm import sessionmaker

from app.models.gadget_requirement import TenantSydekykGadgetAssignment, SydekykGadgetRequirement
from app.models.mission import Mission
from app.models.usage_record import UsageRecord
from app.services import missions as missions_svc
from app.sydekyks.ledger import extraction, odoo_bills, playbook
from app.services import odoo


def _fake_bill():
    return extraction.BillExtraction(
        vendor_name="ACME", total=88.0, invoice_number="INV-1", invoice_date="2026-07-01",
        currency="USD", llm_confidence=95,
        line_items=[extraction.BillLineItem("Widget", 2, 25.0, 50.0)],
    )


def _patch_happy_path(monkeypatch, engine):
    # run_mission opens its own SessionLocal — bind it to the test engine.
    monkeypatch.setattr(missions_svc, "SessionLocal", sessionmaker(bind=engine))

    monkeypatch.setattr(
        extraction, "extract_bill_data",
        lambda *a, **k: (True, "ok", _fake_bill(),
                         {"usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
                          "request_id": f"req-{uuid.uuid4()}", "model": "ledger-hosted"}),
    )
    monkeypatch.setattr(odoo, "connect", lambda *a, **k: (True, "ok", object()))
    monkeypatch.setattr(odoo, "find_partner", lambda *a, **k: {"id": 1, "name": "ACME"})
    monkeypatch.setattr(odoo_bills, "find_duplicate_bills", lambda *a, **k: [])
    monkeypatch.setattr(odoo_bills, "find_bills_near", lambda *a, **k: [])
    monkeypatch.setattr(odoo_bills, "get_historical_account_id", lambda *a, **k: 10)
    monkeypatch.setattr(odoo_bills, "default_expense_account_id", lambda *a, **k: 10)
    monkeypatch.setattr(odoo_bills, "create_vendor_bill", lambda *a, **k: (True, "ok", 100, []))
    monkeypatch.setattr(odoo_bills, "post_bill", lambda *a, **k: (True, "ok"))
    monkeypatch.setattr(odoo_bills, "read_bill", lambda *a, **k: {"name": "BILL/100"})


def _make_mission(db, seeded, signal="manual_upload"):
    return missions_svc.create_mission_for_document(
        db, tenant_id=seeded["tenant"].id, sydekyk=seeded["ledger"], user_id=None,
        document_bytes=b"fake-image-bytes", filename="bill.png", content_type="image/png",
        sha256_hash="abc", source="web_upload" if signal == "manual_upload" else "email", signal_type=signal,
    )


def test_playbook_success_and_usage(db, engine, seeded, monkeypatch):
    _patch_happy_path(monkeypatch, engine)
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
