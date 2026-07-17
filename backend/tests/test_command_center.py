import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

from app.routers import command_center as command_center_routes
from app.schemas.dashboard import DashboardOut
from app.schemas.mission import MissionPage
from app.schemas.sydekyk import SydekykOut


def _agent(slug: str, *, installed: bool) -> SydekykOut:
    return SydekykOut(
        id=uuid.uuid4(),
        name=slug.title(),
        slug=slug,
        tagline="tagline",
        description="description",
        avatar_url=f"/{slug}.png",
        model="test-model",
        is_exclusive=False,
        chat_enabled=False,
        workflow_enabled=True,
        accepts_document_uploads=False,
        installed=installed,
        created_at=datetime.now(timezone.utc),
    )


def test_command_center_aggregates_insights_readiness_queues_and_savings(monkeypatch):
    tenant_id = uuid.uuid4()
    user = SimpleNamespace(tenant_id=tenant_id)
    agents = [_agent("mirror", installed=True), _agent("scout", installed=False)]
    dashboard = DashboardOut(
        tenant_id=tenant_id,
        tenant_name="Acme",
        tenant_slug="acme",
        plan="pro",
        plan_display_name="Pro",
        currency="USD",
        roster_sydekyk_count=1,
        exclusive_sydekyk_count=0,
        tokens_used_this_month=10,
        monthly_token_cap=100,
        token_throttled=False,
        gpu_seconds_used_last_hour=1,
        gpu_seconds_per_hour_cap=10,
        gpu_throttled=False,
    )
    calls: list[str] = []

    monkeypatch.setattr(command_center_routes.tenant_router, "dashboard", lambda **_kwargs: dashboard)
    monkeypatch.setattr(command_center_routes.tenant_router, "list_sydekyks", lambda **_kwargs: agents)
    monkeypatch.setattr(
        command_center_routes.missions_router,
        "list_all_missions",
        lambda **_kwargs: MissionPage(items=[], total=0, limit=100, offset=0),
    )
    monkeypatch.setattr(command_center_routes, "INSIGHT_CALLS", {
        "mirror": lambda **_kwargs: SimpleNamespace(activated=True, estimated_net_savings=5, prevented_amount=7),
        "scout": lambda **_kwargs: SimpleNamespace(activated=False, estimated_net_savings=99),
    })
    monkeypatch.setattr(command_center_routes, "READINESS_CALLS", {
        "mirror": lambda **_kwargs: calls.append("mirror-readiness") or {"items": [], "can_upload": True},
        "scout": lambda **_kwargs: calls.append("scout-readiness") or {"items": [], "can_upload": True},
    })
    monkeypatch.setattr(command_center_routes, "mirror_queue", lambda **_kwargs: {"items": [], "total": 0, "limit": 3, "offset": 0})

    result = command_center_routes.command_center(user=user, db=object())

    assert set(result.insights) == {"mirror", "scout"}
    assert set(result.readiness) == {"mirror"}
    assert calls == ["mirror-readiness"]
    assert set(result.queues) == {"mirror"}
    assert result.money_saved == 12
