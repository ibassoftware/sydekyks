#!/usr/bin/env bash
#
# dev.sh — launch the full Sydekyks local stack in one terminal.
#
#   Postgres (docker)  ─┐
#   Redis    (docker)  ─┤→  backend (uvicorn --reload)
#                        │   worker  (arq)
#                        └→  frontend (vite)
#
# All logs stream to THIS terminal, each line prefixed + colored by service so you can
# see every error as it happens. Ctrl-C stops everything cleanly.
#
# Usage:  ./dev.sh            (start everything)
#         ./dev.sh --no-front (skip the frontend, e.g. backend-only debugging)
#
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

VENV="$SCRIPT_DIR/.venv"
BACKEND_PORT=9028
FRONTEND=1
[[ "${1:-}" == "--no-front" ]] && FRONTEND=0

# Point the Vite dev-server's /api proxy at our backend port (vite.config.ts reads this;
# it defaults to 127.0.0.1:8000 otherwise). Exported so the frontend process inherits it.
export VITE_API_PROXY="http://127.0.0.1:$BACKEND_PORT"

# ── helpers ─────────────────────────────────────────────────────────────────
c_red=$'\033[31m'; c_grn=$'\033[32m'; c_ylw=$'\033[33m'; c_blu=$'\033[34m'
c_mag=$'\033[35m'; c_cyn=$'\033[36m'; c_rst=$'\033[0m'; c_bold=$'\033[1m'

say()  { echo "${c_bold}${c_cyn}▶ $*${c_rst}"; }
die()  { echo "${c_bold}${c_red}✗ $*${c_rst}" >&2; exit 1; }

# run NAME COLOR DIR cmd...  → runs cmd (from DIR) as ONE background job of the main
# shell, streaming combined stdout+stderr to this terminal with a colored [NAME]
# prefix on every line. The whole `pipeline &` is a job here (not nested in a
# subshell that returns), so the final `wait` tracks it. awk fflush() keeps output
# live; PYTHONUNBUFFERED stops Python from holding logs back through the pipe.
run() {
  local name=$1 color=$2 dir=$3; shift 3
  ( cd "$dir" && exec env PYTHONUNBUFFERED=1 "$@" ) 2>&1 \
    | awk -v p="${color}[${name}]${c_rst} " '{ print p $0; fflush() }' &
}

# ensure_docker NAME  -- start an existing container, or fail telling you to create it.
ensure_container() {
  local name=$1; shift
  if docker ps --format '{{.Names}}' | grep -qx "$name"; then
    say "$name already running"
  elif docker ps -a --format '{{.Names}}' | grep -qx "$name"; then
    say "starting existing container $name"
    docker start "$name" >/dev/null || die "could not start $name"
  else
    say "creating container $name"
    "$@" >/dev/null || die "could not create $name"
  fi
}

# ── preflight ───────────────────────────────────────────────────────────────
command -v docker >/dev/null || die "docker not found on PATH"
docker info >/dev/null 2>&1   || die "docker daemon not running — start Docker Desktop first"
[[ -x "$VENV/bin/uvicorn" ]]  || die "backend venv missing at $VENV (expected .venv at repo root)"
[[ -f backend/.env ]]         || die "backend/.env missing"

# Postgres — host 5433 → container 5432 (matches backend/.env DATABASE_URL)
ensure_container sydekyks-postgres \
  docker run -d --name sydekyks-postgres --restart unless-stopped \
    -e POSTGRES_USER=sydekyks -e POSTGRES_PASSWORD=sydekyks -e POSTGRES_DB=sydekyks \
    -p 5433:5432 -v postgres_data:/var/lib/postgresql/data pgvector/pgvector:pg16

# Redis — host 6380 → container 6379 (dedicated; avoids other Redis on 6379)
ensure_container sydekyks-redis-dev \
  docker run -d --name sydekyks-redis-dev --restart unless-stopped \
    -p 6380:6379 -v sydekyks_redis_dev_data:/data \
    redis:7-alpine redis-server --appendonly yes

# LiteLLM proxy (:4000) + its own Postgres — the backend routes all model calls through this
# (settings.litellm_proxy_url defaults to http://localhost:4000). Both services are already
# defined in docker-compose.yml; we bring up ONLY those two by name so compose leaves the
# file's `postgres`/`redis` services (which we run standalone) untouched. The proxy starts with
# an empty model_list — models + provider API keys are configured in-app via Settings.
say "ensuring LiteLLM proxy (docker compose)…"
docker compose -f "$SCRIPT_DIR/docker-compose.yml" up -d litellm-postgres litellm-proxy >/dev/null \
  || die "could not start LiteLLM services (docker compose up litellm-postgres litellm-proxy)"

# Wait for Postgres to accept connections before the backend runs migrations.
say "waiting for Postgres…"
for i in $(seq 1 30); do
  docker exec sydekyks-postgres pg_isready -U sydekyks >/dev/null 2>&1 && break
  [[ $i == 30 ]] && die "Postgres did not become ready in 30s"
  sleep 1
done
say "Postgres ready"

# Wait for LiteLLM to answer (first run pulls a large image — don't fail the stack over it).
say "waiting for LiteLLM proxy on :4000…"
for i in $(seq 1 60); do
  curl -sf http://localhost:4000/health/liveliness >/dev/null 2>&1 && { say "LiteLLM ready"; break; }
  [[ $i == 60 ]] && echo "${c_ylw}⚠ LiteLLM not ready after 60s — continuing anyway (check: docker logs sydekyks-litellm-proxy)${c_rst}"
  sleep 1
done

# ── cleanup on exit ─────────────────────────────────────────────────────────
# Background jobs share this script's process group; `kill 0` on exit takes them
# all down (backend, worker, frontend + their children). The docker containers
# are left running on purpose — they're cheap and hold your data.
cleanup() {
  echo
  say "shutting down (containers left running)…"
  trap - EXIT INT TERM
  kill 0 2>/dev/null
}
trap cleanup EXIT INT TERM

# ── launch services ─────────────────────────────────────────────────────────
say "starting backend on :$BACKEND_PORT (uvicorn --reload)…"
run backend "$c_grn" backend "$VENV/bin/uvicorn" app.main:app --reload --port "$BACKEND_PORT"

say "starting worker (arq)…"
run worker "$c_mag" backend "$VENV/bin/arq" worker.WorkerSettings

if [[ $FRONTEND == 1 ]]; then
  say "starting frontend (vite)…"
  run frontend "$c_blu" frontend npm run dev
fi

echo
say "${c_bold}all services launched.${c_rst}  frontend → http://localhost:5173   backend → http://localhost:$BACKEND_PORT   litellm → http://localhost:4000"
say "press ${c_bold}Ctrl-C${c_rst}${c_cyn} to stop everything."
echo

# Wait on all background jobs; if any one dies, its error is already on screen.
wait
