"""End-to-end coverage for the inbound Postmark webhook (DB-gated).

The happy path + duplicate path live in test_review_fixes.py; this file exercises the rejection and
edge branches — auth, malformed body, no-match, no-op, unsupported/oversized attachments, and the
rate limiter — so every documented outcome of POST /api/webhooks/email/postmark is pinned down.
"""

import base64

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from app.core.config import settings
from app.main import app
from app.models.email_event import EmailIngestEvent
from app.routers import email_webhook as ew


@pytest.fixture(autouse=True)
def _reset_rate_limiter():
    # The limiter's sliding window is a process-global keyed by client IP; clear it so one test's
    # requests never spill the count into the next.
    ew._recent_hits.clear()
    yield
    ew._recent_hits.clear()


def _wire(engine, monkeypatch):
    SessionT = sessionmaker(bind=engine)
    monkeypatch.setattr(ew, "get_db", lambda: iter([SessionT()]))

    async def _noop(mid):
        return "inline"

    monkeypatch.setattr(ew, "enqueue_mission", _noop)


def _auth_headers():
    token = base64.b64encode(
        f"{settings.email_webhook_basic_auth_user}:{settings.email_webhook_basic_auth_pass}".encode()
    ).decode()
    return {"Authorization": f"Basic {token}"}


def _seed_inbox(db, seeded, local_part="acme-ledger-a1b2c3"):
    from app.core.crypto import encrypt_secret
    from app.models.gadget import Gadget, TenantGadgetLink
    from app.models.gadget_requirement import SydekykGadgetRequirement, TenantSydekykGadgetAssignment

    gadget = Gadget(name="Email", slug="email", type="external", category="email", description="")
    db.add(gadget)
    db.flush()
    link = TenantGadgetLink(
        tenant_id=seeded["tenant"].id, gadget_id=gadget.id, name="Inbox",
        config={"provider": "postmark", "inbound_local_part": local_part,
                "inbound_domain": settings.email_inbound_domain},
        encrypted_secret=encrypt_secret("x"), status="connected",
    )
    db.add(link)
    db.flush()
    req = db.query(SydekykGadgetRequirement).filter(
        SydekykGadgetRequirement.sydekyk_id == seeded["ledger"].id,
        SydekykGadgetRequirement.role_key == "inbox",
    ).first()
    db.add(TenantSydekykGadgetAssignment(tenant_id=seeded["tenant"].id, requirement_id=req.id, gadget_link_id=link.id))
    db.commit()
    return f"{local_part}@{settings.email_inbound_domain}"


def _pdf_payload(to_addr, *, name="bill.pdf", content_type="application/pdf", body=b"%PDF-1.4 x", msg_id="m1"):
    return {
        "OriginalRecipient": to_addr,
        "FromFull": {"Email": "vendor@ex.com"},
        "Subject": "Invoice",
        "MessageID": msg_id,
        "Attachments": [{"Name": name, "ContentType": content_type, "Content": base64.b64encode(body).decode()}],
    }


def _latest_outcome(db):
    row = db.query(EmailIngestEvent).order_by(EmailIngestEvent.created_at.desc()).first()
    return row.outcome if row else None


def test_missing_auth_is_unauthorized_and_recorded(db, engine, seeded, monkeypatch):
    _wire(engine, monkeypatch)
    r = TestClient(app).post("/api/webhooks/email/postmark", json=_pdf_payload("x@inbound.sydekyks.app"))
    assert r.status_code == 200 and r.json()["status"] == "unauthorized"
    db.expire_all()
    assert _latest_outcome(db) == "unauthorized"


def test_wrong_password_is_unauthorized(db, engine, seeded, monkeypatch):
    _wire(engine, monkeypatch)
    bad = base64.b64encode(f"{settings.email_webhook_basic_auth_user}:nope".encode()).decode()
    r = TestClient(app).post(
        "/api/webhooks/email/postmark",
        json=_pdf_payload("x@inbound.sydekyks.app"),
        headers={"Authorization": f"Basic {bad}"},
    )
    assert r.json()["status"] == "unauthorized"


def test_invalid_json_body_is_ignored(db, engine, seeded, monkeypatch):
    _wire(engine, monkeypatch)
    r = TestClient(app).post("/api/webhooks/email/postmark", data="not json", headers=_auth_headers())
    assert r.json()["status"] == "ignored"


def test_unknown_recipient_is_no_match(db, engine, seeded, monkeypatch):
    _wire(engine, monkeypatch)
    r = TestClient(app).post(
        "/api/webhooks/email/postmark",
        json=_pdf_payload("nobody-here@inbound.sydekyks.app"),
        headers=_auth_headers(),
    )
    assert r.json()["status"] == "no_match"


def test_no_attachments_is_no_op(db, engine, seeded, monkeypatch):
    _wire(engine, monkeypatch)
    to_addr = _seed_inbox(db, seeded)
    payload = {"OriginalRecipient": to_addr, "FromFull": {"Email": "v@ex.com"}, "MessageID": "no-att"}
    r = TestClient(app).post("/api/webhooks/email/postmark", json=payload, headers=_auth_headers())
    assert r.json()["status"] == "no_op"


def test_valid_bill_is_accepted(db, engine, seeded, monkeypatch):
    _wire(engine, monkeypatch)
    to_addr = _seed_inbox(db, seeded)
    r = TestClient(app).post("/api/webhooks/email/postmark", json=_pdf_payload(to_addr), headers=_auth_headers())
    assert r.json()["status"] == "accepted"
    assert r.json()["missions"] == 1


def test_recipient_match_is_case_insensitive(db, engine, seeded, monkeypatch):
    _wire(engine, monkeypatch)
    to_addr = _seed_inbox(db, seeded, local_part="acme-ledger-abcdef")
    upper = to_addr.replace("acme-ledger-abcdef", "ACME-Ledger-ABCDEF")
    r = TestClient(app).post("/api/webhooks/email/postmark", json=_pdf_payload(upper), headers=_auth_headers())
    assert r.json()["status"] == "accepted"


def test_unsupported_attachment_type_rejected(db, engine, seeded, monkeypatch):
    _wire(engine, monkeypatch)
    to_addr = _seed_inbox(db, seeded)
    payload = _pdf_payload(to_addr, name="notes.txt", content_type="text/plain", body=b"hello")
    r = TestClient(app).post("/api/webhooks/email/postmark", json=payload, headers=_auth_headers())
    assert r.json()["status"] == "no_supported_attachment"


def test_oversized_attachment_rejected(db, engine, seeded, monkeypatch):
    _wire(engine, monkeypatch)
    monkeypatch.setattr(settings, "max_document_bytes", 4)
    to_addr = _seed_inbox(db, seeded)
    payload = _pdf_payload(to_addr, body=b"%PDF-1.4 way too big for the cap")
    r = TestClient(app).post("/api/webhooks/email/postmark", json=payload, headers=_auth_headers())
    assert r.json()["status"] == "rejected_size"


def test_rate_limited_after_cap(db, engine, seeded, monkeypatch):
    _wire(engine, monkeypatch)
    monkeypatch.setattr(settings, "email_webhook_rate_limit_per_minute", 1)
    client = TestClient(app)
    client.post("/api/webhooks/email/postmark", json=_pdf_payload("x@inbound.sydekyks.app"), headers=_auth_headers())
    r2 = client.post("/api/webhooks/email/postmark", json=_pdf_payload("x@inbound.sydekyks.app"), headers=_auth_headers())
    assert r2.json()["status"] == "rate_limited"
