#!/bin/sh
set -e

# Only the API container runs migrations (RUN_MIGRATIONS=1); the worker skips this so the two never
# race on the alembic version lock. `alembic upgrade head` is idempotent and safe to re-run.
if [ "${RUN_MIGRATIONS:-0}" = "1" ]; then
  echo "[entrypoint] applying database migrations (alembic upgrade head)…"
  alembic upgrade head
fi

exec "$@"
