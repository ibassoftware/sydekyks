# Updating Sydekyks

How to bring an environment up to the latest `main` — both a **local dev workspace** and the
**production server**. For the *first-time* production setup (DNS, TLS, secrets), see
[`deploy/README.md`](../deploy/README.md); this doc is for routine updates.

## Mental model — three things can change on a pull

| Change | How it's applied | Data-safe? |
|---|---|---|
| **Code** (backend/frontend) | Rebuild the image / reinstall deps | yes |
| **Schema** (`backend/migrations/versions/*`) | `alembic upgrade head` | yes — additive, never drops |
| **Catalog** (roster Sydekyks, gadgets, admin) | `python -m app.seed` (idempotent) | yes — only fills what's missing |

A new agent (like Seal/Signet) usually touches **all three**: new code, a new migration, and a new
seed entry. If you migrate but forget to seed, the tables exist but the agent won't appear in the
roster. If you seed but forget to migrate, seeding fails on missing tables. **Do both, in order:
migrate → seed.**

---

## Local dev workspace

Prereqs: the dev Postgres container is running (`docker ps` should show `sydekyks-postgres`), and the
backend virtualenv lives at `backend/.venv`.

```bash
# 1. Get the latest code
git checkout main && git pull

# 2. Backend — deps, then schema, then catalog
cd backend
.venv/bin/pip install -r requirements.txt        # picks up new libs (e.g. weasyprint/pypdf for PDFs)
.venv/bin/alembic upgrade head                    # apply new migrations
.venv/bin/python -m app.seed                      # idempotent: adds new roster agents / gadgets

# 3. Frontend — deps (safe to run every time; no-ops if unchanged)
cd ../frontend
npm install

# 4. Sanity check
cd ../backend && .venv/bin/python -m pytest -q    # needs the test DB reachable
cd ../frontend && npx tsc -b                       # must be clean — this is what the prod build runs
```

Run the app: backend `cd backend && .venv/bin/uvicorn app.main:app --reload`, frontend
`cd frontend && npm run dev`.

> Local seeding is **manual** (`python -m app.seed`) — unlike production, local has no `AUTO_SEED`.
> After any pull that adds an agent, re-run the seed or you won't see it in the roster.

---

## Production server (`sydekyks.com`)

SSH: `ssh root@45.76.46.112` → `cd /opt/sydekyks`.

```bash
cd /opt/sydekyks
git pull                                                    # or: git fetch origin && git reset --hard origin/main
docker compose -f docker-compose.prod.yml up -d --build
```

That's the whole routine update. On the backend container's startup, the entrypoint / lifespan
**auto-runs migrations (`RUN_MIGRATIONS=1`) and the catalog seed (`AUTO_SEED=1`)** — both idempotent —
so new tables and new agents come online with no manual step. Named volumes
(`postgres_data`, `redis_data`, `litellm_postgres_data`, `traefik_letsencrypt`) persist across
rebuilds, so **no data is lost**.

### Verify a deploy

```bash
cd /opt/sydekyks
git rev-parse --short HEAD                                          # should match origin/main
docker compose -f docker-compose.prod.yml ps                        # all services Up; postgres healthy
docker compose -f docker-compose.prod.yml logs backend | tail -30   # migrations + "Application startup complete"
curl -sS -o /dev/null -w '%{http_code}\n' https://sydekyks.com/api/admin/tenants   # 401 = API healthy
curl -sSI https://sydekyks.com | head -1                            # HTTP/2 200 = site up
```

> A brief **502** right after `up -d` is normal — the backend runs migrations + seed in its startup
> lifespan before Uvicorn accepts traffic. Give it ~15s and re-check.

### Watching a slow build

The frontend build (`npm run build`) is the long/memory-heavy step on this small box. To avoid an
SSH timeout, run it detached and tail the log:

```bash
setsid bash -c 'docker compose -f docker-compose.prod.yml up -d --build > deploy-build.log 2>&1' &
tail -f deploy-build.log
```

---

## Rollback

- **Bad code deploy:** `git reset --hard <previous-good-sha> && docker compose -f docker-compose.prod.yml up -d --build`.
- **Migrations are NOT auto-reverted.** They're additive and forward-only in practice. If a migration
  itself is the problem, downgrade explicitly: `docker compose ... exec backend alembic downgrade -1`
  (only if that migration has a working `downgrade()`), then redeploy the previous code.
- **Full fallback to the old Meteor site** (only relevant right after the original cutover):
  `docker compose -f docker-compose.prod.yml down && docker start app mongodb`.

## Backups (run before any risky change)

All app data is in Postgres (documents are stored as `bytea`, not on disk), so one dump is complete:

```bash
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U sydekyks sydekyks | gzip > sydekyks-$(date +%F).sql.gz
```

Restore: `gunzip -c sydekyks-DATE.sql.gz | docker compose ... exec -T postgres psql -U sydekyks sydekyks`.

---

## Pre-push checklist (avoid breaking the deploy)

The production build fails hard on TypeScript errors (a stray unused import once blocked a deploy).
Before pushing to `main`, run locally:

```bash
cd frontend && npx tsc -b          # frontend must compile clean (prod build runs this)
cd backend && .venv/bin/python -m pytest -q
```

Consider a CI check that runs both on every PR so a broken build can't reach `main`.

## Troubleshooting cheatsheet

| Symptom | Cause | Fix |
|---|---|---|
| New agent missing from roster | Seed didn't run | `docker compose ... exec backend python -m app.seed` (prod) / `python -m app.seed` (local) |
| Seed errors on missing table | Migrations not applied | `alembic upgrade head` first, then seed |
| 502 right after deploy | Backend still running startup migrations/seed | wait ~15s, re-check `logs backend` |
| Build fails on `tsc` error | TypeScript error in a `.tsx` | fix locally (`npx tsc -b`), commit, redeploy — old container keeps serving until build succeeds |
| Login fails on a fresh DB | Admin never seeded | run the seed (creates the `ADMIN_EMAIL`/`ADMIN_PASSWORD` super-admin) |
