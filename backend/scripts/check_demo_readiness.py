"""Demo readiness check (VS-6).

Runs Ledger's readiness computation for a tenant on the CLI and prints each item green/red. Exits
non-zero if any *required* item is blocked, so it can gate a demo/CI step.

    python -m scripts.check_demo_readiness <tenant-slug>
"""

import sys

from app.db.session import SessionLocal
from app.models.sydekyk import Sydekyk
from app.models.tenant import Tenant
from app.sydekyks.ledger import readiness as readiness_svc

_MARK = {"ok": "[ OK ]", "warn": "[WARN]", "blocked": "[FAIL]"}


def main(tenant_slug: str) -> int:
    db = SessionLocal()
    try:
        tenant = db.query(Tenant).filter(Tenant.slug == tenant_slug).first()
        if tenant is None:
            print(f"No tenant with slug '{tenant_slug}'")
            return 2
        ledger = db.query(Sydekyk).filter(Sydekyk.slug == "ledger").first()
        if ledger is None:
            print("Ledger Sydekyk not seeded")
            return 2

        result = readiness_svc.compute_readiness(db, tenant.id, ledger.id)
        print(f"Ledger readiness for tenant '{tenant_slug}':")
        for item in result["items"]:
            print(f"  {_MARK.get(item['state'], '[????]')} {item['label']}: {item['detail'] or ''}")
        print(f"Last inbound email: {result['last_inbound_email'] or 'never'}")
        print(f"Can upload: {result['can_upload']}")
        return 0 if result["can_upload"] else 1
    finally:
        db.close()


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("usage: python -m scripts.check_demo_readiness <tenant-slug>")
        sys.exit(2)
    sys.exit(main(sys.argv[1]))
