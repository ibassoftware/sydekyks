"""Uninstalling a Sydekyk wipes the HQ's CONFIG (and revokes its LiteLLM key) but preserves
operational data and shared resources."""

from app.models.gadget import TenantGadgetLink
from app.models.llm_provider import TenantSydekykLLMConfig, TenantSydekykUsageSnapshot
from app.models.review_assignment import ReviewAssignment
from app.models.user import User
from app.models.user_permission import UserSydekykPermission
from app.services import litellm_admin, sydekyk_uninstall
from app.sydekyks.ledger.models import LedgerTenantSettings


def test_uninstall_purges_config_revokes_key_preserves_shared(seeded, db, monkeypatch):
    tenant = seeded["tenant"]
    ledger = seeded["ledger"]

    # Config the uninstall must remove, on top of what `seeded` created (LLM config + gadget assignment).
    db.add(LedgerTenantSettings(tenant_id=tenant.id, purchase_order_match_enabled=True))
    hero = User(tenant_id=tenant.id, email="hero@acme.test", hashed_password="x", role="hero")
    db.add(hero)
    db.flush()
    db.add(UserSydekykPermission(user_id=hero.id, sydekyk_id=ledger.id, can_use=True, can_configure=False))
    db.add(ReviewAssignment(tenant_id=tenant.id, sydekyk_id=ledger.id, odoo_user_ids=[7]))
    db.add(TenantSydekykUsageSnapshot(tenant_id=tenant.id, sydekyk_id=ledger.id, spend_used=1.5))
    db.commit()

    revoked = []
    monkeypatch.setattr(litellm_admin, "revoke_virtual_key", lambda key: revoked.append(key) or (True, "ok", None))
    monkeypatch.setattr(litellm_admin, "delete_model", lambda model_id: (True, "ok", None))

    sydekyk_uninstall.purge_tenant_sydekyk_config(db, tenant_id=tenant.id, sydekyk=ledger)
    db.commit()

    # Config gone
    assert db.query(LedgerTenantSettings).filter(LedgerTenantSettings.tenant_id == tenant.id).count() == 0
    assert db.query(TenantSydekykLLMConfig).filter(TenantSydekykLLMConfig.tenant_id == tenant.id).count() == 0
    assert db.query(UserSydekykPermission).filter(UserSydekykPermission.user_id == hero.id).count() == 0
    assert db.query(ReviewAssignment).filter(ReviewAssignment.tenant_id == tenant.id).count() == 0
    assert db.query(TenantSydekykUsageSnapshot).filter(TenantSydekykUsageSnapshot.tenant_id == tenant.id).count() == 0

    # The LiteLLM virtual key was revoked, not orphaned.
    assert len(revoked) == 1

    # Shared resources preserved: the tenant's Odoo Gadget Link stays (only the assignment was removed),
    # and the hero user itself is untouched.
    assert db.query(TenantGadgetLink).filter(TenantGadgetLink.tenant_id == tenant.id).count() == 1
    assert db.get(User, hero.id) is not None


def test_uninstall_is_tenant_scoped(seeded, db, monkeypatch):
    """A second HQ's Ledger settings must survive another HQ's uninstall."""
    from app.models.tenant import Tenant

    tenant = seeded["tenant"]
    ledger = seeded["ledger"]
    other = Tenant(name="Other HQ", slug="other")
    db.add(other)
    db.flush()
    db.add(LedgerTenantSettings(tenant_id=other.id))
    db.add(LedgerTenantSettings(tenant_id=tenant.id))
    db.commit()

    monkeypatch.setattr(litellm_admin, "revoke_virtual_key", lambda key: (True, "ok", None))
    monkeypatch.setattr(litellm_admin, "delete_model", lambda model_id: (True, "ok", None))

    sydekyk_uninstall.purge_tenant_sydekyk_config(db, tenant_id=tenant.id, sydekyk=ledger)
    db.commit()

    assert db.query(LedgerTenantSettings).filter(LedgerTenantSettings.tenant_id == tenant.id).count() == 0
    assert db.query(LedgerTenantSettings).filter(LedgerTenantSettings.tenant_id == other.id).count() == 1
