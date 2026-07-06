"""Tenant Issue resolve/reopen cycle (DB-gated)."""

from app.core.security import hash_password
from app.models.tenant_issue import TenantIssue
from app.models.user import User
from app.services import tenant_issues


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
