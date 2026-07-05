"""Generic, Sydekyk-agnostic Mission execution engine.

A Sydekyk registers a *playbook* (an ordered runner function) and optionally *tools* (LLM-callable
functions) by importing this module and calling `register_playbook` / `register_tool` at import time.
The `discover_sydekyk_packages()` mechanism (app/sydekyks/__init__.py) imports every Sydekyk package
so those registrations run — adding a new Sydekyk never requires editing this file.
"""

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable

from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.mission import Mission, MissionDocument, MissionStep
from app.models.sydekyk import Sydekyk
from app.services import document_storage

# ---------------------------------------------------------------------------
# Registries
# ---------------------------------------------------------------------------

# A playbook runner takes (db, mission) and drives the Mission to a terminal status,
# recording MissionSteps as it goes.
PlaybookRunner = Callable[[Session, Mission], None]

PLAYBOOK_REGISTRY: dict[str, PlaybookRunner] = {}


@dataclass
class Tool:
    """An LLM-callable function (genuine tool_calls). Registered per Sydekyk. Minimal/unused by
    Ledger v1 — the convention exists so a future agentic Sydekyk needs no core changes."""

    name: str
    description: str
    parameters: dict = field(default_factory=dict)  # JSON schema for the arguments
    handler: Callable[..., Any] | None = None


TOOL_REGISTRY: dict[str, Tool] = {}

_loaded = False


def register_playbook(key: str, runner: PlaybookRunner) -> None:
    PLAYBOOK_REGISTRY[key] = runner


def register_tool(tool: Tool) -> None:
    TOOL_REGISTRY[tool.name] = tool


def _ensure_loaded() -> None:
    """Lazily trigger Sydekyk-package discovery so every register_* call has run. Imported here
    (not at module top) to avoid a circular import: a Sydekyk package imports this module."""
    global _loaded
    if _loaded:
        return
    from app.sydekyks import discover_sydekyk_packages

    discover_sydekyk_packages()
    _loaded = True


# ---------------------------------------------------------------------------
# Step recording helper (used by every playbook runner)
# ---------------------------------------------------------------------------


def record_step(
    db: Session,
    mission: Mission,
    step_index: int,
    step_key: str,
    step_type: str,
    status: str,
    *,
    input: dict | None = None,
    output: dict | None = None,
    error: str | None = None,
) -> MissionStep:
    now = datetime.now(timezone.utc)
    step = MissionStep(
        mission_id=mission.id,
        step_index=step_index,
        step_key=step_key,
        step_type=step_type,
        status=status,
        input=input,
        output=output,
        error_message=error,
        started_at=now,
        completed_at=now if status in ("succeeded", "failed", "skipped") else None,
    )
    db.add(step)
    db.commit()
    db.refresh(step)
    return step


# ---------------------------------------------------------------------------
# Mission creation (the single convergence point for web upload + email)
# ---------------------------------------------------------------------------


def create_mission_for_document(
    db: Session,
    *,
    tenant_id: uuid.UUID,
    sydekyk: Sydekyk,
    user_id: uuid.UUID | None,
    document_bytes: bytes,
    filename: str,
    content_type: str,
    sha256_hash: str,
    source: str,
    signal_type: str,
) -> Mission:
    """Creates a Mission + its MissionDocument in one transaction. Caller commits and schedules
    run_mission via BackgroundTasks. Used identically by the web-upload router and email webhook."""
    mission = Mission(
        tenant_id=tenant_id,
        user_id=user_id,
        sydekyk_id=sydekyk.id,
        mode="workflow_run",
        signal_type=signal_type,
        playbook_key=sydekyk.playbook_key or "",
        status="queued",
    )
    db.add(mission)
    db.flush()

    document = MissionDocument(
        tenant_id=tenant_id,
        mission_id=mission.id,
        filename=filename,
        content_type=content_type,
        size_bytes=len(document_bytes),
        sha256_hash=sha256_hash,
        source=source,
    )
    document_storage.write_content(document, document_bytes)  # sets storage_backend + content via the boundary
    db.add(document)
    db.commit()
    db.refresh(mission)
    return mission


def retry_mission(db: Session, original: Mission) -> Mission:
    """Create a NEW Mission that replays the original's contract (same Playbook + document).

    Retrying in place is impossible without destroying the audit trail — `mission_steps` has a
    unique (mission_id, step_index). So a retry is a fresh Mission linked via `parent_mission_id`
    to its predecessor and `root_mission_id` to the head of the chain. The document bytes are
    copied through the DocumentStorage boundary (a no-op-cheap copy today; a storage_key copy once
    S3 lands). Only failed Missions may be retried."""
    if original.status != "failed":
        raise ValueError("Only failed Missions can be retried")

    original_doc = db.query(MissionDocument).filter(MissionDocument.mission_id == original.id).first()
    if original_doc is None:
        raise ValueError("Original Mission has no document to replay")

    mission = Mission(
        tenant_id=original.tenant_id,
        user_id=original.user_id,
        sydekyk_id=original.sydekyk_id,
        mode=original.mode,
        signal_type=original.signal_type,
        playbook_key=original.playbook_key,  # replay the ORIGINAL Playbook, not "latest"
        status="queued",
        parent_mission_id=original.id,
        root_mission_id=original.root_mission_id or original.id,
        attempt_number=original.attempt_number + 1,
    )
    db.add(mission)
    db.flush()

    copy = MissionDocument(
        tenant_id=original.tenant_id,
        mission_id=mission.id,
        filename=original_doc.filename,
        content_type=original_doc.content_type,
        size_bytes=original_doc.size_bytes,
        sha256_hash=original_doc.sha256_hash,
        source=original_doc.source,
    )
    document_storage.write_content(copy, document_storage.read_content(original_doc) or b"")
    db.add(copy)
    db.commit()
    db.refresh(mission)
    return mission


# ---------------------------------------------------------------------------
# Background execution
# ---------------------------------------------------------------------------


def run_mission(mission_id: uuid.UUID) -> None:
    """Entry point passed to BackgroundTasks. Opens its own DB session (the request's session is
    already closed), dispatches to the registered runner by playbook_key, and guarantees the
    Mission reaches a terminal status even if the runner raises."""
    _ensure_loaded()
    db = SessionLocal()
    try:
        mission = db.get(Mission, mission_id)
        if mission is None:
            return

        runner = PLAYBOOK_REGISTRY.get(mission.playbook_key)
        if runner is None:
            mission.status = "failed"
            mission.error_message = f"No playbook registered for '{mission.playbook_key}'"
            mission.completed_at = datetime.now(timezone.utc)
            db.commit()
            return

        mission.status = "running"
        mission.started_at = datetime.now(timezone.utc)
        db.commit()

        try:
            runner(db, mission)
        except Exception as exc:  # noqa: BLE001 — top-level guard, message surfaced to the UI
            db.rollback()
            mission = db.get(Mission, mission_id)
            if mission is not None:
                mission.status = "failed"
                mission.error_message = str(exc)[:2000]
                # An unhandled crash is not a classified setup/validation problem — treat as
                # unknown so the queue's retry policy (VS-7) can decide conservatively.
                if mission.failure_category is None:
                    mission.failure_category = "unknown"
                mission.completed_at = datetime.now(timezone.utc)
                db.commit()
            return

        # Runner is expected to set a terminal status; backfill if it forgot.
        mission = db.get(Mission, mission_id)
        if mission is not None:
            if mission.status in ("queued", "running"):
                mission.status = "succeeded"
            if mission.completed_at is None:
                mission.completed_at = datetime.now(timezone.utc)
            db.commit()
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Shared query filters (tenant Missions ops page + admin cross-tenant Command Center)
# ---------------------------------------------------------------------------


def apply_mission_filters(
    query,
    *,
    tenant_id=None,
    sydekyk_id=None,
    status=None,
    signal_type=None,
    source=None,
    filename=None,
    date_from=None,
    date_to=None,
):
    """Applies the common Mission list filters. `tenant_id` is optional here on purpose: the
    tenant router scopes tenant_id directly on its own base query (defense-in-depth), while the
    admin Command Center passes it through as just another optional filter for cross-tenant
    browsing. Requires the query to already join MissionDocument for the source/filename filters."""
    if tenant_id is not None:
        query = query.filter(Mission.tenant_id == tenant_id)
    if sydekyk_id is not None:
        query = query.filter(Mission.sydekyk_id == sydekyk_id)
    if status:
        query = query.filter(Mission.status == status)
    if signal_type:
        query = query.filter(Mission.signal_type == signal_type)
    if source:
        query = query.filter(MissionDocument.source == source)
    if filename:
        query = query.filter(MissionDocument.filename.ilike(f"%{filename}%"))
    if date_from:
        query = query.filter(Mission.created_at >= date_from)
    if date_to:
        query = query.filter(Mission.created_at <= date_to)
    return query
