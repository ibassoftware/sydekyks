"""Shared Mission event protocol and its SSE projection."""

import uuid
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.core.config import settings
from app.services import mission_events, mission_sse


def _running_snapshot() -> dict:
    return {"status": "running", "timestamp": "2026-01-01T00:00:00+00:00"}


def test_stream_replays_step_delta_and_terminal(monkeypatch):
    monkeypatch.setattr(settings, "queue_enabled", False)
    mission_events.reset_memory()
    mission_id = uuid.uuid4()

    mission_events.publish(mission_id, "mission.started", {"playbook_key": "seal.generate"})
    mission_events.publish(mission_id, "step.completed", {
        "index": 0, "key": "generate", "step_type": "internal",
        "status": "succeeded", "has_error": False,
    })
    mission_events.publish(mission_id, "output.delta", {"text": "<h1>Mutual NDA</h1>"})
    mission_events.publish(mission_id, "mission.completed", {"status": "succeeded"})

    body = "".join(mission_sse.event_frames(mission_id, snapshot=_running_snapshot()))

    assert "event: mission.snapshot" in body
    assert "event: step.completed" in body and "generate" in body
    assert "event: output.delta" in body and "<h1>Mutual NDA</h1>" in body
    assert "event: mission.completed" in body
    assert "mission.failed" not in body


def test_terminal_snapshot_closes_without_waiting(monkeypatch):
    monkeypatch.setattr(settings, "queue_enabled", False)
    mission_events.reset_memory()
    mission_id = uuid.uuid4()

    body = "".join(mission_sse.event_frames(
        mission_id,
        snapshot={"status": "failed", "timestamp": "2026-01-01T00:00:00+00:00"},
    ))

    assert "event: mission.snapshot" in body
    assert '"status": "failed"' in body


def test_heartbeat_recovers_terminal_state_from_database(monkeypatch):
    monkeypatch.setattr(settings, "queue_enabled", False)
    mission_id = uuid.uuid4()
    monkeypatch.setattr(mission_events, "iter_events", lambda *_a, **_k: iter([None]))
    terminal = {
        "version": 1, "mission_id": str(mission_id), "type": "mission.completed",
        "timestamp": "2026-01-01T00:00:01+00:00", "data": {"status": "succeeded"},
    }

    body = "".join(mission_sse.event_frames(
        mission_id, snapshot=_running_snapshot(), terminal_probe=lambda: terminal,
    ))

    assert "event: mission.completed" in body
    assert ": keepalive" not in body


def test_resume_skips_events_at_or_before_cursor(monkeypatch):
    monkeypatch.setattr(settings, "queue_enabled", False)
    mission_events.reset_memory()
    mission_id = uuid.uuid4()

    first_id = mission_events.publish(mission_id, "step.completed", {
        "index": 0, "key": "first", "step_type": "internal",
        "status": "succeeded", "has_error": False,
    })
    mission_events.publish(mission_id, "step.completed", {
        "index": 1, "key": "second", "step_type": "internal",
        "status": "succeeded", "has_error": False,
    })
    mission_events.publish(mission_id, "mission.completed", {"status": "succeeded"})

    body = "".join(mission_sse.event_frames(
        mission_id, snapshot=_running_snapshot(), last_event_id=first_id,
    ))

    assert '"key": "first"' not in body
    assert '"key": "second"' in body
    assert "event: mission.completed" in body


def test_queue_enabled_publication_uses_bounded_expiring_redis_stream(monkeypatch):
    monkeypatch.setattr(settings, "queue_enabled", True)
    calls = []

    class FakeRedis:
        def xadd(self, key, fields, *, maxlen, approximate):
            calls.append(("xadd", key, fields, maxlen, approximate))
            return "1730000000000-0"

        def expire(self, key, seconds):
            calls.append(("expire", key, seconds))

        def close(self):
            calls.append(("close",))

    monkeypatch.setattr(mission_events, "_redis_client", lambda **_kwargs: FakeRedis())
    mission_id = uuid.uuid4()

    event_id = mission_events.publish(mission_id, "mission.started", {"playbook_key": "x"})

    assert event_id == "1730000000000-0"
    assert calls[0][0] == "xadd"
    assert calls[0][1] == f"mission:{mission_id}:events"
    assert calls[0][3] == mission_events.MAX_EVENTS_PER_MISSION
    assert calls[1] == ("expire", f"mission:{mission_id}:events", mission_events.RETENTION_SECONDS)
    assert calls[-1] == ("close",)


def test_mission_event_route_is_tenant_and_permission_scoped(monkeypatch):
    from app.routers import missions as mission_routes

    tenant_id = uuid.uuid4()
    mission = SimpleNamespace(
        id=uuid.uuid4(), tenant_id=tenant_id, sydekyk_id=uuid.uuid4(), status="running",
        playbook_key="ledger.vendor_bill_ingest", signal_type="manual_upload",
        failure_category=None, created_at=None, started_at=None, completed_at=None,
    )
    user = SimpleNamespace(id=uuid.uuid4(), tenant_id=tenant_id, role="commander")
    closed = []
    db = SimpleNamespace(get=lambda _model, _id: mission, close=lambda: closed.append(True))
    checked = []
    monkeypatch.setattr(mission_routes.permissions, "assert_can_use", lambda _db, _user, sid: checked.append(sid))
    monkeypatch.setattr(
        mission_routes.mission_sse,
        "stream_mission_events",
        lambda mid, **kwargs: {"mission_id": mid, **kwargs},
    )

    result = mission_routes.mission_event_stream(
        mission.id, after="4-0", last_event_id=None, user=user, db=db,
    )

    assert checked == [mission.sydekyk_id]
    assert result["mission_id"] == mission.id
    assert result["last_event_id"] == "4-0"
    assert result["snapshot"]["status"] == "running"
    assert closed == [True]


def test_mission_event_route_hides_cross_tenant_mission():
    from app.routers import missions as mission_routes

    mission = SimpleNamespace(id=uuid.uuid4(), tenant_id=uuid.uuid4())
    user = SimpleNamespace(id=uuid.uuid4(), tenant_id=uuid.uuid4(), role="commander")
    db = SimpleNamespace(get=lambda _model, _id: mission)

    with pytest.raises(HTTPException) as exc:
        mission_routes.mission_event_stream(
            mission.id, after=None, last_event_id=None, user=user, db=db,
        )
    assert exc.value.status_code == 404


def test_interactive_agent_commands_return_mission_start_contract():
    from app.main import app

    paths = app.openapi()["paths"]
    commands = [
        "/api/tenant/seal/contracts/{contract_id}/generate",
        "/api/tenant/seal/contracts/{contract_id}/chat",
        "/api/tenant/seal/contracts/{contract_id}/review",
        "/api/tenant/quill/proposals/{proposal_id}/generate",
        "/api/tenant/quill/proposals/{proposal_id}/chat",
        "/api/tenant/signet/envelopes/{envelope_id}/send",
        "/api/tenant/signet/envelopes/{envelope_id}/remind",
    ]

    for path in commands:
        responses = paths[path]["post"]["responses"]
        assert "202" in responses, path
        schema = responses["202"]["content"]["application/json"]["schema"]
        assert schema["$ref"].endswith("/MissionStartOut"), path
