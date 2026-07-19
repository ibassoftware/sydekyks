"""Sydekyk extension packages.

Each subpackage under this directory is one Sydekyk, fully self-contained (playbook, tools,
models, schemas, router, seed). Discovery imports every subpackage so that:
  - `register_playbook(...)` / `register_tool(...)` side-effects run (populating the Mission
    engine's registries),
  - each package's `models.py` is imported (so SQLAlchemy metadata sees its tables before
    Base.metadata.create_all()),
  - each package's `router` and `seed(db)` are collected for the app to mount/run.

Adding a new Sydekyk = adding a new folder here. None of the platform code (main.py, seed.py,
services/missions.py) ever needs editing to register a new one.
"""

import importlib
import pkgutil
from types import ModuleType
from typing import Callable

_discovered: list[ModuleType] | None = None


def discover_sydekyk_packages() -> list[ModuleType]:
    """Import every Sydekyk subpackage exactly once; return the imported package modules."""
    global _discovered
    if _discovered is not None:
        return _discovered

    packages: list[ModuleType] = []
    for info in pkgutil.iter_modules(__path__):
        if not info.ispkg:
            continue
        module = importlib.import_module(f"{__name__}.{info.name}")
        packages.append(module)

    _discovered = packages
    return packages


def collect_routers() -> list:
    """Every Sydekyk package's top-level `router` - plus an optional `public_router` for packages that
    expose an unauthenticated surface (e.g. Signet's token-scoped `/api/sign` signing endpoints)."""
    routers = []
    for pkg in discover_sydekyk_packages():
        for attr in ("router", "public_router"):
            r = getattr(pkg, attr, None)
            if r is not None:
                routers.append(r)
    return routers


def collect_seed_functions() -> list[Callable]:
    """Every Sydekyk package that exposes a top-level `seed(db)` callable."""
    seeds = []
    for pkg in discover_sydekyk_packages():
        seed = getattr(pkg, "seed", None)
        if callable(seed):
            seeds.append(seed)
    return seeds


def delete_tenant_settings(db, model, tenant_id) -> None:
    """Shared body for a package's `uninstall` hook: drop this HQ's row from a `*_tenant_settings`
    table (all such tables are keyed by `tenant_id`)."""
    db.query(model).filter(model.tenant_id == tenant_id).delete(synchronize_session=False)


def collect_uninstall_functions() -> dict[str, Callable]:
    """Map each Sydekyk slug -> its optional `uninstall(db, tenant_id)` teardown callable.

    A package's `uninstall` hook removes only that Sydekyk's own tenant-scoped CONFIG (its
    `*_tenant_settings` row) so a reinstall starts fresh. Operational and historical data (findings,
    proposals, signed contracts/envelopes, missions) is intentionally left untouched. Cross-cutting
    config (LLM engine, permissions, gadget assignments, reviewer assignment) is handled centrally in
    services/sydekyk_uninstall.py, not here."""
    hooks: dict[str, Callable] = {}
    for pkg in discover_sydekyk_packages():
        fn = getattr(pkg, "uninstall", None)
        if callable(fn):
            slug = pkg.__name__.rsplit(".", 1)[-1]
            hooks[slug] = fn
    return hooks
