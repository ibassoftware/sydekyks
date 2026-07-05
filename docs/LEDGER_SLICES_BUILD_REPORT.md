# Ledger Vertical Slices — Build Report

Date: 2026-07-05
Branch: `feature/ledger-vertical-slices`
Plan: `docs/LEDGER_VERTICAL_SLICES.md` · Feedback: `docs/LEDGER_VERTICAL_SLICES_FEEDBACK.md`

All 16 slices (VS-0 … VS-15) were implemented in one coordinated pass, in the feedback's
foundation-first order. This report records what shipped per slice, how it was verified, the four
product decisions honored, and exactly what still needs a live environment (Postgres/Redis/LLM) to
confirm.

## Commits

| Commit | Contents |
|--------|----------|
| `73c1d1e` | docs: readiness review + vertical slices plan + feedback |
| `857d30f` | backend: all backend slices (models, migrations, services, endpoints, tests) |
| `abfb3da` | frontend: registry refactor, readiness/email/playbook UI, ops page, retry, export |
| _(this update)_ | infra: Redis in compose, idempotent migrations, verification, report update |

## Verification performed — LIVE (Docker Postgres + Redis, this environment)

Ran against the real `pgvector/pgvector:pg16` Postgres and `redis:7-alpine` from `docker-compose.yml`.

| Check | Result |
|-------|--------|
| `python -m compileall app worker.py migrations scripts` | ✅ clean |
| `import app.main` + OpenAPI schema | ✅ all new routes registered |
| **`alembic upgrade head` on a fresh DB** (`sydekyks_alembic`) | ✅ 0001→0004 applied clean |
| **`scripts.schema_diff` after upgrade** | ✅ "Schema in sync with models." |
| **`alembic downgrade base` then `upgrade head`** | ✅ reversible + idempotent |
| **Existing drifted DB: `alembic stamp 0001_baseline` + `upgrade head`** (`sydekyks`) | ✅ new cols/tables added; `schema_diff` clean |
| **`pytest tests/` against real Postgres** (`TEST_DATABASE_URL=…/sydekyks_test`) | ✅ **19 passed** (incl. 3 DB-gated: playbook success+usage, setup-failure classification, retry lineage) |
| **VS-7 queue: `enqueue_mission` with `queue_enabled=true`** | ✅ returned `"queue"`; job landed in Redis as `arq:job:mission:<id>` |
| **VS-7 worker: `arq WorkerSettings` (burst)** | ✅ registered `run_mission_task`; queue depth 1 → 0 after burst; 5 result keys stored |
| `tsc -b` (frontend typecheck) | ✅ 0 errors |
| `vite build` | ✅ 97 modules, built clean |
| VS-9 DoD grep (no `slug === "ledger"` / `"ledger.vendor_bill_ingest"` branches in shared files) | ✅ branches removed (only a shared `LedgerReadiness` *type* import remains) |

**Migration idempotency fix (found during live testing):** the name-filtered `create_all` baseline
builds `missions`/`ledger_tenant_settings` from the *current* models (which already carry the new
columns), so a fresh-DB `upgrade head` collided when the additive migration re-added them. Fixed by
making the additive migrations idempotent via `migrations/helpers.py` (`has_column`/`has_table`/
`has_index`/`has_fk` guards). This also makes `stamp` + `upgrade` safe on the real drifted demo DB —
now proven by the two rows above.

## Still needs a real LLM to confirm (LiteLLM proxy is up, but no tenant engine/key wired here)

1. **Vision probe** (VS-12) and **usage emission** (VS-15) — the code path is exercised by the
   DB-gated `test_playbook_success_and_usage` test (which asserts a `usage_records` row is written
   with the right token count via a faked engine); a real vision call additionally needs a tenant
   with a configured LiteLLM virtual key + vision model. `reconcile_tenant` vs LiteLLM spend is
   unit-shaped but not run against live spend.
2. **Postmark webhook** HTTP path (VS-8/VS-11) — parser + branch logic are unit-tested; a real
   inbound POST would exercise the rate-limiter and event rows end to end.

## How to run

```
# infra
docker compose up -d postgres redis         # Redis now in compose (VS-7)

# backend
pip install -r backend/requirements.txt
cd backend
alembic upgrade head                        # fresh DB: builds everything (was: create_all)
#   existing/drifted DB instead: alembic stamp 0001_baseline && alembic upgrade head
python -m scripts.schema_diff               # expect "Schema in sync with models."
python -m app.seed                          # data only now; SCHEMA_AUTO_CREATE=1 to also create tables
arq worker.WorkerSettings                   # only if queue_enabled=true (needs Redis)
python -m scripts.check_demo_readiness acme # VS-6 demo gate

# tests (real Postgres)
TEST_DATABASE_URL=postgresql+psycopg://sydekyks:sydekyks@localhost:5432/sydekyks_test pytest

# frontend
cd frontend && npm run build
```

---

## Per-slice detail

### VS-0 — Alembic baseline 🔒 (foundation, first)
- Added `alembic`, `arq`, `redis`, `pillow`, `pytest` to `backend/requirements.txt`.
- `backend/alembic.ini`, `migrations/env.py` (URL from settings; imports all models + runs Sydekyk
  discovery so `ledger_tenant_settings` is in `target_metadata`), `migrations/script.py.mako`.
- `0001_baseline` reproduces the pre-Alembic tables by name via a filtered `create_all`, so later
  slice migrations own their own tables/columns without collision. Existing DBs `stamp` it.
- `scripts/schema_diff.py` — scripted drift check (replaces eyeballing autogenerate).
- `seed.py` no longer calls `create_all` unconditionally; gated behind `SCHEMA_AUTO_CREATE=1` for
  local/test bootstrap only, and schema/seed are now separate steps.
- `migrations/helpers.py` + `migrations/__init__.py` — idempotency guards so additive migrations
  are safe on both a fresh baseline DB and a stamped, drifted demo DB (added during live testing).

### VS-13 — DocumentStorage boundary 🔒 (before any doc copy)
- `app/services/document_storage.py` (`write_content` / `read_content`, backend `postgres_bytea`).
- `create_mission_for_document`, the retry copy, and `playbook.run` all read/write bytes through it.
  No direct `MissionDocument.content` access remains outside the boundary.

### VS-9 — Frontend registry + Ledger package
- New `frontend/src/sydekyks/ledger/` (`LedgerMissionSummary` moved, `LedgerSettingsSection`
  extracted, `LedgerReadinessCard`, `LedgerPlaybookPanel`) + `sydekyks/registry.tsx` (plain object,
  slug/playbook keyed).
- `SydekykDetail.tsx` and `DocumentIntakeSection.tsx` now resolve UI via the registry — the
  `slug === "ledger"` and `playbook_key === "ledger.vendor_bill_ingest"` branches are gone.

### VS-2 — Email inbox, productized
- `POST /api/tenant/ledger/email-inbox` — composed create-and-assign in one transaction.
- `EmailInboxBlock` shows/copies the inbound address, offers "Create Email Inbox", and explains the
  test-bill flow (replaces the dead-end synchronous "Test Connection").

### VS-1 — Ledger readiness checklist
- `app/sydekyks/ledger/readiness.py` computes AI-engine / Odoo-assigned / Odoo-connection /
  email-inbox / last-inbound states + `can_upload`, from existing tables. Endpoint
  `GET /api/tenant/ledger/readiness`.
- `LedgerReadinessCard` renders the checklist with deep links; upload is gated on `can_upload`.

### VS-5 — Read-only Playbook panel
- `PLAYBOOK_STEPS` metadata in `playbook.py` (single source of truth), served at
  `GET /api/tenant/ledger/playbook`. A test asserts the metadata keys equal the recorded step keys.
- `LedgerPlaybookPanel` renders steps read-only, labeled "Fixed · not editable".

### VS-3 — Tenant-wide Mission operations page
- `GET /api/tenant/missions` — filters (sydekyk, status, signal_type, source, filename, date range),
  pagination, single LEFT JOIN (no N+1), `MissionPage` envelope.
- `/hq/missions` page with filter bar, pagination, shared `MissionDetailPanel`, nav links added.

### VS-4 — Failed-Mission retry 🔒
- `missions.retry_mission` creates a NEW Mission (`parent_mission_id`, `root_mission_id`,
  `attempt_number+1`) replaying the original `playbook_key`, copying the document via the storage
  boundary. `POST /api/tenant/missions/{id}/retry` (commander-only, 400 on non-failed).
- Retry button on failed-mission detail in both the Sydekyk panel and the ops page.
- Migration `0002_mission_retry` adds the columns.

### VS-7 — Queue-backed execution 🔒 (Redis + arq)
- `app/services/queue.py` `enqueue_mission()` seam → arq over Redis when `queue_enabled`, else
  fire-and-forget threadpool fallback. `run_mission` unchanged as the entry point.
- `backend/worker.py` arq `WorkerSettings`; retry policy driven by `Mission.failure_category`
  (`transient`/`external` retry with backoff; `setup`/`validation` terminal).
- Both `BackgroundTasks` call sites (upload, email) replaced with `await enqueue_mission(...)`.

### VS-8 — Email ingest events + idempotency 🔒 (one inbox → one Sydekyk)
- `email_ingest_events` table + model; webhook writes an event on **every** branch.
- Idempotency on `(provider, message_id)`; single-Sydekyk routing (records `ambiguous_inbox` if >1);
  shared 15MB size cap; Postmark parser now surfaces `MessageID`. Migration `0003_email_events`.

### VS-11 — Webhook hardening
- In-memory sliding-window rate limiter on the Postmark endpoint; `unauthorized` now recorded as an
  event; size cap enforced. (Distributed rate limiting via Redis is the noted next step.)

### VS-12 — Vision readiness test
- `POST /api/tenant/ledger/vision-test` runs the real configured engine against a Pillow-generated
  sample invoice; persists `ledger_vision_ok` / `ledger_vision_tested_at`; feeds readiness (AI engine
  is `warn` until vision verified). UI control in the setup section. Migration `0004_vision_usage`.

### VS-14 — Mission export
- `GET /api/tenant/missions/export` streams filtered CSV; "Export CSV" button on the ops page
  (auth-aware fetch → client download).

### VS-15 — Billing-grade usage events 🔒 (committed)
- `usage_records` table + model; `app/services/usage_events.py` (`record_usage` idempotent on
  `litellm_request_id`, `reconcile_tenant` vs LiteLLM). Extraction now returns usage/request-id meta;
  the playbook emits one attribution row per call. Migration `0004_vision_usage`.

### VS-6 — Demo readiness script
- `scripts/check_demo_readiness.py <tenant-slug>` prints each readiness item and exits non-zero if a
  required item is blocked.

### VS-10 — Test suite
- `tests/`: extraction parse/coerce, duplicates + confidence, Postmark parser, Playbook-metadata
  drift guard (16 tests, all green here). DB-gated `test_mission_flow.py` drives the playbook end to
  end with a fake Odoo + fake extraction (success, setup-failure classification, retry lineage,
  usage emission); `conftest.py` skips these unless `TEST_DATABASE_URL` points at a real Postgres.

---

## Decisions honored (from the AskUserQuestion round)

| Decision | Choice | Where |
|----------|--------|-------|
| Usage billing | **Committed** | VS-15 built (was conditional) |
| Email routing | **One inbox → one Sydekyk** | VS-8 single-match + `(message_id, attachment_hash)` idempotency |
| Queue backend | **Redis + arq** | VS-7 arq worker + Redis config, inline fallback |
| Vision probe | **Allowed** | VS-12 real probe against a bundled sample |

Defaults I applied: `attempt_number` + `root_mission_id` (not `retry_count`); `failure_category`
column; real-Postgres test DB; composed email create-and-assign endpoint.

## Deviations & notes

- **Baseline migration uses a name-filtered `create_all`** rather than hand-transcribed DDL. Because
  that builds tables from the *current* models, the additive migrations are made **idempotent**
  (`migrations/helpers.py` guards) so `upgrade head` works on a fresh DB and `stamp` + `upgrade`
  works on the drifted demo DB — both now proven live. On an existing DB, always `stamp
  0001_baseline` first, then `upgrade head`, then `schema_diff`.
- **FastAPI here is a newer build** whose `app.routes` are lazily wrapped; route registration was
  verified via the generated OpenAPI schema instead.
- **`LedgerReadiness` type** still imported into two shared frontend files (a type, not a branch).
  Left as-is; genericize (`SydekykReadiness`) only at Sydekyk #2.
- **`0004` bundles VS-12 + VS-15** columns/tables in one migration (both land in the same pass).

## Recommended follow-ups (post-merge)

1. ✅ _Done here:_ migrations run + `schema_diff` clean on both fresh and drifted DBs; Redis in
   compose; arq worker proven. Remaining: wire `alembic upgrade head` into the deploy pipeline.
2. ✅ _Done here:_ Redis up, `queue_enabled=true`, worker drains jobs. Remaining: smoke-test
   retry-by-category with a real failing Mission (needs a live engine to hit the transient path).
3. Point CI's `TEST_DATABASE_URL` at a CI Postgres so the 3 DB-gated tests run in CI, not just
   locally (they pass locally now).
4. Exercise the vision probe + usage emission against a real LiteLLM engine + tenant key; verify a
   `reconcile_tenant` delta of ~0.
5. Add a distributed (Redis) rate limiter for the webhook once multi-process.
