"""End-to-end Mission execution with a fake Odoo + fake extraction (DB-gated).

Exercises the Ledger playbook success path, a setup-failure path (with failure_category), retry
lineage, usage emission, the opt-in auto-post gate, AI-grounded currency/tax/account matching, and
tax-config flagging — all without a real Odoo or LLM.
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


def _patch_happy_path(
    monkeypatch, engine, *, bill=None, is_bill=True,
    ai_currency_id=1, ai_tax_id=None, ai_account_id=None,
    fallback_currency_id=None, available_taxes=None, historical_account_id=10,
):
    # run_mission opens its own SessionLocal — bind it to the test engine.
    monkeypatch.setattr(missions_svc, "SessionLocal", sessionmaker(bind=engine))

    monkeypatch.setattr(
        extraction, "classify_document",
        lambda *a, **k: (True, "ok", extraction.DocumentClassification(
            is_bill=is_bill, document_type_guess="invoice" if is_bill else "photo",
            reason="looks like a vendor invoice" if is_bill else "no vendor/total/line items visible"),
                         {"usage": {"prompt_tokens": 4, "completion_tokens": 2, "total_tokens": 6},
                          "request_id": f"req-classify-{uuid.uuid4()}", "model": "ledger-hosted", "cost_usd": 0.0}),
    )
    monkeypatch.setattr(
        extraction, "extract_bill_data",
        lambda *a, **k: (True, "ok", bill or _fake_bill(),
                         {"usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
                          "request_id": f"req-extract-{uuid.uuid4()}", "model": "ledger-hosted", "cost_usd": 0.0042}),
    )
    monkeypatch.setattr(odoo, "connect", lambda *a, **k: (True, "ok", object()))
    monkeypatch.setattr(odoo, "find_partner", lambda *a, **k: {"id": 1, "name": "ACME"})
    # Fallback deterministic lookup — only exercised when the AI declines to match a currency.
    monkeypatch.setattr(odoo, "find_currency_id", lambda *a, **k: fallback_currency_id)
    monkeypatch.setattr(odoo, "list_active_currencies", lambda *a, **k: [{"id": 1, "name": "USD"}])
    monkeypatch.setattr(odoo_bills, "find_duplicate_bills", lambda *a, **k: [])
    monkeypatch.setattr(odoo_bills, "find_bills_near", lambda *a, **k: [])
    monkeypatch.setattr(odoo_bills, "get_historical_account_id", lambda *a, **k: historical_account_id)
    monkeypatch.setattr(odoo_bills, "default_expense_account_id", lambda *a, **k: 10)
    monkeypatch.setattr(
        odoo_bills, "list_expense_accounts",
        lambda *a, **k: [{"id": 10, "code": "6000", "name": "Office Expenses"}, {"id": 11, "code": "6100", "name": "Software"}],
    )
    taxes = available_taxes if available_taxes is not None else [{"id": 5, "name": "10% VAT", "amount": 10}]
    monkeypatch.setattr(odoo_bills, "list_active_purchase_taxes", lambda *a, **k: taxes)
    monkeypatch.setattr(
        extraction, "match_bill_to_odoo",
        lambda *a, **k: (True, "ok", extraction.BillMatch(
            currency_id=ai_currency_id, tax_id=ai_tax_id, account_id=ai_account_id, reasoning="matched"),
                         {"usage": {"prompt_tokens": 8, "completion_tokens": 4, "total_tokens": 12},
                          "request_id": f"req-match-{uuid.uuid4()}", "model": "ledger-hosted", "cost_usd": 0.0007}),
    )
    monkeypatch.setattr(odoo_bills, "create_vendor_bill", lambda *a, **k: (True, "ok", 100, []))
    monkeypatch.setattr(odoo_bills, "attach_document", lambda *a, **k: (True, "attached"))
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
    attach_step = next(s for s in done.steps if s.step_key == "attach_document")
    assert attach_step.status == "succeeded"
    account_step = next(s for s in done.steps if s.step_key == "infer_account")
    assert account_step.output["source"] == "history"  # historical lookup wins over AI suggestion
    # VS-15: a usage record was attributed to this Mission — one each for classify_document,
    # extract_bill_data, and match_bill_to_odoo (three distinct LLM calls).
    usage = db.query(UsageRecord).filter(UsageRecord.mission_id == mission.id).all()
    assert len(usage) == 3
    assert sum(u.total_tokens for u in usage) == 33  # 6 (classify) + 15 (extract) + 12 (match)
    assert round(sum(u.cost_usd for u in usage), 4) == 0.0049


def test_ai_matched_account_used_when_no_history(db, engine, seeded, monkeypatch):
    """A new vendor (no billing history) should get the AI's chart-of-accounts match, not the
    blind 'first expense account' fallback — and score a smaller confidence penalty for it."""
    _patch_happy_path(monkeypatch, engine, historical_account_id=None, ai_account_id=11)
    mission = _make_mission(db, seeded)

    missions_svc.run_mission(mission.id)

    db.expire_all()
    done = db.get(Mission, mission.id)
    account_step = next(s for s in done.steps if s.step_key == "infer_account")
    assert account_step.output["source"] == "ai_matched"
    assert account_step.output["account_id"] == 11


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
    """A stated currency that isn't enabled in Odoo must never be silently defaulted — neither the
    AI match nor the deterministic fallback found one."""
    _patch_happy_path(
        monkeypatch, engine, bill=_fake_bill(currency="EUR"), ai_currency_id=None, fallback_currency_id=None,
    )
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
        monkeypatch, engine, bill=_fake_bill(tax_amount=8.0), ai_tax_id=None, available_taxes=[],
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
    assert issues[0].mission_id == mission.id  # links to the bill for the "Open in Odoo" deep link

    # A second bill hitting the same gap upserts the SAME issue rather than creating a duplicate,
    # and repoints the link at the LATEST bill.
    mission2 = _make_mission(db, seeded)
    missions_svc.run_mission(mission2.id)
    db.expire_all()
    issues = db.query(TenantIssue).filter(TenantIssue.tenant_id == seeded["tenant"].id).all()
    assert len(issues) == 1
    assert issues[0].occurrence_count == 2
    assert issues[0].mission_id == mission2.id


def test_ai_matched_tax_applied_when_confident(db, engine, seeded, monkeypatch):
    """When the AI confidently matches a specific tax rate, that tax is applied and the bill is
    NOT flagged for review — unlike the old account-default-only behavior, a match anywhere in
    the instance's active purchase taxes is enough."""
    _patch_happy_path(monkeypatch, engine, bill=_fake_bill(tax_amount=8.0), ai_tax_id=5)
    _enable_auto_post(db, seeded["tenant"].id)
    mission = _make_mission(db, seeded)

    missions_svc.run_mission(mission.id)

    db.expire_all()
    done = db.get(Mission, mission.id)
    assert done.result_summary["needs_review"] is False
    assert done.result_summary["posted"] is True
    tax_step = next(s for s in done.steps if s.step_key == "resolve_tax")
    assert tax_step.output["tax_ids"] == [5]
    assert tax_step.output["source"] == "ai_matched"


def test_non_bill_document_rejected_before_extraction(db, engine, seeded, monkeypatch):
    """A photo/resume/random file must be rejected at classify_document — never reach extraction,
    never create anything in Odoo, and never be auto-retried (it's a validation failure)."""
    _patch_happy_path(monkeypatch, engine, is_bill=False)
    mission = _make_mission(db, seeded)

    missions_svc.run_mission(mission.id)

    db.expire_all()
    done = db.get(Mission, mission.id)
    assert done.status == "failed"
    assert done.failure_category == "validation"
    assert "doesn't look like a vendor bill" in done.error_message
    # Only the classify_document step ran — extract_bill_data never got a chance to run.
    step_keys = [s.step_key for s in done.steps]
    assert step_keys == ["classify_document"]
    # Only the classification call's usage was attributed — no extraction call happened.
    usage = db.query(UsageRecord).filter(UsageRecord.mission_id == mission.id).all()
    assert len(usage) == 1
    assert usage[0].total_tokens == 6


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
