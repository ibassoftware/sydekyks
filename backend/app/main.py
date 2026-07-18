import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from app.core.config import settings
from app.routers import (
    admin,
    auth,
    command_center,
    documents,
    email_webhook,
    gadget_assignments,
    gadgets,
    issues,
    llm_settings,
    missions,
    review_assignments,
    team,
    tenant,
)
from app.sydekyks import collect_routers
from app.services import system_incidents

logger = logging.getLogger("uvicorn.error")


def _run_migrations() -> None:
    """Apply `alembic upgrade head` in-process (idempotent — no-ops when already at head)."""
    from alembic import command
    from alembic.config import Config

    ini_path = Path(__file__).resolve().parent.parent / "alembic.ini"
    command.upgrade(Config(str(ini_path)), "head")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Optional startup bootstrap so a fresh pull (new tables / new agents) is ready without remembering
    # to run migrate + seed by hand. Both are idempotent; both are OFF by default (see config).
    if settings.auto_migrate:
        try:
            logger.info("[bootstrap] applying migrations (alembic upgrade head)…")
            _run_migrations()
        except Exception:  # noqa: BLE001 — never let a bootstrap error stop the API from booting
            logger.exception("[bootstrap] migration failed")
    if settings.auto_seed:
        try:
            logger.info("[bootstrap] seeding catalog (idempotent)…")
            from app.seed import run as seed_run

            seed_run()
        except Exception:  # noqa: BLE001
            logger.exception("[bootstrap] seed failed")
    yield


app = FastAPI(title="Sydekyks API", lifespan=lifespan)


@app.middleware("http")
async def capture_failure_responses(request: Request, call_next):
    """HTTPExceptions are converted to responses before the catch-all handler sees them.

    Recording explicit 5xx responses here closes that observability gap. Unhandled exceptions are
    recorded by the handler below with their original traceback.
    """
    response = await call_next(request)
    if response.status_code >= 500 and not getattr(request.state, "incident_logged", False):
        request.state.incident_logged = True
        await run_in_threadpool(
            system_incidents.record_failure,
            source="api",
            method=request.method,
            path=request.url.path,
            status_code=response.status_code,
            error_type="HTTPErrorResponse",
            message=f"{request.method} {request.url.path} returned HTTP {response.status_code}",
        )
    return response


@app.exception_handler(Exception)
async def capture_unhandled_exception(request: Request, exc: Exception):
    request.state.incident_logged = True
    incident_id = await run_in_threadpool(
        system_incidents.record_exception,
        exc,
        source="api",
        method=request.method,
        path=request.url.path,
        status_code=500,
    )
    return JSONResponse(
        status_code=500,
        content={"detail": "An unexpected system failure was recorded for Command Center review.", "incident_id": str(incident_id)},
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(admin.router)
app.include_router(tenant.router)
app.include_router(command_center.router)
app.include_router(gadgets.router)
app.include_router(gadget_assignments.router)
app.include_router(llm_settings.router)
app.include_router(documents.router)
app.include_router(missions.router)
app.include_router(team.router)
app.include_router(review_assignments.router)
app.include_router(issues.router)
app.include_router(email_webhook.router)

# Mount every discovered Sydekyk package's own router (e.g. Ledger's settings). Adding a new
# Sydekyk with a router requires no edit here.
for _sydekyk_router in collect_routers():
    app.include_router(_sydekyk_router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
