"""Tests for Signet — token minting/lookup, the mailer's degrade-without-token behaviour, playbook
step-key invariants, and (DB-backed) the reminder cadence guard, sequential/parallel completion, and
the install guard."""

from app.services import mailer
from app.sydekyks.signet import emails, service
from app.sydekyks.signet.playbook import PLAYBOOK_KEY, PLAYBOOK_KEY_REMIND, PLAYBOOK_STEPS


# --- Tokens (pure) ---------------------------------------------------------------------------------

def test_mint_token_hash_matches_and_link_built():
    raw, token_hash, token_enc = service.mint_token()
    assert token_hash == service._hash(raw)
    assert token_enc and token_enc != raw  # stored encrypted, never in the clear
    assert service.sign_link(raw).endswith(f"/sign/{raw}")


def test_find_signer_by_bad_token_is_none(db):
    assert service.find_signer_by_raw_token(db, "definitely-not-a-real-token") is None
    assert service.find_signer_by_raw_token(db, "") is None


# --- Mailer degrades cleanly without a server token ------------------------------------------------

def test_mailer_returns_false_without_server_token(db, monkeypatch):
    class _Cfg:
        encrypted_server_token = None

    monkeypatch.setattr(mailer.postmark_config, "get_config", lambda _db: _Cfg())
    monkeypatch.setattr(mailer.tenant_issues, "report_issue", lambda *a, **k: None)
    assert mailer.send_email(db, to="a@b.com", subject="s", html="<p>x</p>") is False


# --- Email copy templates (pure) -------------------------------------------------------------------

def test_reminder_template_escalates_tone():
    _s1, b1 = emails.reminder_template(signer_name="Jo", title="MSA", sender="Acme", reminder_number=1)
    _s3, b3 = emails.reminder_template(signer_name="Jo", title="MSA", sender="Acme", reminder_number=3)
    assert "quick reminder" in b1.lower()
    assert "final reminder" in b3.lower()


# --- Playbook invariants ---------------------------------------------------------------------------

def test_playbook_steps_and_registration():
    from app.services.missions import PLAYBOOK_REGISTRY

    assert [s["key"] for s in PLAYBOOK_STEPS] == ["load_envelope", "compose", "send"]
    for step in PLAYBOOK_STEPS:
        assert step["title"] and step["description"] and step["likely_failures"]
    assert PLAYBOOK_KEY in PLAYBOOK_REGISTRY and PLAYBOOK_KEY_REMIND in PLAYBOOK_REGISTRY


# --- DB-backed: install guard, reminder cadence, completion ----------------------------------------

def _seed_signet(db):
    from app.models.sydekyk import Sydekyk
    from app.models.tenant import Tenant

    tenant = Tenant(name="Acme", slug="acme")
    db.add(tenant)
    db.flush()
    signet = Sydekyk(tenant_id=None, name="Signet", slug="signet", tagline="t", description="d",
                     avatar_url="/x.png", system_prompt="p", model="gpt-4o-mini", temperature=0.3,
                     is_exclusive=False, is_published=True, workflow_enabled=True, playbook_key="signet.dispatch")
    db.add(signet)
    db.commit()
    return tenant, signet


def _mk_envelope(db, tenant, signet, *, order="parallel", status="sent"):
    from datetime import datetime, timezone
    from app.sydekyks.signet.models import SignetEnvelope, SignetSigner

    env = SignetEnvelope(tenant_id=tenant.id, sydekyk_id=signet.id, title="MSA", status=status,
                         signing_order=order, reminder_interval_days=3, max_reminders=2,
                         sent_at=datetime.now(timezone.utc), created_by="rep@acme.test")
    db.add(env)
    db.flush()
    signers = []
    for i, (name, email) in enumerate([("Jo", "jo@x.test"), ("Sam", "sam@x.test")]):
        raw, th, te = service.mint_token()
        s = SignetSigner(tenant_id=tenant.id, envelope_id=env.id, name=name, email=email, order=i,
                         token_hash=th, token_encrypted=te)
        db.add(s)
        signers.append((raw, s))
    db.commit()
    return env, signers


def test_ensure_installed_is_idempotent(db):
    from app.models.sydekyk import SydekykInstall

    tenant, signet = _seed_signet(db)
    service.ensure_installed(db, tenant.id, "signet")
    service.ensure_installed(db, tenant.id, "signet")  # second call is a no-op
    rows = db.query(SydekykInstall).filter(SydekykInstall.tenant_id == tenant.id,
                                           SydekykInstall.sydekyk_id == signet.id).all()
    assert len(rows) == 1


def test_reminder_cadence_guard(db, monkeypatch):
    from datetime import datetime, timezone

    tenant, signet = _seed_signet(db)
    env, signers = _mk_envelope(db, tenant, signet, order="parallel")
    monkeypatch.setattr(service.mailer, "send_email", lambda *a, **k: True)

    # Just reminded now → the interval guard blocks a non-forced pass.
    for _raw, s in signers:
        s.last_reminded_at = datetime.now(timezone.utc)
    db.commit()
    assert service.remind_envelope(db, env, force=False) == 0

    # Forced pass sends to both pending signers and bumps their counters.
    assert service.remind_envelope(db, env, force=True) == 2
    for _raw, s in signers:
        db.refresh(s)
        assert s.reminder_count == 1

    # Second forced pass reaches the max (2) after one more...
    assert service.remind_envelope(db, env, force=True) == 2
    # ...and a third is capped out (max_reminders=2).
    assert service.remind_envelope(db, env, force=True) == 0


def test_hold_blocks_reminders(db, monkeypatch):
    tenant, signet = _seed_signet(db)
    env, _signers = _mk_envelope(db, tenant, signet)
    env.hold = True
    db.commit()
    monkeypatch.setattr(service.mailer, "send_email", lambda *a, **k: True)
    assert service.remind_envelope(db, env, force=True) == 0


def test_all_signed_completes_envelope(db, monkeypatch):
    from datetime import datetime, timezone

    tenant, signet = _seed_signet(db)
    env, signers = _mk_envelope(db, tenant, signet, order="parallel")
    # Give the envelope a source asset so completion can assemble.
    from app.sydekyks.signet.models import SignetAsset

    asset = SignetAsset(tenant_id=tenant.id, envelope_id=env.id, kind="source", content=b"%PDF-1.4 fake")
    db.add(asset)
    db.flush()
    env.source_asset_id = asset.id
    db.commit()

    monkeypatch.setattr(service.mailer, "send_email", lambda *a, **k: True)
    monkeypatch.setattr(service.pdf_svc, "assemble_signed_pdf", lambda **k: b"%PDF-signed")

    now = datetime.now(timezone.utc)
    for _raw, s in signers:
        s.status = "signed"
        s.signed_at = now
    db.commit()

    service.advance_or_complete(db, env, sender="rep@acme.test")
    db.refresh(env)
    assert env.status == "completed" and env.completed_at is not None
    assert env.signed_pdf_asset_id is not None


def test_sequential_only_sends_to_next(db, monkeypatch):
    tenant, signet = _seed_signet(db)
    env, signers = _mk_envelope(db, tenant, signet, order="sequential")
    # recipients_for_send returns only the first pending signer for sequential order.
    recips = service.recipients_for_send(db, env)
    assert len(recips) == 1 and recips[0].order == 0
