"""Ledger - the vendor-bill ingestion Sydekyk.

Importing this package triggers:
  - models import (LedgerTenantSettings table registered with SQLAlchemy metadata),
  - playbook registration (register_playbook("ledger.vendor_bill_ingest", run)),
  - tools registration (none for v1).
It exposes `router` (settings endpoints) and `seed` (capability flags + gadget requirements),
both collected generically by the platform's discovery mechanism.
"""

from app.sydekyks.ledger import models, playbook, tools  # noqa: F401 - import for registration side-effects
from app.sydekyks.ledger.router import router  # noqa: F401 - collected by app.sydekyks.collect_routers
from app.sydekyks.ledger.seed import seed  # noqa: F401 - collected by app.sydekyks.collect_seed_functions


def uninstall(db, tenant_id):  # collected by app.sydekyks.collect_uninstall_functions
    """Remove this HQ's ledger settings on uninstall so a reinstall starts fresh. Operational and
    historical data is intentionally preserved."""
    from app.sydekyks import delete_tenant_settings

    delete_tenant_settings(db, models.LedgerTenantSettings, tenant_id)
