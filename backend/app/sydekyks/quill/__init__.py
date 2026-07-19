"""Quill Sydekyk - proposal generator. Importing the package registers its playbooks + SQLAlchemy
metadata and exposes `router` + `seed` for the generic discovery loop (app/sydekyks/__init__.py)."""

from app.sydekyks.quill import models, playbook  # noqa: F401 - import for registration side-effects
from app.sydekyks.quill.router import router  # noqa: F401 - collected by collect_routers()
from app.sydekyks.quill.seed import seed  # noqa: F401 - collected by collect_seed_functions()


def uninstall(db, tenant_id):  # collected by app.sydekyks.collect_uninstall_functions
    """Remove this HQ's quill settings on uninstall so a reinstall starts fresh. Operational and
    historical data is intentionally preserved."""
    from app.sydekyks import delete_tenant_settings

    delete_tenant_settings(db, models.QuillTenantSettings, tenant_id)
