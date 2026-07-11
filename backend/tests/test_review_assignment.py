"""The shared review-assignment tool: assign_on_flag creates one activity per configured user, and
is a no-op when disabled or unconfigured (DB-gated)."""

from app.services import odoo_activity, review_assignment


def test_assign_on_flag_creates_one_activity_per_user(db, seeded, monkeypatch):
    calls = []
    monkeypatch.setattr(odoo_activity, "create_activity", lambda *a, **k: (calls.append(k), 1)[1])
    tid, sid = seeded["tenant"].id, seeded["ledger"].id

    # No config yet → no-op.
    assert review_assignment.assign_on_flag(db, object(), tenant_id=tid, sydekyk_id=sid,
                                            model="account.move", res_id=1, summary="x") == 0
    assert calls == []

    ra = review_assignment.get_or_create(db, tid, sid)
    ra.create_activity = True
    ra.odoo_user_ids = [5, 7]
    db.commit()

    made = review_assignment.assign_on_flag(db, object(), tenant_id=tid, sydekyk_id=sid,
                                            model="account.move", res_id=1, summary="Review this")
    assert made == 2 and len(calls) == 2
    assert {c["user_id"] for c in calls} == {5, 7}

    # Toggled off → no-op again even with users configured.
    ra.create_activity = False
    db.commit()
    calls.clear()
    assert review_assignment.assign_on_flag(db, object(), tenant_id=tid, sydekyk_id=sid,
                                            model="account.move", res_id=1, summary="x") == 0
    assert calls == []
