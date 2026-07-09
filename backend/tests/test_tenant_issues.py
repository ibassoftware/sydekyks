"""Tenant Issue resolve/reopen cycle (DB-gated)."""

from app.core.security import hash_password
from app.models.mission import Mission
from app.models.tenant_issue import TenantIssue
from app.models.user import User
from app.services import tenant_issues


def _make_mission(db, seeded, result_summary=None):
    mission = Mission(
        tenant_id=seeded["tenant"].id, sydekyk_id=seeded["ledger"].id, mode="workflow_run",
        signal_type="manual_upload", playbook_key="ledger.vendor_bill_ingest", status="succeeded",
        result_summary=result_summary,
    )
    db.add(mission)
    db.commit()
    db.refresh(mission)
    return mission


def _make_commander(db, tenant_id):
    user = User(tenant_id=tenant_id, email="commander@test.local", hashed_password=hash_password("x"), role="commander")
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def test_report_issue_upserts_by_tenant_sydekyk_kind(db, seeded):
    tenant_id = seeded["tenant"].id
    sydekyk_id = seeded["ledger"].id

    first = tenant_issues.report_issue(
        db, tenant_id=tenant_id, sydekyk_id=sydekyk_id, kind="missing_tax_config",
        title="t", detail="first",
    )
    second = tenant_issues.report_issue(
        db, tenant_id=tenant_id, sydekyk_id=sydekyk_id, kind="missing_tax_config",
        title="t", detail="second",
    )

    assert first.id == second.id
    assert second.occurrence_count == 2
    assert second.detail == "second"
    assert db.query(TenantIssue).filter(TenantIssue.tenant_id == tenant_id).count() == 1


def test_resolve_then_reopen_cycle(db, seeded):
    tenant_id = seeded["tenant"].id
    issue = tenant_issues.report_issue(
        db, tenant_id=tenant_id, sydekyk_id=seeded["ledger"].id, kind="missing_tax_config",
        title="t", detail="d",
    )
    commander = _make_commander(db, tenant_id)

    tenant_issues.resolve_issue(db, issue, commander.id)
    db.refresh(issue)
    assert issue.status == "resolved"
    assert issue.resolved_at is not None
    assert issue.resolved_by_user_id == commander.id

    tenant_issues.reopen_issue(db, issue)
    db.refresh(issue)
    assert issue.status == "open"
    assert issue.resolved_at is None
    assert issue.resolved_by_user_id is None
    # Reopening doesn't fabricate a new detection — occurrence_count is untouched.
    assert issue.occurrence_count == 1


def test_recurring_issue_reopens_itself_if_already_resolved(db, seeded):
    """If a Commander resolved an issue but the underlying config gap wasn't actually fixed, the
    NEXT bill that hits the same gap should re-open it automatically — a human-marked resolution
    shouldn't silently swallow a still-present problem."""
    tenant_id = seeded["tenant"].id
    issue = tenant_issues.report_issue(
        db, tenant_id=tenant_id, sydekyk_id=seeded["ledger"].id, kind="missing_tax_config",
        title="t", detail="d",
    )
    commander = _make_commander(db, tenant_id)
    tenant_issues.resolve_issue(db, issue, commander.id)
    db.refresh(issue)
    assert issue.status == "resolved"

    recurred = tenant_issues.report_issue(
        db, tenant_id=tenant_id, sydekyk_id=seeded["ledger"].id, kind="missing_tax_config",
        title="t", detail="still happening",
    )
    assert recurred.id == issue.id
    assert recurred.status == "open"
    assert recurred.resolved_at is None
    assert recurred.occurrence_count == 2


def test_resolve_odoo_bill_url_none_without_linked_mission(db, seeded):
    issue = tenant_issues.report_issue(
        db, tenant_id=seeded["tenant"].id, sydekyk_id=seeded["ledger"].id, kind="missing_tax_config",
        title="t", detail="d",
    )
    assert issue.mission_id is None
    assert tenant_issues.resolve_odoo_bill_url(db, issue) is None


def test_resolve_odoo_bill_url_none_without_move_id(db, seeded):
    mission = _make_mission(db, seeded, result_summary={"needs_review": True})  # no odoo_move_id
    issue = tenant_issues.report_issue(
        db, tenant_id=seeded["tenant"].id, sydekyk_id=seeded["ledger"].id, kind="missing_tax_config",
        title="t", detail="d", mission_id=mission.id,
    )
    assert tenant_issues.resolve_odoo_bill_url(db, issue) is None


def test_resolve_odoo_bill_url_builds_link_when_bill_exists(db, seeded):
    """seeded fixture's Odoo link has url='http://odoo' and is assigned to Ledger's 'erp' role."""
    mission = _make_mission(db, seeded, result_summary={"odoo_move_id": 42})
    issue = tenant_issues.report_issue(
        db, tenant_id=seeded["tenant"].id, sydekyk_id=seeded["ledger"].id, kind="missing_tax_config",
        title="t", detail="d", mission_id=mission.id,
    )
    url = tenant_issues.resolve_odoo_bill_url(db, issue)
    assert url == "http://odoo/web#id=42&model=account.move&view_type=form"


def test_build_mission_record_link_for_applicant(db, seeded):
    """Decode/Scout summaries carry an applicant_id → a deep link to the hr.applicant form, with a
    label. A bill-only summary yields no generic record link (bills keep their own odoo_bill_url)."""
    from app.services import gadget_links

    url, label = gadget_links.build_mission_record_link(
        db, tenant_id=seeded["tenant"].id, sydekyk_id=seeded["ledger"].id,
        summary={"applicant_id": 7, "applicant_name": "Jane"},
    )
    assert url == "http://odoo/web#id=7&model=hr.applicant&view_type=form"
    assert label == "Open applicant in Odoo"

    none_url, none_label = gadget_links.build_mission_record_link(
        db, tenant_id=seeded["tenant"].id, sydekyk_id=seeded["ledger"].id,
        summary={"odoo_move_id": 42},
    )
    assert none_url is None and none_label is None


def test_report_issue_updates_mission_id_on_recurrence(db, seeded):
    """The link should always point at the LATEST bill, not the first one that hit the gap."""
    mission1 = _make_mission(db, seeded, result_summary={"odoo_move_id": 1})
    mission2 = _make_mission(db, seeded, result_summary={"odoo_move_id": 2})

    tenant_issues.report_issue(
        db, tenant_id=seeded["tenant"].id, sydekyk_id=seeded["ledger"].id, kind="missing_tax_config",
        title="t", detail="d", mission_id=mission1.id,
    )
    updated = tenant_issues.report_issue(
        db, tenant_id=seeded["tenant"].id, sydekyk_id=seeded["ledger"].id, kind="missing_tax_config",
        title="t", detail="d", mission_id=mission2.id,
    )
    assert updated.mission_id == mission2.id
    assert tenant_issues.resolve_odoo_bill_url(db, updated) == "http://odoo/web#id=2&model=account.move&view_type=form"
