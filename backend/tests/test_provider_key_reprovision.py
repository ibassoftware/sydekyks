"""Editing a provider's base URL / key must re-point the models already registered with it.

Regression guard for the stale-api_base trap: changing the central Ollama Cloud base URL used to
update only the CentralProviderKey row, leaving every `sydekyk-<slug>-core` LiteLLM deployment
pointed at the old endpoint until each hosted assignment was re-saved by hand.
"""

import pytest

from app.core.crypto import encrypt_secret
from app.models.llm_provider import CentralProviderKey, SydekykHostedAssignment
from app.models.sydekyk import Sydekyk
from app.routers.admin import update_provider_key
from app.schemas.provider_key import ProviderKeyUpdate
from app.services import litellm_admin


def _mk_sydekyk(db, slug):
    s = Sydekyk(
        tenant_id=None, name=slug.title(), slug=slug, tagline="t", description="d",
        avatar_url="/x.png", system_prompt="p", model="m", temperature=0.3,
        is_exclusive=False, is_published=True, chat_enabled=True, workflow_enabled=True,
        accepts_document_uploads=True, playbook_key=f"{slug}.demo",
    )
    db.add(s)
    db.flush()
    return s


def test_updating_central_key_repoints_all_hosted_models(db, monkeypatch):
    ledger = _mk_sydekyk(db, "ledger")
    seal = _mk_sydekyk(db, "seal")
    lonely = _mk_sydekyk(db, "scout")  # assigned but never provisioned -> must be skipped
    other = _mk_sydekyk(db, "quill")   # different provider -> must be untouched

    db.add(CentralProviderKey(
        provider="ollama_cloud", encrypted_api_key=encrypt_secret("old-key"),
        api_base="https://ollama.com/api",  # the wrong base the admin is correcting
    ))
    db.add_all([
        SydekykHostedAssignment(sydekyk_id=ledger.id, hosted_provider="ollama_cloud",
                                hosted_model="minimax-m2.7", litellm_model_id="id-ledger",
                                litellm_model_alias="sydekyk-ledger-core"),
        SydekykHostedAssignment(sydekyk_id=seal.id, hosted_provider="ollama_cloud",
                                hosted_model="gemma4:31b", litellm_model_id="id-seal",
                                litellm_model_alias="sydekyk-seal-core"),
        SydekykHostedAssignment(sydekyk_id=lonely.id, hosted_provider="ollama_cloud",
                                hosted_model="gemma4:31b", litellm_model_id=None),
        SydekykHostedAssignment(sydekyk_id=other.id, hosted_provider="openai",
                                hosted_model="gpt-4o-mini", litellm_model_id="id-quill",
                                litellm_model_alias="sydekyk-quill-core"),
    ])
    db.commit()

    calls = []

    def fake_update_model(model_id, alias, litellm_model, api_key=None, api_base=None):
        calls.append({"alias": alias, "litellm_model": litellm_model, "api_key": api_key, "api_base": api_base})
        return True, "ok", {"model_info": {"id": model_id}}

    monkeypatch.setattr(litellm_admin, "update_model", fake_update_model)

    out = update_provider_key(
        "ollama_cloud", ProviderKeyUpdate(api_key="new-key", api_base="https://ollama.com/v1"), db=db
    )

    assert out.api_base == "https://ollama.com/v1"
    # Exactly the two provisioned ollama_cloud models were re-pointed — not the unprovisioned one,
    # not the openai one.
    assert {c["alias"] for c in calls} == {"sydekyk-ledger-core", "sydekyk-seal-core"}
    assert all(c["api_base"] == "https://ollama.com/v1" for c in calls)
    assert all(c["api_key"] == "new-key" for c in calls)
    assert {c["litellm_model"] for c in calls} == {"openai/minimax-m2.7", "openai/gemma4:31b"}


def test_updating_key_surfaces_reprovision_failures(db, monkeypatch):
    from fastapi import HTTPException

    ledger = _mk_sydekyk(db, "ledger")
    db.add(CentralProviderKey(
        provider="ollama_cloud", encrypted_api_key=encrypt_secret("old"), api_base="https://ollama.com/api",
    ))
    db.add(SydekykHostedAssignment(
        sydekyk_id=ledger.id, hosted_provider="ollama_cloud", hosted_model="minimax-m2.7",
        litellm_model_id="id-ledger", litellm_model_alias="sydekyk-ledger-core",
    ))
    db.commit()

    monkeypatch.setattr(
        litellm_admin, "update_model", lambda *a, **k: (False, "proxy unreachable", None)
    )

    with pytest.raises(HTTPException) as exc:
        update_provider_key(
            "ollama_cloud", ProviderKeyUpdate(api_key="k", api_base="https://ollama.com/v1"), db=db
        )
    assert exc.value.status_code == 502
    assert "ledger" in exc.value.detail
    # The key itself must still have been persisted despite the re-point failure.
    key = db.query(CentralProviderKey).filter(CentralProviderKey.provider == "ollama_cloud").first()
    assert key.api_base == "https://ollama.com/v1"
