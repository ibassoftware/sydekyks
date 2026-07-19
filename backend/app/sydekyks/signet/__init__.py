"""Signet Sydekyk - native e-signature dispatch + tracking. Importing the package registers its
playbooks + SQLAlchemy metadata and exposes `router`, `public_router`, and `seed` for the generic
discovery loop (app/sydekyks/__init__.py)."""

from app.sydekyks.signet import models, playbook  # noqa: F401 - import for registration side-effects
from app.sydekyks.signet.public_router import router as public_router  # noqa: F401 - collected by collect_routers()
from app.sydekyks.signet.router import router  # noqa: F401 - collected by collect_routers()
from app.sydekyks.signet.seed import seed  # noqa: F401 - collected by collect_seed_functions()


def uninstall(db, tenant_id):  # collected by app.sydekyks.collect_uninstall_functions
    """Remove this HQ's signet settings on uninstall so a reinstall starts fresh. Operational and
    historical data is intentionally preserved."""
    from app.sydekyks import delete_tenant_settings

    delete_tenant_settings(db, models.SignetTenantSettings, tenant_id)
