"""Signet's reminder cron only touches envelopes for HQs that still have Signet installed —
uninstalling stops outbound signer reminders."""

from app.models.sydekyk import Sydekyk, SydekykInstall
from app.models.tenant import Tenant
from app.sydekyks.signet import service as signet_service
from app.sydekyks.signet.models import SignetEnvelope


def _setup(db):
    tenant = Tenant(name="Acme", slug="acme")
    db.add(tenant)
    db.flush()
    signet = Sydekyk(
        tenant_id=None, name="Signet", slug="signet", tagline="t", description="d",
        avatar_url="/x.png", system_prompt="p", model="m", temperature=0.3,
        is_exclusive=False, is_published=True, chat_enabled=True, workflow_enabled=True,
        accepts_document_uploads=True, playbook_key="signet.demo",
    )
    db.add(signet)
    db.flush()
    db.add(SignetEnvelope(tenant_id=tenant.id, sydekyk_id=signet.id, status="sent", hold=False))
    db.commit()
    return tenant, signet


def test_reminders_skipped_when_not_installed(db, monkeypatch):
    tenant, signet = _setup(db)
    calls = []
    monkeypatch.setattr(signet_service, "remind_envelope", lambda *a, **k: calls.append(1) or 1)

    total = signet_service.process_due_reminders(db)
    assert total == 0
    assert calls == []  # no reminders sent for an uninstalled HQ


def test_reminders_run_when_installed(db, monkeypatch):
    tenant, signet = _setup(db)
    db.add(SydekykInstall(tenant_id=tenant.id, sydekyk_id=signet.id))
    db.commit()
    calls = []
    monkeypatch.setattr(signet_service, "remind_envelope", lambda *a, **k: calls.append(1) or 1)

    total = signet_service.process_due_reminders(db)
    assert total == 1
    assert len(calls) == 1
