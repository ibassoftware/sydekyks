"""Command Center Postmark config: service defaults + admin GET/PUT/DELETE (DB-gated)."""

from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from app.core.config import settings
from app.core.crypto import decrypt_secret
from app.main import app
from app.models.postmark import PostmarkConfig
from app.services import postmark_config


def test_get_config_lazily_creates_default(db):
    assert db.query(PostmarkConfig).count() == 0
    cfg = postmark_config.get_config(db)
    assert cfg.inbound_domain == settings.email_inbound_domain
    # Idempotent — a second call reuses the same singleton row.
    assert postmark_config.get_config(db).id == cfg.id
    assert db.query(PostmarkConfig).count() == 1


def test_admin_postmark_roundtrip(db, engine):
    from app.core.deps import require_super_admin
    from app.db.session import get_db

    Session = sessionmaker(bind=engine)

    def _db_override():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[require_super_admin] = lambda: None
    app.dependency_overrides[get_db] = _db_override
    try:
        client = TestClient(app)

        got = client.get("/api/admin/postmark").json()
        assert got["inbound_domain"] == settings.email_inbound_domain
        assert got["has_server_token"] is False
        assert got["webhook_url"].endswith("/api/webhooks/email/postmark")
        assert got["webhook_basic_auth_user"] == settings.email_webhook_basic_auth_user
        assert got["webhook_basic_auth_pass"] == settings.email_webhook_basic_auth_pass

        put = client.put(
            "/api/admin/postmark", json={"inbound_domain": "mail.acme.test", "server_token": "pm-secret"}
        ).json()
        assert put["inbound_domain"] == "mail.acme.test"
        assert put["has_server_token"] is True

        # Token is stored encrypted, not in plaintext.
        db.expire_all()
        stored = db.query(PostmarkConfig).first()
        assert stored.encrypted_server_token and stored.encrypted_server_token != "pm-secret"
        assert decrypt_secret(stored.encrypted_server_token) == "pm-secret"

        # Editing the domain without a token leaves the stored token untouched.
        put2 = client.put("/api/admin/postmark", json={"inbound_domain": "mail2.acme.test"}).json()
        assert put2["inbound_domain"] == "mail2.acme.test"
        assert put2["has_server_token"] is True

        cleared = client.delete("/api/admin/postmark/server-token").json()
        assert cleared["has_server_token"] is False
        assert cleared["inbound_domain"] == "mail2.acme.test"  # domain persists through a token clear

        # Webhook Basic Auth is editable and surfaced (encrypted at rest, decrypted for the URL).
        creds = client.put(
            "/api/admin/postmark",
            json={"inbound_domain": "mail2.acme.test", "webhook_basic_auth_user": "hook", "webhook_basic_auth_pass": "s3cr3t"},
        ).json()
        assert creds["webhook_basic_auth_user"] == "hook"
        assert creds["webhook_basic_auth_pass"] == "s3cr3t"
        db.expire_all()
        assert db.query(PostmarkConfig).first().encrypted_webhook_basic_auth_pass != "s3cr3t"
    finally:
        app.dependency_overrides.clear()


def test_webhook_honors_db_credentials(db, engine, seeded, monkeypatch):
    """The webhook authorizes against the DB-stored creds, not just the env defaults."""
    import base64

    from fastapi.testclient import TestClient as _Client
    from sqlalchemy.orm import sessionmaker

    from app.core.crypto import encrypt_secret
    from app.routers import email_webhook as ew

    # Store custom creds that differ from the env defaults.
    cfg = postmark_config.get_config(db)
    cfg.webhook_basic_auth_user = "hook"
    cfg.encrypted_webhook_basic_auth_pass = encrypt_secret("s3cr3t")
    db.commit()

    SessionT = sessionmaker(bind=engine)
    monkeypatch.setattr(ew, "get_db", lambda: iter([SessionT()]))
    ew._recent_hits.clear()

    client = _Client(app)
    payload = {"OriginalRecipient": "nobody@x", "MessageID": "cred-1"}

    env_auth = base64.b64encode(
        f"{settings.email_webhook_basic_auth_user}:{settings.email_webhook_basic_auth_pass}".encode()
    ).decode()
    r_env = client.post("/api/webhooks/email/postmark", json=payload, headers={"Authorization": f"Basic {env_auth}"})
    assert r_env.json()["status"] == "unauthorized"  # env defaults no longer accepted

    db_auth = base64.b64encode(b"hook:s3cr3t").decode()
    r_db = client.post("/api/webhooks/email/postmark", json=payload, headers={"Authorization": f"Basic {db_auth}"})
    assert r_db.json()["status"] != "unauthorized"  # DB creds accepted (→ no_op: no attachments)
