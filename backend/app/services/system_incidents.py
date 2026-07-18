"""Best-effort failure capture that remains useful when the primary DB pool is exhausted."""

import logging
import traceback as traceback_module
import uuid
from collections import deque
from datetime import datetime, timezone
from threading import Lock

from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import SessionLocal, engine
from app.models.system_incident import SystemIncident
from app.models.tenant import Tenant

logger = logging.getLogger("uvicorn.error")

_fallback: deque[dict] = deque(maxlen=200)
_fallback_lock = Lock()


def _pool_has_room() -> bool:
    """Avoid waiting for the same saturated QueuePool while trying to report its failure."""
    checkedout = getattr(engine.pool, "checkedout", None)
    size = getattr(engine.pool, "size", None)
    if not callable(checkedout) or not callable(size):
        return True
    try:
        return checkedout() < size() + settings.database_max_overflow
    except Exception:  # noqa: BLE001 - diagnostics must never become the user-facing failure
        return True


def _store_fallback(payload: dict) -> None:
    with _fallback_lock:
        _fallback.appendleft(payload)


def record_exception(
    exc: BaseException,
    *,
    source: str = "api",
    method: str | None = None,
    path: str | None = None,
    status_code: int = 500,
    tenant_id: uuid.UUID | None = None,
    mission_id: uuid.UUID | None = None,
) -> uuid.UUID:
    trace = "".join(traceback_module.format_exception(type(exc), exc, exc.__traceback__))[-20000:]
    return record_failure(
        source=source,
        method=method,
        path=path,
        status_code=status_code,
        error_type=type(exc).__name__,
        message=str(exc)[:4000] or type(exc).__name__,
        traceback=trace,
        tenant_id=tenant_id,
        mission_id=mission_id,
        exc=exc,
    )


def record_failure(
    *,
    source: str,
    status_code: int,
    error_type: str,
    message: str,
    method: str | None = None,
    path: str | None = None,
    traceback: str | None = None,
    tenant_id: uuid.UUID | None = None,
    mission_id: uuid.UUID | None = None,
    exc: BaseException | None = None,
) -> uuid.UUID:
    incident_id = uuid.uuid4()
    payload = {
        "id": incident_id,
        "tenant_id": tenant_id,
        "mission_id": mission_id,
        "tenant_name": None,
        "source": source[:40],
        "severity": "error",
        "method": method[:12] if method else None,
        "path": path[:500] if path else None,
        "status_code": status_code,
        "error_type": error_type[:255],
        "message": message[:4000],
        "traceback": traceback[-20000:] if traceback else None,
        "resolved": False,
        "resolved_at": None,
        "created_at": datetime.now(timezone.utc),
    }
    logger.error(
        "[incident:%s] %s %s %s: %s",
        incident_id,
        method or source,
        path or "",
        error_type,
        message,
        exc_info=(type(exc), exc, exc.__traceback__) if exc is not None else None,
    )

    if not _pool_has_room():
        _store_fallback(payload)
        return incident_id

    db = SessionLocal()
    try:
        db.add(SystemIncident(**{key: value for key, value in payload.items() if key != "tenant_name"}))
        db.commit()
    except Exception:  # noqa: BLE001 - the in-memory record is the emergency channel
        db.rollback()
        _store_fallback(payload)
        logger.exception("[incident:%s] database persistence failed; retained in memory", incident_id)
    finally:
        db.close()
    return incident_id


def list_fallback(*, unresolved_only: bool = True) -> list[dict]:
    with _fallback_lock:
        items = [dict(item) for item in _fallback]
    return [item for item in items if not unresolved_only or not item["resolved"]]


def resolve_fallback(incident_id: uuid.UUID) -> bool:
    with _fallback_lock:
        for item in _fallback:
            if item["id"] == incident_id:
                item["resolved"] = True
                item["resolved_at"] = datetime.now(timezone.utc)
                return True
    return False


def _persist_fallback(db: Session) -> None:
    """Move emergency-memory incidents into PostgreSQL once the database is healthy again."""
    with _fallback_lock:
        pending = [dict(item) for item in _fallback]
    if not pending:
        return
    try:
        db.add_all([
            SystemIncident(**{key: value for key, value in item.items() if key != "tenant_name"})
            for item in pending
        ])
        db.commit()
    except Exception:  # noqa: BLE001 - retain the emergency copy for a later retry
        db.rollback()
        return
    persisted_ids = {item["id"] for item in pending}
    with _fallback_lock:
        retained = [item for item in _fallback if item["id"] not in persisted_ids]
        _fallback.clear()
        _fallback.extend(retained)


def incident_rows(db: Session, *, limit: int, unresolved_only: bool) -> tuple[list[dict], int, int]:
    _persist_fallback(db)
    query = db.query(SystemIncident, Tenant.name).outerjoin(Tenant, Tenant.id == SystemIncident.tenant_id)
    if unresolved_only:
        query = query.filter(SystemIncident.resolved.is_(False))
    persisted = query.order_by(SystemIncident.created_at.desc()).limit(limit).all()
    fallback = list_fallback(unresolved_only=unresolved_only)
    items = [
        {
            "id": incident.id,
            "tenant_id": incident.tenant_id,
            "mission_id": incident.mission_id,
            "tenant_name": tenant_name,
            "source": incident.source,
            "severity": incident.severity,
            "method": incident.method,
            "path": incident.path,
            "status_code": incident.status_code,
            "error_type": incident.error_type,
            "message": incident.message,
            "traceback": incident.traceback,
            "resolved": incident.resolved,
            "resolved_at": incident.resolved_at,
            "created_at": incident.created_at,
        }
        for incident, tenant_name in persisted
    ] + fallback
    items.sort(key=lambda item: item["created_at"], reverse=True)
    open_count = db.query(SystemIncident).filter(SystemIncident.resolved.is_(False)).count()
    open_count += len(list_fallback(unresolved_only=True))
    return items[:limit], open_count, len(fallback)
