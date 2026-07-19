"""Self-service password change + commander resetting a team member's password."""

import pytest
from fastapi import HTTPException

from app.core.security import hash_password, verify_password
from app.models.tenant import Tenant
from app.models.user import User
from app.routers.auth import change_password
from app.routers.team import reset_user_password
from app.schemas.auth import ChangePasswordRequest
from app.schemas.team import TeamUserPasswordReset


def _mk(db, *, tenant, email, role, pw="original-pw"):
    u = User(tenant_id=tenant.id if tenant else None, email=email, hashed_password=hash_password(pw), role=role)
    db.add(u)
    db.flush()
    return u


def _tenant(db):
    t = Tenant(name="Acme", slug="acme")
    db.add(t)
    db.flush()
    return t


def test_change_own_password_requires_correct_current(db):
    t = _tenant(db)
    hero = _mk(db, tenant=t, email="hero@acme.test", role="hero")
    db.commit()

    with pytest.raises(HTTPException) as exc:
        change_password(ChangePasswordRequest(current_password="wrong", new_password="brand-new-pw"), user=hero, db=db)
    assert exc.value.status_code == 400

    change_password(ChangePasswordRequest(current_password="original-pw", new_password="brand-new-pw"), user=hero, db=db)
    db.refresh(hero)
    assert verify_password("brand-new-pw", hero.hashed_password)


def test_change_password_rejects_reusing_current(db):
    t = _tenant(db)
    hero = _mk(db, tenant=t, email="h@acme.test", role="hero")
    db.commit()
    with pytest.raises(HTTPException) as exc:
        change_password(ChangePasswordRequest(current_password="original-pw", new_password="original-pw"), user=hero, db=db)
    assert exc.value.status_code == 400


def test_commander_resets_member_password(db):
    t = _tenant(db)
    commander = _mk(db, tenant=t, email="cmd@acme.test", role="commander")
    hero = _mk(db, tenant=t, email="hero@acme.test", role="hero")
    db.commit()

    reset_user_password(hero.id, TeamUserPasswordReset(password="reset-by-cmd"), user=commander, db=db)
    db.refresh(hero)
    assert verify_password("reset-by-cmd", hero.hashed_password)


def test_commander_cannot_reset_own_via_team_endpoint(db):
    t = _tenant(db)
    commander = _mk(db, tenant=t, email="cmd@acme.test", role="commander")
    db.commit()
    with pytest.raises(HTTPException) as exc:
        reset_user_password(commander.id, TeamUserPasswordReset(password="whatever12"), user=commander, db=db)
    assert exc.value.status_code == 400


def test_commander_cannot_reset_across_tenants(db):
    t1 = _tenant(db)
    t2 = Tenant(name="Other", slug="other")
    db.add(t2)
    db.flush()
    commander = _mk(db, tenant=t1, email="cmd@acme.test", role="commander")
    outsider = _mk(db, tenant=t2, email="x@other.test", role="hero")
    db.commit()
    with pytest.raises(HTTPException) as exc:
        reset_user_password(outsider.id, TeamUserPasswordReset(password="whatever12"), user=commander, db=db)
    assert exc.value.status_code == 404
