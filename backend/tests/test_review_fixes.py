"""Regression tests for the two P0s found in review (DB-gated).

1. arq auto-retry must create a NEW linked Mission, not re-run the same row (which collided on
   mission_steps' unique (mission_id, step_index)).
2. Duplicate Postmark delivery must record a `duplicate` event, not 500 on a unique constraint
   (email_ingest_events is now append-only).
"""

import asyncio
import base64

from sqlalchemy.orm import sessionmaker

from app.models.mission import Mission
from app.services import missions as missions_svc


def test_worker_retry_spawns_new_linked_mission(db, engine, seeded, monkeypatch):
    import worker as w
    from app.sydekyks.ledger import extraction

    SessionT = sessionmaker(bind=engine)
    monkeypatch.setattr(missions_svc, "SessionLocal", SessionT)
    monkeypatch.setattr(w, "SessionLocal", SessionT)

    enqueued = []

    async def _capture(mid):
        enqueued.append(mid)
        return "captured"

    monkeypatch.setattr(w, "enqueue_mission", _capture)
    # Force a retryable (transient) failure at extraction, which records step_index 0 once.
    monkeypatch.setattr(
        extraction, "extract_bill_data",
        lambda *a, **k: (False, "provider timeout", None,
                         {"usage": None, "request_id": None, "model": "m", "cost_usd": 0.0}),
    )

    fresh = missions_svc.create_mission_for_document(
        db, tenant_id=seeded["tenant"].id, sydekyk=seeded["ledger"], user_id=None,
        document_bytes=b"img", filename="bill.png", content_type="image/png",
        sha256_hash="h", source="web_upload", signal_type="manual_upload",
    )

    # This is what the worker does for a queued job. It must NOT raise (no step collision).
    result = asyncio.run(w.run_mission_task({"job_try": 1}, str(fresh.id)))

    db.expire_all()
    original = db.get(Mission, fresh.id)
    assert original.status == "failed" and original.failure_category == "transient"
    # A NEW linked Mission was created and enqueued — the original is left intact for the audit trail.
    child = db.query(Mission).filter(Mission.parent_mission_id == fresh.id).first()
    assert child is not None
    assert child.attempt_number == 2
    assert child.root_mission_id == fresh.id
    assert enqueued == [child.id]
    assert result.startswith("retried:")


def _seed_email_inbox(db, seeded, local_part="acme-inbox"):
    from app.core.config import settings
    from app.core.crypto import encrypt_secret
    from app.models.gadget import Gadget, TenantGadgetLink
    from app.models.gadget_requirement import SydekykGadgetRequirement, TenantSydekykGadgetAssignment

    gadget = Gadget(name="Email", slug="email", type="external", category="email", description="")
    db.add(gadget)
    db.flush()
    link = TenantGadgetLink(
        tenant_id=seeded["tenant"].id, gadget_id=gadget.id, name="Inbox",
        config={"inbound_local_part": local_part, "inbound_domain": settings.email_inbound_domain},
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


def test_duplicate_email_delivery_records_duplicate(db, engine, seeded, monkeypatch):
    from fastapi.testclient import TestClient

    from app.core.config import settings
    from app.main import app
    from app.models.email_event import EmailIngestEvent
    from app.routers import email_webhook as ew

    to_addr = _seed_email_inbox(db, seeded)

    SessionT = sessionmaker(bind=engine)
    monkeypatch.setattr(ew, "get_db", lambda: iter([SessionT()]))

    async def _noop(mid):
        return "inline"

    monkeypatch.setattr(ew, "enqueue_mission", _noop)

    auth = base64.b64encode(
        f"{settings.email_webhook_basic_auth_user}:{settings.email_webhook_basic_auth_pass}".encode()
    ).decode()
    payload = {
        "OriginalRecipient": to_addr,
        "FromFull": {"Email": "vendor@ex.com"},
        "Subject": "Invoice",
        "MessageID": "dup-msg-1",
        "Attachments": [{"Name": "bill.pdf", "ContentType": "application/pdf",
                         "Content": base64.b64encode(b"%PDF-1.4 x").decode()}],
    }
    client = TestClient(app)
    headers = {"Authorization": f"Basic {auth}"}

    r1 = client.post("/api/webhooks/email/postmark", json=payload, headers=headers)
    r2 = client.post("/api/webhooks/email/postmark", json=payload, headers=headers)

    assert r1.status_code == 200 and r1.json()["status"] == "accepted"
    # The second delivery must be a clean 'duplicate', NOT a 500 from a unique-constraint violation.
    assert r2.status_code == 200 and r2.json()["status"] == "duplicate"

    db.expire_all()
    events = db.query(EmailIngestEvent).filter(EmailIngestEvent.message_id == "dup-msg-1").all()
    outcomes = sorted(e.outcome for e in events)
    assert outcomes == ["accepted", "duplicate"]  # append-only: both rows exist
