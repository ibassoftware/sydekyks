"""System watch persistence, emergency fallback, and admin resolution."""

import uuid

from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from app.main import app
from app.models.system_incident import SystemIncident
from app.services import system_incidents


def test_emergency_fallback_does_not_require_a_database(monkeypatch):
    monkeypatch.setattr(system_incidents, "_pool_has_room", lambda: False)
    incident_id = system_incidents.record_failure(
        source="api",
        method="GET",
        path="/api/tenant/command-center",
        status_code=500,
        error_type="TimeoutError",
        message="pool exhausted",
    )
    incident = next(item for item in system_incidents.list_fallback() if item["id"] == incident_id)
    assert incident["error_type"] == "TimeoutError"
    assert incident["path"] == "/api/tenant/command-center"
    assert system_incidents.resolve_fallback(incident_id) is True


def test_admin_lists_and_resolves_persisted_incident(db, engine):
    from app.core.deps import require_super_admin
    from app.db.session import get_db

    incident = SystemIncident(
        id=uuid.uuid4(),
        source="mission",
        status_code=500,
        error_type="RuntimeError",
        message="playbook failed",
        path="nudge.follow_up",
    )
    db.add(incident)
    db.commit()

    Session = sessionmaker(bind=engine)

    def _db_override():
        session = Session()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[require_super_admin] = lambda: None
    app.dependency_overrides[get_db] = _db_override
    try:
        client = TestClient(app)
        page = client.get("/api/admin/incidents").json()
        assert page["open_count"] == 1
        assert page["items"][0]["message"] == "playbook failed"

        response = client.post(f"/api/admin/incidents/{incident.id}/resolve")
        assert response.status_code == 204
        assert client.get("/api/admin/incidents").json()["open_count"] == 0
    finally:
        app.dependency_overrides.clear()
