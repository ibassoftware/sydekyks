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

## Verification performed (in this environment)

| Check | Result |
|-------|--------|
| `python -m compileall app worker.py migrations scripts` | ✅ clean |
| `import app.main` + OpenAPI schema | ✅ all new routes registered |
| `pytest tests/` | ✅ 16 pure-logic tests pass; 3 DB-gated tests skip (no test Postgres here) |
| `tsc -b` (frontend typecheck) | ✅ 0 errors |
| `vite build` | ✅ 97 modules, built clean |
| VS-9 DoD grep (no `slug === "ledger"` / `"ledger.vendor_bill_ingest"` branches in shared files) | ✅ branches removed (only a shared `LedgerReadiness` *type* import remains) |

## Requires a live environment to confirm (not runnable here)

These are correct-by-construction but need real infra to exercise end-to-end:

1. **Alembic migrations against Postgres.** Run `alembic upgrade head` on a fresh DB, and
   `alembic stamp 0001_baseline && alembic upgrade head` on the existing demo DB. Then
   `python -m scripts.schema_diff` should print "Schema in sync."
2. **arq worker + Redis** (VS-7). With `queue_enabled=true` and Redis up, run
   `arq worker.WorkerSettings`; upload a bill and confirm the Mission runs in the worker and that
   `transient`/`external` failures retry while `setup`/`validation` do not. Without Redis the
   inline fallback runs Missions in-process (demo-safe).
3. **Vision probe** (VS-12) and **usage emission** (VS-15) need a real LiteLLM engine + key.
4. **Postmark webhook** (VS-8/VS-11) idempotency/rate-limit/size paths need real inbound posts
   (covered structurally by the parser unit test + the event-writing branches).

## How to run

```
# backend
pip install -r backend/requirements.txt
cd backend && alembic upgrade head          # schema (was: create_all)
python -m app.seed                          # data only now; SCHEMA_AUTO_CREATE=1 to also create tables
arq worker.WorkerSettings                   # only if queue_enabled=true (needs Redis)
python -m scripts.check_demo_readiness acme # VS-6 demo gate

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

- **Baseline migration uses a name-filtered `create_all`** rather than hand-transcribed DDL — stable
  and stable against later additive migrations, but on a drifted existing DB you must `stamp`, then
  verify with `schema_diff`. This is called out in the migration docstring.
- **FastAPI here is a newer build** whose `app.routes` are lazily wrapped; route registration was
  verified via the generated OpenAPI schema instead.
- **`LedgerReadiness` type** still imported into two shared frontend files (a type, not a branch).
  Left as-is; genericize (`SydekykReadiness`) only at Sydekyk #2.
- **`0004` bundles VS-12 + VS-15** columns/tables in one migration (both land in the same pass).

## Recommended follow-ups (post-merge, need live infra)

1. Run migrations on demo/staging; confirm `schema_diff` clean; wire `alembic upgrade head` into
   deploy.
2. Stand up Redis, set `queue_enabled=true`, run the arq worker; smoke-test retry-by-category.
3. Point `TEST_DATABASE_URL` at CI Postgres so the DB-gated tests run in CI, not just locally.
4. Exercise the vision probe + usage emission against a real LiteLLM engine; verify a
   `reconcile_tenant` delta of ~0.
5. Add a distributed (Redis) rate limiter for the webhook once multi-process.
