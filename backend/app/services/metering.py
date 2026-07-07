"""GPU-second estimation + per-tenant cap resolution.

Two metering dimensions, both derived from the token counts already on UsageRecord:
  - monthly TOKEN budget  (calendar month, prorated on mid-month signup)
  - rolling-hour GPU-SECOND rate limit

`estimate_gpu_seconds` is called once per hosted-AI call (at usage-record write time) and its result
frozen on the row, so retuning rates/multipliers later never silently re-values historical usage.
"""

import calendar
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.metering import (
    METERING_CONFIG_KEY,
    ModelRateProfile,
    PlanTier,
    PlatformMeteringConfig,
)
from app.models.tenant import Tenant
from app.models.usage_record import UsageRecord

# Fallbacks used only if the (seeded) config rows are missing — keeps estimation total even on a
# drifted DB. Mirror the migration seeds.
_DEFAULT_PROMPT_RATE = 3000.0
_DEFAULT_GENERATION_RATE = 50.0
_DEFAULT_PLAN_CAPS = {
    "starter": (20_000_000, 3_600.0),
    "intermediate": (100_000_000, 18_000.0),
    "pro": (500_000_000, 50_000.0),
}


def get_config(db: Session) -> PlatformMeteringConfig:
    """The singleton global rate config, get-or-created so callers never handle a missing row."""
    cfg = db.get(PlatformMeteringConfig, METERING_CONFIG_KEY)
    if cfg is None:
        cfg = PlatformMeteringConfig(
            key=METERING_CONFIG_KEY,
            prompt_rate=_DEFAULT_PROMPT_RATE,
            generation_rate=_DEFAULT_GENERATION_RATE,
        )
        db.add(cfg)
        db.commit()
        db.refresh(cfg)
    return cfg


def ensure_model_multiplier(db: Session, model: str | None) -> float:
    """Return the model's GPU multiplier, auto-creating a ×1.0 profile row the first time a model
    is seen. This keeps the Command Center's per-model list populated with exactly the models that
    have actually run, so an admin never has to guess model names to weight. Flushes (does not
    commit) — the caller's transaction owns the commit."""
    if not model:
        return 1.0
    row = db.query(ModelRateProfile).filter(ModelRateProfile.model == model).first()
    if row is None:
        row = ModelRateProfile(model=model, multiplier=1.0)
        db.add(row)
        db.flush()
    return row.multiplier


def estimate_gpu_seconds(db: Session, model: str | None, prompt_tokens: int, completion_tokens: int) -> float:
    """gpu_seconds = multiplier * ( prompt_tokens/prompt_rate + completion_tokens/generation_rate )."""
    cfg = get_config(db)
    prompt_rate = cfg.prompt_rate or _DEFAULT_PROMPT_RATE
    generation_rate = cfg.generation_rate or _DEFAULT_GENERATION_RATE
    base = (prompt_tokens / prompt_rate) + (completion_tokens / generation_rate)
    return round(ensure_model_multiplier(db, model) * base, 4)


# ---------------------------------------------------------------------------
# Cap resolution
# ---------------------------------------------------------------------------


def _plan_defaults(db: Session, plan: str) -> tuple[int, float]:
    tier = db.get(PlanTier, plan)
    if tier is not None:
        return tier.monthly_token_cap, tier.gpu_seconds_per_hour_cap
    return _DEFAULT_PLAN_CAPS.get(plan, _DEFAULT_PLAN_CAPS["starter"])


def _month_start(now: datetime) -> datetime:
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def _proration_factor(tenant: Tenant, now: datetime) -> float:
    """Fraction of the current month a mid-month-signup tenant is entitled to. A tenant created
    before this month gets the full cap (1.0); one created this month is prorated by the share of
    the month remaining from their signup day onward."""
    created = tenant.created_at
    if created is None:
        return 1.0
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    if created < _month_start(now):
        return 1.0
    days_in_month = calendar.monthrange(now.year, now.month)[1]
    remaining = days_in_month - created.day + 1  # inclusive of signup day
    return max(0.0, min(1.0, remaining / days_in_month))


def resolve_caps(db: Session, tenant: Tenant, now: datetime | None = None) -> dict:
    """The effective caps for this tenant: per-tenant override if set, else the plan tier default.
    The monthly token cap is prorated for a mid-month signup; the GPU/hour rate limit is not (it's
    an instantaneous rate, not a monthly allowance)."""
    now = now or datetime.now(timezone.utc)
    default_tokens, default_gpu = _plan_defaults(db, tenant.plan)

    token_cap = tenant.monthly_token_cap_override
    if token_cap is None:
        token_cap = int(round(default_tokens * _proration_factor(tenant, now)))
    gpu_cap = tenant.gpu_seconds_per_hour_cap_override
    if gpu_cap is None:
        gpu_cap = default_gpu
    return {"monthly_token_cap": int(token_cap), "gpu_seconds_per_hour_cap": float(gpu_cap)}


# ---------------------------------------------------------------------------
# Windowed usage
# ---------------------------------------------------------------------------


def tokens_used_this_month(db: Session, tenant_id: uuid.UUID, now: datetime | None = None) -> int:
    now = now or datetime.now(timezone.utc)
    total = (
        db.query(func.coalesce(func.sum(UsageRecord.total_tokens), 0))
        .filter(UsageRecord.tenant_id == tenant_id, UsageRecord.created_at >= _month_start(now))
        .scalar()
    )
    return int(total or 0)


def gpu_seconds_last_hour(db: Session, tenant_id: uuid.UUID, now: datetime | None = None) -> float:
    now = now or datetime.now(timezone.utc)
    total = (
        db.query(func.coalesce(func.sum(UsageRecord.estimated_gpu_seconds), 0.0))
        .filter(UsageRecord.tenant_id == tenant_id, UsageRecord.created_at >= now - timedelta(hours=1))
        .scalar()
    )
    return float(total or 0.0)


def tenant_usage_summary(db: Session, tenant: Tenant, now: datetime | None = None) -> dict:
    """Everything the Command Center needs for one tenant: caps, current usage in each window, and
    whether each dimension is currently throttled."""
    now = now or datetime.now(timezone.utc)
    caps = resolve_caps(db, tenant, now)
    tokens = tokens_used_this_month(db, tenant.id, now)
    gpu = gpu_seconds_last_hour(db, tenant.id, now)
    return {
        "monthly_token_cap": caps["monthly_token_cap"],
        "tokens_used_this_month": tokens,
        "token_throttled": caps["monthly_token_cap"] > 0 and tokens >= caps["monthly_token_cap"],
        "gpu_seconds_per_hour_cap": caps["gpu_seconds_per_hour_cap"],
        "gpu_seconds_used_last_hour": round(gpu, 2),
        "gpu_throttled": caps["gpu_seconds_per_hour_cap"] > 0 and gpu >= caps["gpu_seconds_per_hour_cap"],
    }
