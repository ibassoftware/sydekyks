"""Installing a Sydekyk auto-defaults it to Power Core when an admin hosted assignment exists."""

from app.models.llm_provider import SydekykHostedAssignment, TenantSydekykLLMConfig
from app.models.sydekyk import Sydekyk
from app.models.tenant import Tenant
from app.services import llm_provisioning


def _mk_tenant_and_sydekyk(db, slug="ledger"):
    t = Tenant(name="Acme", slug="acme")
    db.add(t)
    db.flush()
    s = Sydekyk(
        tenant_id=None, name=slug.title(), slug=slug, tagline="t", description="d",
        avatar_url="/x.png", system_prompt="p", model="m", temperature=0.3,
        is_exclusive=False, is_published=True, chat_enabled=True, workflow_enabled=True,
        accepts_document_uploads=True, playbook_key=f"{slug}.demo",
    )
    db.add(s)
    db.flush()
    return t, s


def test_defaults_to_power_core_when_assignment_provisioned(db, monkeypatch):
    t, s = _mk_tenant_and_sydekyk(db)
    db.add(SydekykHostedAssignment(
        sydekyk_id=s.id, hosted_provider="ollama_cloud", hosted_model="minimax-m2.7",
        litellm_model_id="id-ledger", litellm_model_alias="sydekyk-ledger-core",
    ))
    db.commit()

    monkeypatch.setattr(
        llm_provisioning.litellm_admin, "generate_virtual_key",
        lambda *a, **k: (True, "ok", "sk-virtual-key"),
    )

    provisioned = llm_provisioning.default_to_power_core(db, t.id, s.id)
    assert provisioned is True

    config = db.query(TenantSydekykLLMConfig).filter(
        TenantSydekykLLMConfig.tenant_id == t.id, TenantSydekykLLMConfig.sydekyk_id == s.id
    ).first()
    assert config is not None
    assert config.provider == "power_core"
    assert config.status == "untested"
    assert config.litellm_model_alias == "sydekyk-ledger-core"


def test_skips_when_no_hosted_assignment(db):
    t, s = _mk_tenant_and_sydekyk(db)
    db.commit()
    assert llm_provisioning.default_to_power_core(db, t.id, s.id) is False
    assert db.query(TenantSydekykLLMConfig).count() == 0


def test_does_not_override_existing_config(db):
    t, s = _mk_tenant_and_sydekyk(db)
    db.add(SydekykHostedAssignment(
        sydekyk_id=s.id, hosted_provider="ollama_cloud", hosted_model="m",
        litellm_model_id="id", litellm_model_alias="sydekyk-ledger-core",
    ))
    db.add(TenantSydekykLLMConfig(tenant_id=t.id, sydekyk_id=s.id, provider="openai", model="gpt-4o-mini"))
    db.commit()
    assert llm_provisioning.default_to_power_core(db, t.id, s.id) is False
    config = db.query(TenantSydekykLLMConfig).filter(TenantSydekykLLMConfig.tenant_id == t.id).one()
    assert config.provider == "openai"  # untouched
