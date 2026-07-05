"""Scripted schema drift check (replaces eyeballing autogenerate output).

Reflects the live database and compares it to `Base.metadata`, printing any tables/columns that
differ. Exit code 0 == in sync, 1 == drift. Use this before generating each new slice migration
and as the VS-0 baseline verification step.

    python -m scripts.schema_diff
"""

import sys

from sqlalchemy import create_engine, inspect

from app.core.config import settings
from app.db.session import Base
import app.models  # noqa: F401 — register platform tables
from app.sydekyks import discover_sydekyk_packages


def main() -> int:
    discover_sydekyk_packages()
    engine = create_engine(settings.database_url)
    inspector = inspect(engine)

    live_tables = set(inspector.get_table_names())
    model_tables = set(Base.metadata.tables.keys())

    drift = False

    missing_in_db = model_tables - live_tables - {"alembic_version"}
    extra_in_db = live_tables - model_tables - {"alembic_version"}
    if missing_in_db:
        drift = True
        print(f"Tables in models but NOT in DB: {sorted(missing_in_db)}")
    if extra_in_db:
        print(f"Tables in DB but not in models (informational): {sorted(extra_in_db)}")

    for table_name in sorted(model_tables & live_tables):
        model_cols = {c.name for c in Base.metadata.tables[table_name].columns}
        live_cols = {c["name"] for c in inspector.get_columns(table_name)}
        missing = model_cols - live_cols
        if missing:
            drift = True
            print(f"[{table_name}] columns in model but NOT in DB: {sorted(missing)}")

    if not drift:
        print("Schema in sync with models.")
        return 0
    print("Schema drift detected — generate/apply a migration.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
