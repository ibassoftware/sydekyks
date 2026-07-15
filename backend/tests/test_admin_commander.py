"""Command Center: fixing/resetting an HQ's commander login."""

import pytest
from fastapi import HTTPException

from app.core.security import verify_password
from app.routers.admin import list_tenants, update_tenant_commander
from app.schemas.tenant import TenantCommanderUpdate


def _mk_tenant_with_commander(db, *, name, slug, email):
    from app.core.security import hash_password
    from app.models.tenant import Tenant
    from app.models.user import User

    t = Tenant(name=name, slug=slug)
    db.add(t)
    db.flush()
    db.add(User(tenant_id=t.id, email=email, hashed_password=hash_password("original-pw"), role="commander"))
    db.commit()
    return t


def test_list_tenants_includes_commander_email(db):
    _mk_tenant_with_commander(db, name="Acme HQ", slug="acme", email="commander@acme.test")
    rows = list_tenants(db=db)
    acme = next(r for r in rows if r.slug == "acme")
    assert acme.commander_email == "commander@acme.test"


def test_update_commander_email_and_password(db):
    from app.models.user import User

    t = _mk_tenant_with_commander(db, name="Acme HQ", slug="acme", email="old@acme.test")
    out = update_tenant_commander(t.id, TenantCommanderUpdate(email="new@acme.com", password="brand-new-pw"), db=db)
    assert out.commander_email == "new@acme.com"
    commander = db.query(User).filter(User.tenant_id == t.id, User.role == "commander").first()
    assert commander.email == "new@acme.com"
    assert verify_password("brand-new-pw", commander.hashed_password)


def test_update_commander_rejects_email_clash(db):
    _mk_tenant_with_commander(db, name="A", slug="a", email="taken@example.com")
    t2 = _mk_tenant_with_commander(db, name="B", slug="b", email="b@example.com")
    with pytest.raises(HTTPException) as exc:
        update_tenant_commander(t2.id, TenantCommanderUpdate(email="taken@example.com"), db=db)
    assert exc.value.status_code == 409


def test_update_commander_requires_a_field(db):
    t = _mk_tenant_with_commander(db, name="A", slug="a", email="a@x.test")
    with pytest.raises(HTTPException) as exc:
        update_tenant_commander(t.id, TenantCommanderUpdate(), db=db)
    assert exc.value.status_code == 400
