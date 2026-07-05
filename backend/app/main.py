from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.routers import admin, auth, gadgets, llm_settings, tenant

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
app.include_router(llm_settings.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
