from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.routers import (
    admin,
    auth,
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

app = FastAPI(title="Sydekyks API")

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
