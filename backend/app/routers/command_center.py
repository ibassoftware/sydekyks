"""One bounded projection for the HQ dashboard.

The dashboard used to fan out into dozens of authenticated requests. Each request needed its own
SQLAlchemy checkout and duplicated insight work. This route computes the same projection
sequentially in one short-lived request/session and lets the browser render every dashboard panel
from that response.
"""

from typing import Any, Callable

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.deps import require_tenant_member
from app.db.session import get_db
from app.models.user import User
from app.routers import missions as missions_router
from app.routers import tenant as tenant_router
from app.schemas.dashboard import DashboardOut
from app.schemas.mission import MissionPage
from app.schemas.sydekyk import SydekykOut
from app.sydekyks.decode.router import get_insights as decode_insights, get_readiness as decode_readiness
from app.sydekyks.ledger.router import get_insights as ledger_insights, get_readiness as ledger_readiness
from app.sydekyks.mirror.router import (
    get_flags as mirror_queue,
    get_insights as mirror_insights,
    get_readiness as mirror_readiness,
)
from app.sydekyks.nudge.router import (
    get_insights as nudge_insights,
    get_queue as nudge_queue,
    get_readiness as nudge_readiness,
)
from app.sydekyks.quill.router import get_insights as quill_insights, get_readiness as quill_readiness
from app.sydekyks.scout.router import get_insights as scout_insights, get_readiness as scout_readiness
from app.sydekyks.seal.router import get_insights as seal_insights, get_readiness as seal_readiness
from app.sydekyks.shield.router import (
    get_insights as shield_insights,
    get_queue as shield_queue,
    get_readiness as shield_readiness,
)
from app.sydekyks.signet.router import get_insights as signet_insights, get_readiness as signet_readiness

router = APIRouter(prefix="/api/tenant", tags=["command-center"])


class CommandCenterOut(BaseModel):
    dashboard: DashboardOut
    sydekyks: list[SydekykOut]
    missions: MissionPage
    insights: dict[str, Any]
    readiness: dict[str, Any]
    queues: dict[str, Any]
    money_saved: float


InsightCall = Callable[..., Any]

INSIGHT_CALLS: dict[str, InsightCall] = {
    "nudge": nudge_insights,
    "quill": quill_insights,
    "seal": seal_insights,
    "signet": signet_insights,
    "ledger": ledger_insights,
    "mirror": mirror_insights,
    "shield": shield_insights,
    "decode": decode_insights,
    "scout": scout_insights,
}

READINESS_CALLS: dict[str, InsightCall] = {
    "nudge": nudge_readiness,
    "quill": quill_readiness,
    "seal": seal_readiness,
    "signet": signet_readiness,
    "ledger": ledger_readiness,
    "mirror": mirror_readiness,
    "shield": shield_readiness,
    "decode": decode_readiness,
    "scout": scout_readiness,
}


@router.get("/command-center", response_model=CommandCenterOut)
def command_center(user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    dashboard = tenant_router.dashboard(user=user, db=db)
    sydekyks = tenant_router.list_sydekyks(user=user, db=db)
    mission_page = missions_router.list_all_missions(
        sydekyk_id=None,
        status_=None,
        signal_type=None,
        source=None,
        filename=None,
        date_from=None,
        date_to=None,
        needs_review=None,
        limit=100,
        offset=0,
        user=user,
        db=db,
    )

    available_slugs = {agent.slug for agent in sydekyks}
    active_slugs = {agent.slug for agent in sydekyks if agent.installed or agent.is_exclusive}
    insights: dict[str, Any] = {}
    readiness: dict[str, Any] = {}

    for slug, call in INSIGHT_CALLS.items():
        if slug in available_slugs:
            insights[slug] = call(user=user, db=db)
    for slug, call in READINESS_CALLS.items():
        if slug in active_slugs:
            readiness[slug] = call(user=user, db=db)

    queues: dict[str, Any] = {}
    if "nudge" in active_slugs:
        queues["nudge"] = nudge_queue(limit=3, offset=0, user=user, db=db)
    if "mirror" in active_slugs:
        queues["mirror"] = mirror_queue(limit=3, offset=0, user=user, db=db)
    if "shield" in active_slugs:
        queues["shield"] = shield_queue(limit=3, offset=0, user=user, db=db)

    money_saved = 0.0
    for slug, insight in insights.items():
        if not getattr(insight, "activated", False):
            continue
        money_saved += max(0.0, float(getattr(insight, "estimated_net_savings", 0.0) or 0.0))
        if slug == "mirror":
            money_saved += max(0.0, float(getattr(insight, "prevented_amount", 0.0) or 0.0))

    return CommandCenterOut(
        dashboard=dashboard,
        sydekyks=sydekyks,
        missions=mission_page,
        insights=insights,
        readiness=readiness,
        queues=queues,
        money_saved=money_saved,
    )
