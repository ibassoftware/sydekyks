# Ledger — Vertical Slices for Development

Date: 2026-07-05
Source: `docs/LEDGER_DEMO_READINESS_REVIEW.md`, grounded against the current codebase.

This document turns the readiness review into **vertical slices**: each slice is a thin,
independently shippable change that cuts through every layer it needs (DB → service → API →
frontend → test) and leaves `main` demo-able. It is written to be handed to a developer with
no further discovery: every slice names the real files, endpoints, models, and call sites it
touches.

Where the review and the code disagree — or where a recommendation carries a hidden cost — this
document **challenges it explicitly** (look for ⚠️ **Challenge** blocks) and states a
recommendation. Items the review flags as *painful to migrate later* are marked 🔒 and are
called out again in [§4](#4-painful-to-migrate-later--do-not-defer-past-first-customers).

---

## 1. How to read a slice

Every slice has the same shape:

- **Story** — one user-facing sentence.
- **Why now** — demo value vs. migration risk, in the review's own terms.
- **Scope** — explicit *in* and *out* so the slice stays thin.
- **Backend** — models/migrations, endpoints (verb + path + shapes), services, exact files.
- **Frontend** — components, routes, `api.ts` additions, exact files.
- **Acceptance** — Given/When/Then, demoable.
- **Tests** — the minimum that must be green.
- **Challenges** — where this slice pushes back on the review, or a decision is needed.
- **Size** — S (≤0.5d) / M (1d) / L (2–3d), and dependencies.

**Definition of Done (applies to every slice):** code + tests green + the acceptance demo runs
against a locally seeded tenant + no new direct `document.content` reads outside the storage
boundary (see [VS-13](#vs-13--documentstorage-boundary-)) once that lands + `api.ts` types updated
+ no unhandled Mission left in a non-terminal state.

---

## 1a. Decisions locked (2026-07-05)

| Decision | Choice | Affects |
|----------|--------|---------|
| Power Core usage billing | **Committed** — build billing-grade usage events | VS-15 becomes in-scope (no longer conditional) |
| Email inbox → Sydekyk mapping | **One inbox → one Sydekyk** | VS-8 idempotency key = `(message_id, attachment_hash)`; webhook fan-out constrained |
| Queue backend | **Redis + arq** | VS-7 uses arq; Redis added to the stack; `mission_jobs` table dropped in favour of arq's own job store |
| Vision readiness probe | **Allowed** — a real billable call against a bundled sample invoice | VS-12 proceeds as specified |
| Retry fields (my default) | `attempt_number` + `root_mission_id` | VS-4 |
| Failure classification (my default) | dedicated `Mission.failure_category` column | VS-7 |
| Test DB (my default) | real ephemeral Postgres | VS-10 |
| Email inbox creation (my default) | one composed create-and-assign endpoint | VS-2 |

## 2. Slice inventory

| ID | Slice | Sprint | Size | 🔒 Migration pain | Depends on |
|----|-------|--------|------|:---:|-----------|
| VS-0 | Alembic baseline (pulled forward — see challenge) | A/B | M | 🔒 | — |
| VS-1 | Ledger readiness checklist | A | M | | VS-2 (soft) |
| VS-2 | Email inbox, productized in Ledger setup | A | M | | — |
| VS-3 | Tenant-wide Mission operations page | A | L | | — |
| VS-4 | Failed-Mission retry | A | M | 🔒 | VS-0, VS-13 |
| VS-5 | Read-only Ledger Playbook panel | A | S | | VS-10 (soft) |
| VS-6 | Demo seed / readiness check script | A | S | | VS-1 |
| VS-7 | Queue-backed Mission execution | B | L | 🔒 | VS-0 |
| VS-8 | Email ingest events + idempotency + size cap | B | M | 🔒 | VS-0 |
| VS-9 | Frontend Sydekyk modular refactor + registry | B | M | | — |
| VS-10 | Backend test suite (Ledger + Mission) | B | M | | — |
| VS-11 | Email webhook hardening (rate limit, replay) | C | M | 🔒 | VS-8 |
| VS-12 | Ledger AI-engine readiness (vision) test | C | M | | VS-1 |
| VS-13 | DocumentStorage boundary | B | M | 🔒 | VS-0 |
| VS-14 | Customer-facing Mission filters/export | C | M | | VS-3 |
| VS-15 | Billing-grade usage events (committed) | C | L | 🔒 | VS-0 |

> Renumbering note vs. the review's Sprint A/B/C: **Alembic (VS-0) and DocumentStorage (VS-13)
> are pulled earlier than the review placed them.** Rationale in the challenges below.

---

## 3. The slices

---

### VS-0 — Alembic baseline 🔒

> The review lists this as a mid-Sprint-B (P1) item. **Challenge: it is a prerequisite, not a
> mid-sprint task**, and belongs first.

**Story:** As a developer I can evolve the schema with reviewed, replayable migrations instead of
`Base.metadata.create_all` + hand-written `ALTER`s.

**Why now:** Three Sprint-A/B slices add columns — `missions.parent_mission_id` / `retry_count`
(VS-4), the `email_ingest_events` table (VS-8), and `mission_jobs` if chosen (VS-7). Under the
current `create_all` regime, **`create_all` does not alter existing tables**, so every one of
those becomes a hand ALTER on the demo DB and drifts prod/staging/local apart. Landing Alembic
first means each later slice ships its own migration. Migration debt is the review's own #2
painful-to-migrate item.

⚠️ **Challenge — sequencing tension the review left implicit:** VS-4 (Sprint A) needs a new
column but Alembic is Sprint B in the review. That is contradictory. Resolve one of two ways:

1. **Recommended:** pull Alembic to the very start (this VS-0), before any additive slice.
2. If the demo clock forbids it: allow VS-4 to ship one documented manual `ALTER TABLE missions
   ADD COLUMN …`, and require VS-0's baseline to `--autogenerate` *after* that ALTER so the
   baseline captures reality. Track the manual ALTER in this doc so it is not lost.

**Scope**
- *In:* add `alembic` to `backend/requirements.txt`; add `alembic.ini` + `migrations/`; configure
  `env.py` to import `app.db.session.Base.metadata` and every model module (so `target_metadata`
  is complete); generate a **baseline** migration from current models; `alembic stamp head` on the
  existing demo DB after verifying no drift; stop calling `create_all` for evolving schemas (keep
  it only, if at all, for local bootstrap/test fixtures). Make `alembic upgrade head` the schema
  step and seed data a **separate** subsequent step in the developer workflow.
- *Out:* data migrations, multi-head branching, CI migration gating (add later).

**Backend**
- Add `alembic` to `backend/requirements.txt` (verified absent today).
- New: `backend/alembic.ini`, `backend/migrations/env.py`, `backend/migrations/versions/0001_baseline.py`.
- `env.py` must import all model modules. Today models are spread across
  `backend/app/models/*.py` and `backend/app/sydekyks/ledger/models.py` — the discovery loop in
  `app/sydekyks/__init__.py` already imports Sydekyk packages; call `discover_sydekyk_packages()`
  in `env.py` so per-Sydekyk tables (e.g. `ledger_tenant_settings`) are in `target_metadata`.
- **Two** `create_all` call sites exist and both must be gated: `backend/app/seed.py:96`
  (`Base.metadata.create_all(bind=engine)`) and `backend/app/sydekyks/__init__.py:8`. Separate
  schema creation (`alembic upgrade head`) from seed-data insertion — today `seed.py` does both.

⚠️ **Challenge — autogenerate against a drifted DB lies.** The DB has been evolved with manual
ALTERs, so `--autogenerate` may emit spurious drops/creates. Generate the baseline from
**models only** against an empty DB, then `stamp head` the live demo DB. Verify no drift with a
**scripted schema comparison** (a small `scripts/schema_diff.py` that reflects the live DB and
compares to `Base.metadata`, or `alembic check`) — not a manual eyeball — and commit it as the
repeatable pre-migration checklist for slice #2 onward.

**Tests:** `alembic upgrade head` from empty → schema matches `Base.metadata` (assert via the
`schema_diff` script, exit 0); `alembic downgrade base` runs clean.

**Size:** M. **Depends on:** —.

---

### VS-1 — Ledger readiness checklist (P0)

**Story:** As a Commander opening Ledger, I see a checklist that tells me exactly what is left to
configure before a bill can be processed, with a one-click link to each fix.

**Why now:** Highest demo value, lowest migration risk (review §P0). Today the seven setup steps
are tribal knowledge; a missing step only surfaces as a *failed Mission after upload*
(`playbook.py` fails at `extract_bill_data` / `connect_odoo`).

**Scope**
- *In:* a single read-only readiness endpoint + a checklist card at the top of Ledger's detail.
  Each item: `ok | warn | blocked`, a human label, and a deep-link action.
- *Out:* actually testing the AI engine end-to-end with a real invoice (that's VS-12); fixing the
  items inline beyond linking to the existing controls.

**Backend**
- New endpoint: `GET /api/tenant/sydekyks/{sydekyk_id}/readiness` → `LedgerReadiness`.
- Compute from existing tables — no new columns:
  - `ai_engine`: `TenantSydekykLLMConfig` exists for (tenant, sydekyk) with a virtual key +
    model alias, and `status`. (mirror the checks in `playbook.py:79–91`).
  - `odoo_assigned`: a `TenantSydekykGadgetAssignment` for the `erp` requirement exists
    (mirror `_get_odoo_link` in `playbook.py:42–65`).
  - `odoo_connection`: the assigned Odoo link's `status == "connected"` (`TenantGadgetLink.status`).
  - `email_inbox` (optional): assignment for the `inbox` requirement + inbound address present.
  - `last_inbound_email`: timestamp of most recent `email`-source Mission (or, after VS-8, most
    recent `email_ingest_events` row).
- Put the readiness computation in Ledger's package
  (`backend/app/sydekyks/ledger/readiness.py`) not in a shared router — it is Ledger-specific
  business logic. Expose it through a thin route in `backend/app/sydekyks/ledger/router.py`
  (which already exists and is auto-registered).

⚠️ **Challenge — keep readiness generic or Ledger-owned?** The review says "add a Ledger
readiness checklist." Do **not** build a generic per-Sydekyk readiness framework yet — there is
exactly one workflow Sydekyk. Ship it Ledger-owned in `ledger/readiness.py`; generalize only when
a second Sydekyk needs it (YAGNI). The frontend registry (VS-9) is where genericization will
naturally happen later.

**Frontend**
- New `api.ts` type `LedgerReadiness { items: { key, label, state, action_label, action_href }[] }`.
- New component `frontend/src/sydekyks/ledger/LedgerReadinessCard.tsx` (create the folder now;
  VS-9 fills it out). Render above `LedgerSettingsSection` in
  `SydekykDetail.tsx:139–143`.
- Actions deep-link to existing UI: "Test AI Engine" → the AI Engine card's test
  (`SydekykDetail.tsx:206`), "Assign Odoo" → `GadgetRequirementList`, "Connect Odoo" →
  `/hq/gadgets`, "Create Email Inbox" → VS-2's control.
- Disable the upload dropzone in `DocumentIntakeSection.tsx:81` (or show a blocking banner) when
  `ai_engine` or `odoo_assigned`/`odoo_connection` are `blocked`; keep email items as `warn`
  (optional), never `blocked`.

**Acceptance**
- Given a tenant with no AI engine, When I open Ledger, Then the checklist shows AI Engine
  *blocked* and upload is disabled with "Configure AI Engine first."
- Given Odoo assigned + connected + AI engine set, Then all required items are `ok` and upload is
  enabled.

**Tests:** unit-test `readiness.py` against fixtures for each state; router test for tenant
isolation (another tenant's config never leaks).

**Size:** M. **Depends on:** VS-2 (soft — the "Create Email Inbox" action links to it).

---

### VS-2 — Email inbox, productized in Ledger setup (P0)

**Story:** As a Commander I can, from Ledger's own page, create an inbound email address, see it
in plain text, copy it, read how to send a test bill, and see when the last email arrived — without
visiting the generic Gadgets page.

**Why now:** Review §P0 — email is a key demo differentiator that is currently hidden behind
generic integration language. The plumbing already exists: `create_gadget_link` generates the
inbound address for `category == "email"` (`gadgets.py:67–76`) and the webhook routes on
`inbound_local_part` (`email_webhook.py:58–63`). This slice is UX surfacing, not new plumbing.

**Scope**
- *In:* in Ledger setup — (a) if an `inbox`-role assignment exists, show its inbound address +
  copy button + last-received timestamp; (b) if no eligible email link exists, a "Create Email
  Inbox" button that creates the link *and* assigns it to Ledger's `inbox` requirement in one go;
  (c) "Send a test bill to this address" helper copy.
- *Out:* per-link webhook secret routing; ingest-event diagnostics table (VS-8); rate limiting
  (VS-11).

**Backend**
- Reuse `POST /api/tenant/gadget-links` (`gadgets.py:59`) for creation. Add a small convenience:
  after creation, assign to Ledger's `inbox` requirement — either a new
  `POST /api/tenant/sydekyks/{id}/gadget-links/email` that composes create+assign, or let the
  frontend call create then the existing assignment endpoint (`gadget_assignments.py`). Prefer the
  composed endpoint so the two writes are one transaction (avoids a half-configured state on
  failure).
- `last_inbound_email`: reuse the readiness computation (VS-1) or add to the `GadgetLinkOut`
  shape. Cheapest: the readiness endpoint already surfaces it.

⚠️ **Challenge — "Rename the Test Connection behavior."** The review calls the current email
"Test Connection" response poor UX (`gadgets.py:131–136` returns *"can't be tested
synchronously"*). Do **not** try to make it synchronously testable (we cannot round-trip an email
in a click). Instead **replace the button semantics for email links**: label it "Send a test
bill" and have it reveal the address + instructions + a live "waiting for first email…" state that
flips to "Received ✓ at <time>" by polling `last_inbound_email`. This turns a dead-end into a
guided test without pretending email is synchronous.

**Frontend**
- Extend `LedgerSettingsSection` (moving to `frontend/src/sydekyks/ledger/` in VS-9) to render the
  inbox block. New `api.ts` calls for the composed create-and-assign endpoint.
- Copy-to-clipboard for the address; poll `last_inbound_email` every few seconds while the "test"
  panel is open (reuse the polling idiom from `DocumentIntakeSection.tsx:38–44`).

**Acceptance**
- Given no email link, When I click "Create Email Inbox," Then an address appears, is assigned to
  Ledger, and the readiness item flips to `ok`.
- Given I email a bill to that address, Then within one poll the panel shows "Received ✓" and a
  Mission with `signal_type=email` appears in history.

**Tests:** endpoint test for composed create+assign atomicity; webhook test that a mission is
created for the generated `inbound_local_part` (extends VS-10).

**Size:** M. **Depends on:** —.

---

### VS-3 — Tenant-wide Mission operations page (P0)

**Story:** As a Commander I open `/hq/missions` and see every Mission across all Sydekyks and
sources, filter it, and drill into any run's step trail — so I can answer "what happened to this
bill?"

**Why now:** Review §P0 — run history is core trust infrastructure and cuts demo support burden.
Today history is per-Sydekyk only (`missions.py:20 list_missions`) and surfaced inside the upload
panel (`DocumentIntakeSection.tsx:93`).

**Scope**
- *In:* a new cross-Sydekyk list endpoint with filters + pagination; a new route `/hq/missions`
  with a filterable table; a detail drawer/route reusing the existing step-trail UI
  (`MissionDetailPanel` in `DocumentIntakeSection.tsx:132`).
- *Out:* retry action (VS-4 adds the button here); CSV/export and saved filters (VS-14).

**Backend**
- New endpoint: `GET /api/tenant/missions` → `list[MissionOut]` (+ a total count header or a
  `MissionPage` envelope). Filters as query params: `sydekyk_id`, `status`, `signal_type`,
  `source` (`web_upload|email` — comes from `MissionDocument.source`), `filename` (ILIKE on
  `MissionDocument.filename`), `date_from`, `date_to`, `limit`, `offset`.
- Add to `backend/app/routers/missions.py`. Reuse `_filename` helper; join `MissionDocument` for
  `source`/`filename` filters. Always constrain `Mission.tenant_id == user.tenant_id`.
- Extend `MissionOut` (`backend/app/schemas/mission.py`) with `source` and `sydekyk_name` (join
  `Sydekyk`) and `created_at`/`completed_at` (already present).

⚠️ **Challenge — N+1 in the current list path.** `list_missions` calls `_filename` once per
Mission (`missions.py:40`), i.e. one query per row. For a per-Sydekyk list of ≤20 that is
tolerable; for a tenant-wide operations page it is not. **Build VS-3's endpoint with a single
`LEFT JOIN mission_documents`** (and `JOIN sydekyks`) rather than copying the per-row helper.
Consider back-porting the join to `list_missions` while you are there.

**Frontend**
- New route in `App.tsx` (`/hq/missions`, roles `commander|hero`) → new page
  `frontend/src/pages/Missions.tsx`.
- Filter bar (Sydekyk select, status, source, date range, filename search). Table columns:
  filename, Sydekyk, source, status badge (reuse `StatusBadge`), created, completed.
- Row → detail drawer or `/hq/missions/:id` reusing `MissionDetailPanel`. Add a nav link from
  `TenantDashboard`.
- `api.ts`: `listMissions(filters)` and the widened `Mission`/`MissionOut` type.

**Acceptance**
- Given missions from upload and email across two Sydekyks, When I filter by `source=email` +
  `status=failed`, Then only matching rows show, paginated.
- When I open a row, Then I see the same step trail as the Sydekyk panel.

**Acceptance — navigation / IA** (hidden capabilities undermine demos, so make discoverability
explicit):
- The HQ dashboard (`TenantDashboard`) links clearly to Missions (`/hq/missions`), Gadgets, Roster,
  and Settings.
- Ledger links out to the full Gadgets page only for deeper integration management (not as the
  primary path for the common case).
- Mission detail is reachable from **both** Ledger's panel and `/hq/missions`, using the **same**
  shared UI (`MissionDetailPanel`).
- The Retry action (VS-4) appears **consistently** wherever failed-Mission detail is shown — the
  Sydekyk panel and `/hq/missions` must not diverge.

**Tests:** router tests for each filter + tenant isolation + pagination bounds; the join returns
`source` correctly for both upload and email missions.

**Size:** L. **Depends on:** —.

---

### VS-4 — Failed-Mission retry (P0) 🔒

**Story:** As a Commander, after fixing setup (e.g. assigning Odoo), I click "Retry" on a failed
Mission and it runs again — without me re-uploading and creating a duplicate.

**Why now:** Review §P0 — retry is small vs. a full queue and gives immediate operational control.
Marked 🔒 because the *retry data model* (linked runs, retry counts) is part of the operations
model the review flags as painful to migrate later.

**Scope**
- *In:* `POST /api/tenant/missions/{id}/retry` for `status == failed` only; a Retry button on
  failed-Mission detail (in VS-3's page and the Sydekyk panel).
- *Out:* automatic retry policy by failure class (that lands with the queue, VS-7).

⚠️ **Challenge — "new Mission vs. requeue in place": the review is ambivalent; the schema forces
the answer.** `mission_steps` has `UniqueConstraint(mission_id, step_index)`
(`mission.py:47`). Re-running the same Mission in place would collide on step indices unless you
first delete the old steps — which **destroys the audit trail** the whole operations story
depends on. Therefore:

- **Recommendation: create a NEW Mission with `parent_mission_id` set to the original** (the
  review's "prefer for auditability" option), *not* in-place requeue.
- Cost the review omits: `MissionDocument` is one-to-one with a Mission
  (`mission.py:74 unique=True`) and stores bytes in `bytea`. A new Mission needs its **own**
  `MissionDocument`, so the retry must **copy the document bytes**. For demo-scale bills this is
  fine; note it as a reason to want VS-13's storage boundary (copy a `storage_key`, not bytes,
  once S3 lands).

**Backend**
- Migration (ships with this slice, on top of VS-0): add to `missions`:
  - `parent_mission_id UUID NULL REFERENCES missions(id) ON DELETE SET NULL` — the immediate
    predecessor.
  - `attempt_number INT NOT NULL DEFAULT 1` — this row's position in the chain (avoids the
    ambiguity of a `retry_count` sitting on a *child* row).
  - (optional but recommended) `root_mission_id UUID NULL` — the original Mission, so a whole retry
    chain groups with one query instead of walking `parent_mission_id` links.
  - **Do not** add `retry_count`; it is ambiguous on a per-row basis (own retries vs. chain total).
- New service `retry_mission(db, original)` in `app/services/missions.py`: assert
  `status == failed`; create a new Mission **replaying the original contract** — copy
  `sydekyk_id`, **the original `playbook_key`** (a retry re-runs the same Playbook, not "latest"),
  `signal_type`, `user_id`; set `parent_mission_id = original.id`,
  `root_mission_id = original.root_mission_id or original.id`,
  `attempt_number = original.attempt_number + 1`; copy the document **via the DocumentStorage
  boundary (VS-13)** rather than reading `MissionDocument.content` directly (reuse
  `create_mission_for_document`); schedule execution the same way uploads do
  (`background_tasks.add_task(run_mission, …)` — after VS-7, `enqueue(...)`).
- Endpoint in `missions.py`. Return the new `MissionOut`.

> **Sequencing:** VS-13 must land **before** this slice so retry's document copy goes through the
> storage boundary and does not introduce a fresh direct `.content` access.

**Frontend**
- "Retry" button on failed-Mission detail in `MissionDetailPanel` and VS-3's page. On success,
  refresh the list; surface the parent→child link ("Retry of <filename>").

**Acceptance**
- Given a Mission failed on "No Odoo instance assigned," When I assign Odoo and click Retry, Then a
  new Mission is created with `parent_mission_id` set and it succeeds; the original stays `failed`
  for the record.
- Retry is rejected (400) on a non-failed Mission.

**Tests:** service test for the copy + linkage; endpoint rejects non-failed; tenant isolation.

**Size:** M. **Depends on:** VS-0, **VS-13** (storage boundary must precede the document copy).

---

### VS-5 — Read-only Ledger Playbook panel (P1, ship in Sprint A)

**Story:** As a Commander I can see the fixed steps Ledger runs and what each does / can fail on —
so the demo can say "you can inspect the Playbook" truthfully.

**Why now:** Review §P1 — read-only visibility helps demos without committing to a workflow
builder. It also anchors the product-positioning language ("Ledger has a *fixed* Playbook").

**Scope**
- *In:* a static, read-only panel listing the 7 steps with descriptions + likely failure causes.
- *Out:* persisted `playbooks` table, editing, DAG/branching, scheduling. **Do not build these**
  (review "Defer" list). Positioning must not imply editable Playbooks.

⚠️ **Challenge — where does the step list live so it can't drift from the code?** The steps are
defined only in `playbook.py` (`extract_bill_data`, `connect_odoo`, `lookup_vendor`,
`duplicate_check`, `infer_account`, `create_bill`, `post_bill`). If the panel hardcodes them in
React, the doc and code drift. **Recommendation:** export a `PLAYBOOK_STEPS` metadata list
(key, title, description, likely_failures) from `backend/app/sydekyks/ledger/playbook.py` (next to
`PLAYBOOK_KEY`) and serve it via `GET /api/tenant/sydekyks/{id}/playbook` so there is one source of
truth. Low cost, prevents drift.

**Frontend**
- `frontend/src/sydekyks/ledger/LedgerPlaybookPanel.tsx` (folder from VS-9). Static render of the
  fetched steps with a "Fixed Playbook — not editable yet" label.

**Acceptance:** panel lists all 7 steps with descriptions; labeled read-only; step keys match the
`record_step` keys emitted at runtime.

**Tests:** a test asserting the served step keys equal the keys `playbook.py` actually records
(guards drift).

**Size:** S. **Depends on:** VS-9 (soft — can ship in `components/` first, move later).

---

### VS-6 — Demo seed / readiness check script (Sprint A)

**Story:** As a presenter I run one command that verifies (and optionally seeds) a demo tenant:
Ledger installed, AI engine configured, Odoo link connected + assigned, Email inbox assigned.

**Why now:** Review Sprint A #6 — de-risks live demos. Reuses VS-1's readiness logic on the CLI.

**Scope**
- *In:* a script `backend/scripts/check_demo_readiness.py` that, given a tenant slug, prints each
  readiness item green/red and exits non-zero if any required item is blocked. Optional `--seed`
  to create a demo tenant + attach fixtures.
- *Out:* a full fixtures framework.

**Backend:** import `ledger/readiness.py` (VS-1) and run it against the tenant; reuse existing seed
helpers in `app/seed.py`.

**Acceptance:** on a fully configured tenant the script exits 0 and prints all-green; removing the
Odoo assignment makes it exit non-zero naming the missing item.

**Size:** S. **Depends on:** VS-1.

---

### VS-7 — Queue-backed Mission execution (P1) 🔒

**Story:** As the platform, Mission execution survives a backend restart, retries transient
failures with backoff, and is observable — instead of dying with the web process.

**Why now:** Review §P1 + painful-to-migrate #1. The listed risks are real: jobs die on restart,
no backoff, no concurrency control, no stuck-job visibility (`documents.py:93`,
`email_webhook.py:103` both use `BackgroundTasks`).

⚠️ **Challenge — the migration is smaller than the review implies.** The review says "the current
request process owns too much execution responsibility." Inspecting `run_mission`
(`services/missions.py:157`), it **already** opens its own `SessionLocal()`, runs discovery, and
guarantees a terminal status on any exception. It is already a clean worker entry point. The real
coupling is only the *scheduling call* at two sites. So the lift is: (1) stand up a worker, (2)
replace two `background_tasks.add_task(run_mission, id)` calls with `enqueue(run_mission, id)`,
(3) add retry policy. Frame the estimate accordingly — this is L mostly because of infra + retry
classification, not because of tangled code.

**Decision locked: Redis + arq.** A new Redis service joins the stack (demo/staging/prod);
arq provides backoff/retry/observability out of the box, and gives a foundation for scheduled
Signals later. Still wrap it behind an `enqueue()` seam and **keep `run_mission(mission_id)` as the
worker entry point** so the backend stays swappable and the two call sites never learn which queue
is used. No `mission_jobs` table — arq owns its job store in Redis; Mission status remains the
business-facing state.

**Scope**
- *In:* an `enqueue()` abstraction over arq; an arq worker process (`backend/worker.py`) with the
  `run_mission` task; retry policy by failure class:
  - LLM/network timeout → retry with backoff.
  - Odoo transient (network/auth) → retry or mark actionable.
  - Validation/setup errors (no AI engine, no Odoo assigned, no expense account) → **do not
    retry**, mark "needs setup."
- *Out:* scheduler / recurring Signals (deferred by the review) — but note arq supports cron jobs,
  so this is the natural home when Signals land; horizontal autoscaling.

**Backend**
- Add `arq` + a Redis client to `backend/requirements.txt`; add Redis connection config to
  `app/core/config.py` and the deployment/compose setup.
- New `app/services/queue.py` with `enqueue(func, *args)` submitting to arq; `backend/worker.py`
  defining the arq `WorkerSettings` with `run_mission` registered as a task and the retry policy.
- Replace the two `background_tasks.add_task(run_mission, id)` calls (`documents.py:93`,
  `email_webhook.py:103`) — and VS-4's retry scheduling — with `enqueue(run_mission, id)`.
- Map `failure_category` (below) to arq retry behaviour: `transient`/`external` → let arq retry
  with backoff; `setup`/`validation` → raise a non-retryable terminal outcome so arq does not
  re-run it.
- **Failure classification is a prerequisite for auto-retry — build it as structured data, not
  string matching.** Today Ledger failures are recorded by setting `mission.status`/`error_message`
  inside the playbook (`_finish(..., "failed", ...)`), not by raising typed exceptions, so the
  worker has nothing reliable to branch on. **Decision locked:** add a
  `Mission.failure_category` column (migration via VS-0) with values
  `setup | transient | validation | external | unknown`. (A `result_summary` convention was the
  lean alternative; the column is chosen for queryability and because Alembic makes the migration
  cheap.)
  Populate it at the existing failure sites — "No AI engine configured" / "No Odoo instance
  assigned" / "No expense account" → `setup`/`validation`; `odoo.OdooError` (`playbook.py:223`) →
  `external`/`transient`. The worker's retry policy reads this field, never the error string.
- **Staging is acceptable:** queue v1 may ship as "move execution out of process" only; turn on
  *automatic* retry once `failure_category` is populated. Don't let retry policy regress into
  matching on `error_message` substrings.
- Idempotency: a Mission already tracks `status`; guard `run_mission` so it only acts on a
  `queued` Mission and transitions to `running` before work (it already opens its own session,
  `services/missions.py:157`). arq's `job_id` (set it to the mission id) prevents duplicate
  concurrent enqueues of the same Mission.

**Acceptance**
- Given a queued Mission, When the web process restarts before it runs, Then the worker still
  executes it after restart.
- Given an Odoo timeout, Then the Mission retries with backoff; given "No AI engine configured,"
  Then it fails immediately without retry and reads "needs setup."

**Tests:** worker picks and completes a job; a validation failure is not retried; a transient
failure is retried N times then marked failed.

**Size:** L. **Depends on:** VS-0.

---

### VS-8 — Email ingest events + idempotency + size cap (P1) 🔒

**Story:** As an operator I can see every inbound email the system received — accepted or ignored
and *why* — and a duplicate delivery never creates duplicate Missions.

**Why now:** Review §P1 + painful-to-migrate #5. Today the webhook silently returns
`no_op`/`no_match`/`no_sydekyk` (`email_webhook.py:53,65,84`) with **no record**, so a misrouted
demo email is undiagnosable. There is also **no idempotency** — Postmark re-delivery would create
duplicate bills.

**Scope**
- *In:* an `email_ingest_events` table capturing every inbound; idempotency on provider message ID
  + attachment hash; per-email attachment size cap matching upload's 15MB.
- *Out:* rate limiting + replay-signature auth (VS-11); per-link webhook secrets.

**Backend**
- Migration (VS-0): `email_ingest_events` — `id`, `tenant_id NULL`, `provider`, `message_id`,
  `to_address`, `from_address`, `attachment_count`, `matched_link_id NULL`, `matched_sydekyk_id
  NULL`, `outcome`
  (`accepted|no_match|no_sydekyk|ambiguous_inbox|no_op|duplicate|rejected_size|unauthorized`),
  `reason`, `created_at`. Unique index on `(provider, message_id)` for idempotency.
- Rework `postmark_inbound` (`email_webhook.py:36`): write an event row on **every** branch
  (currently they `return {"status": ...}` silently). On a repeat `message_id`, short-circuit to
  `duplicate` without creating Missions. Enforce `len(att.content_bytes) <= _MAX_BYTES`
  (import the 15MB constant so upload and email share one limit — today only `documents.py:19`
  defines it).
- `parse_postmark_payload` (`services/email_ingest/providers/postmark.py`) must surface the
  provider `MessageID`; extend the parsed model if absent.

⚠️ **Fan-out — decision locked: one inbox → one Sydekyk.** The webhook currently loops
`for sydekyk in rows: for att in email.attachments` (`email_webhook.py:87–104`), which would create
a bill in every Sydekyk assigned to the inbox. Per the locked decision, **an inbox maps to exactly
one Sydekyk**: enforce it by (a) taking the first/only matched Sydekyk (and recording
`outcome=ambiguous_inbox` + a warning if more than one is somehow assigned, rather than
fanning out), and (b) keying idempotency on **`(message_id, attachment_hash)`** — no
`sydekyk_id` needed. This removes the duplicate-bill risk entirely for the demo and pilots.

**Acceptance**
- Given the same Postmark payload delivered twice, Then exactly one Mission set is created and the
  second delivery records `outcome=duplicate`.
- Given an email to an unknown local-part, Then an event row with `outcome=no_match` exists and is
  visible to operators.
- Given a 20MB attachment, Then it is rejected with `outcome=rejected_size` and recorded.

**Tests:** parser extracts `MessageID`; duplicate delivery deduped; oversize rejected; each
no-match/no-sydekyk branch writes an event.

**Size:** M. **Depends on:** VS-0.

---

### VS-9 — Frontend Sydekyk modular refactor + registry (P1)

**Story:** As a developer I can add a second workflow Sydekyk's custom UI without editing shared
files, mirroring the backend's per-Sydekyk package structure.

**Why now:** Review §P1 — backend modularity is already good (`app/sydekyks/ledger/…`); the
frontend still mixes generic + Ledger code in shared files (`SydekykDetail.tsx` holds
`LedgerSettingsSection`; `DocumentIntakeSection.tsx:136` hardcodes the `ledger.vendor_bill_ingest`
branch). This is not a demo blocker but gets messy at Sydekyk #2.

**Scope**
- *In:* create `frontend/src/sydekyks/ledger/`; move `LedgerMissionSummary`
  (from `components/LedgerMissionSummary.tsx`), extract `LedgerSettingsSection` out of
  `SydekykDetail.tsx:400–463`, house `LedgerReadinessCard` (VS-1) and `LedgerPlaybookPanel`
  (VS-5) there; add `frontend/src/sydekyks/registry.tsx` mapping `slug`/`playbook_key` → optional
  `{ setupSection, missionSummary, playbookPanel, readinessCard }`.
- *Out:* dynamic/code-split loading; a plugin manifest format.

**Refactor targets**
- `SydekykDetail.tsx:139–143` (the `slug === "ledger"` conditional) → look up
  `registry[sydekyk.slug]?.setupSection`.
- `DocumentIntakeSection.tsx:135–140` (the `playbook_key === "ledger.vendor_bill_ingest"`
  branch) → `registry[...]?.missionSummary ?? GenericSummary`.
- Keep genuinely generic pieces in `components/`: `FileDropZone`, `StatusBadge`, mission-list
  primitives, `GadgetRequirementList`, `ui.tsx`.

⚠️ **Challenge — don't over-abstract the registry.** With one Sydekyk, a registry risks being
speculative generality. Keep it a **plain object literal keyed by slug**, typed with optional
fields, no dynamic import, no DI container. It exists to delete two `if (ledger)` branches and give
VS-1/VS-5 a home — nothing more. Revisit shape at Sydekyk #2.

**Acceptance:** `SydekykDetail.tsx` and `DocumentIntakeSection.tsx` contain **zero** literal
`"ledger"` / `"ledger.vendor_bill_ingest"` strings; Ledger UI renders identically to before.

**Tests:** existing UI still renders (component smoke test); a fake registry entry proves a second
Sydekyk could inject its own summary without touching shared files.

**Size:** M. **Depends on:** —.

---

### VS-10 — Backend test suite (Ledger + Mission) (P1)

**Story:** As a developer I have a fast test suite covering the money-facing paths so refactors
(queue, storage, Alembic) are safe.

**Why now:** Review §P1 — no tracked tests exist; Ledger touches money. This should ideally land
*early* so VS-7/VS-8/VS-13 refactors are covered, but it is listed Sprint B to not block the demo.

**Scope (the review's list, made concrete against the code):**
- `extraction` JSON parse/coerce (`sydekyks/ledger/extraction.py`) — malformed LLM JSON, missing
  fields, currency/number coercion.
- `duplicates.check_duplicate` + `confidence.compute_confidence` (`duplicates.py`,
  `confidence.py`) — exact vs. near matches, threshold boundaries around
  `settings.auto_post_threshold`.
- Mission creation + step recording (`services/missions.py`: `create_mission_for_document`,
  `record_step`) — terminal-status guarantee even when the runner raises
  (`run_mission` exception guard, `missions.py:180–190`).
- Router tests: upload validation + tenant isolation (`documents.py` type/size/404/install
  checks); mission list/detail isolation (`missions.py`).
- A **fake Odoo client** driving `playbook.run` through success + each failure branch (no AI
  engine, no Odoo assigned, duplicate, no expense account, unmet required fields, `OdooError`).
  `playbook.py` calls `app.services.odoo` functions — inject a fake via that module boundary.
- Postmark payload parser (`services/email_ingest/providers/postmark.py`).

**Backend:** add `backend/tests/` with `pytest`; a session fixture on a disposable
Postgres/SQLite-compatible schema (prefer a throwaway Postgres to match `JSONB`/`bytea`).

⚠️ **Challenge — `JSONB`/`bytea`/`UUID(as_uuid=True)` won't run on SQLite.** The models use
Postgres-specific column types throughout (`mission.py`, `gadget.py`). A SQLite test DB will
diverge. **Recommendation:** run tests against a real (ephemeral, e.g. testcontainers or a CI
service) Postgres so the fake-Odoo/mission tests exercise the true column types — otherwise the
suite gives false confidence.

**Acceptance:** `pytest` green in CI; the fake-Odoo playbook test covers all seven steps' success
and the enumerated failure branches.

**Size:** M. **Depends on:** —.

---

### VS-11 — Email webhook hardening: rate limit + replay auth (P1) 🔒

**Story:** As the platform, the public Postmark endpoint resists floods and forged/replayed
deliveries.

**Why now:** Review §P1 + painful-to-migrate #5. Builds on VS-8's event table (which already gives
idempotency/replay-dedup); this slice adds the *defensive* layer.

**Scope**
- *In:* rate-limit `POST /api/webhooks/email/postmark`; enforce max attachment size (done in VS-8,
  assert here); evaluate provider signing.
- *Out:* per-link webhook secrets unless Postmark can sign per recipient (review says keep
  app-level auth + local-part entropy otherwise — **honor that**, don't build per-link secrets
  speculatively).

⚠️ **Challenge — app-wide Basic Auth is a shared static credential.** `_authorized`
(`email_webhook.py:23–33`) compares one app-wide user/pass. That is acceptable per the review, but
combine it with: (a) rate limiting keyed by source IP + local-part, (b) the `(provider,
message_id)` idempotency from VS-8 as replay protection, and (c) Postmark's own inbound signature
if available. Do **not** add per-link secrets — the review explicitly parks that.

**Size:** M. **Depends on:** VS-8.

---

### VS-12 — Ledger AI-engine readiness (vision) test (P1)

**Story:** As a Commander I can validate that my configured AI engine can actually read an invoice
*before* I upload a real bill, so the demo never fails on the first bill.

**Why now:** Review §P1 — vision capability is detected too late; today a non-vision model is
accepted and only fails at `extract_bill_data` (`playbook.py:94`). For BYOK we cannot trust a
static capability registry.

**Scope**
- *In:* a "Test Ledger readiness" action that runs the *actual* configured engine against a tiny
  bundled invoice fixture and records pass/fail on the LLM config.
- *Out:* a static model-capability registry (review says explicitly: **don't** rely on one for
  BYOK).

**Backend**
- New endpoint (Ledger-owned, in `sydekyks/ledger/router.py`):
  `POST /api/tenant/sydekyks/{id}/ledger/vision-test` → runs `extraction.extract_bill_data`
  against a bundled fixture image using the tenant's virtual key/model
  (`TenantSydekykLLMConfig`), returns ok/message.
- Persist the result: add `ledger_vision_ok BOOL` + `ledger_vision_tested_at` — cleanest on
  `LedgerTenantSettings` (`sydekyks/ledger/models.py`) since it is Ledger-owned per-tenant state.
  Migration via VS-0. Feed this into VS-1's readiness (`ai_engine` becomes `warn` until vision
  passes).

⚠️ **Challenge — cost and fixture realism.** The probe burns a real (billable) vision call, and a
1×1 synthetic image won't exercise OCR. Bundle a **small but real** invoice image fixture and gate
the button so it isn't spammed (debounce + show last result). Note the spend implication for
Power-Core-hosted engines (it hits usage).

**Acceptance:** a vision-capable model returns ok and flips readiness to green; a text-only model
returns a clear "this model can't read invoices" and readiness shows `warn`.

**Size:** M. **Depends on:** VS-1.

---

### VS-13 — DocumentStorage boundary 🔒

**Story:** As a developer, all Mission document bytes flow through one storage service, so moving
to S3 later is a one-file change, not a codebase-wide edit.

**Why now:** Painful-to-migrate #4. The review is explicit: "add a `DocumentStorage` service
before sprinkling more direct `content` reads/writes." The model **already** has `storage_backend`
+ `storage_key` (`mission.py:81–83`) — the boundary is half-built. Today bytes are read directly at
`playbook.py:71,94` and written at `services/missions.py:135–146`; VS-4's retry adds another
direct copy. Every slice that touches bytes without a boundary makes the S3 migration bigger.

⚠️ **Challenge — pull this earlier than the review's Sprint C.** The review parks object storage in
Sprint C, but the *boundary* (not the S3 backend) is cheap and every intervening slice adds a new
direct `content` access. **Recommendation: land the boundary in Sprint B (before VS-4's copy and
VS-7's worker), backed by the existing `postgres_bytea` implementation.** Defer only the actual S3
backend to Sprint C. This is the difference between a 1-day abstraction now and a multi-file
migration later.

**Scope**
- *In:* `app/services/document_storage.py` with `put(bytes, meta) -> storage_key`,
  `get(document) -> bytes`, backed by `postgres_bytea` today (reads/writes
  `MissionDocument.content`). Route `create_mission_for_document`, `playbook.run`, and VS-4's copy
  through it. Enforce the DoD rule: **no direct `.content` access outside this service.**
- *Out:* the S3 backend itself (Sprint C); retention/lifecycle policy.

**Acceptance:** grep shows `MissionDocument.content` referenced only inside
`document_storage.py`; all upload/email/retry/playbook paths still work unchanged.

**Tests:** put→get round-trips; the playbook reads bytes via the service.

**Size:** M. **Depends on:** VS-0 (if it adds columns; otherwise none).

---

### VS-14 — Customer-facing Mission filters / export (Sprint C)

**Story:** As a Commander I can filter my Mission history and export it (CSV) for reconciliation.

**Why now:** Review Sprint C #4. Extends VS-3's operations page with saved/customer-facing filters
and export.

**Scope:** *In:* CSV export of the filtered Mission list; a couple of persisted quick-filters.
*Out:* scheduled reports, BI integrations.

**Backend:** `GET /api/tenant/missions/export?…` (same filters as VS-3) → streamed CSV.
**Frontend:** export button on `/hq/missions`.

**Size:** M. **Depends on:** VS-3.

---

### VS-15 — Billing-grade usage events (committed) 🔒

**Story:** As the platform, every hosted-AI call emits a durable usage event, so Power-Core
overage can be billed accurately.

**Why now:** Painful-to-migrate #6. **Decision locked: usage billing is committed**, so this is
in scope (no longer conditional). Today usage is *cached* from LiteLLM virtual-key spend snapshots
(`services/usage.py`), which is not billing-grade (no `usage_records` table); overage on cached
snapshots would be unreconcilable.

**Scope**
- *In:* a `usage_records` table (migration via VS-0) appended at each hosted-AI call — the
  extraction step (`sydekyks/ledger/extraction.py`, called from `playbook.py:94`) is the primary
  emit point. Capture `tenant_id`, `sydekyk_id`, `mission_id`, `provider`, `model`,
  input/output tokens, computed cost, `litellm_request_id`, `created_at`. Reconcile against
  LiteLLM (the authoritative spend source) rather than deriving from it.
- *Out:* invoicing/Stripe integration, overage enforcement/hard caps, the customer-facing billing
  UI — those are separate slices once the event stream is trustworthy.

⚠️ **Challenge — events must reconcile with LiteLLM, not replace it.** LiteLLM's virtual-key spend
is the source of truth for money. Emit our own event per call for *attribution* (which tenant /
Sydekyk / Mission spent it) and reconcile totals against LiteLLM periodically; if they diverge,
LiteLLM wins and the delta is flagged. Don't bill directly off our token math.

**Backend**
- New model `usage_records` + emit hook at the extraction call site. Keep the cached-snapshot path
  (`services/usage.py`) for the existing Power Meter UI until the event stream is proven, then
  switch the meter to read from `usage_records`.

**Acceptance:** each successful extraction writes exactly one `usage_records` row with a
`litellm_request_id`; a reconciliation check against LiteLLM spend for a tenant matches within a
defined tolerance.

**Tests:** one emit per call (no double-counting on retry — key on `litellm_request_id`);
reconciliation flags an injected divergence.

**Size:** L. **Depends on:** VS-0.

---

## 4. Painful-to-migrate-later — do not defer past first customers

The review's "items that will be painful to migrate later" mapped to slices, with the corrections
this analysis surfaced:

| Review item | Slice | Correction / note |
|-------------|-------|-------------------|
| 1. Queue-backed execution | VS-7 | Smaller lift than implied — `run_mission` is already a clean worker entry point. **Locked: Redis + arq**, behind an `enqueue()` seam. |
| 2. Alembic migrations | **VS-0** | **Pull to first**, not mid-Sprint-B — three later slices add columns. |
| 3. Mission ops model + retry/replay + diagnostics | VS-3, VS-4, VS-8 | Retry **must** be new-Mission-with-parent (step_index unique constraint forbids in-place). |
| 4. Object-storage boundary | **VS-13** | **Pull boundary to Sprint B**; only the S3 backend waits for Sprint C. Model already has `storage_key`. |
| 5. Email idempotency | VS-8 | **Locked: one inbox → one Sydekyk**, so key on `(message_id, attachment_hash)`. |
| 6. Billing-grade usage | VS-15 | **Locked: committed** — build `usage_records` reconciled against LiteLLM. |

`bytea` storage is fine for demo/pilot; the **boundary** (VS-13) is what must land early, not the
S3 move.

---

## 5. Challenges raised against the review (summary)

1. **Alembic ordering (VS-0):** the original review contradicts itself — VS-4 needs a column but
   Alembic sat in Sprint B. Resolved for one-pass execution: **Alembic lands first**; every
   schema-touching slice ships its own migration. (The manual-ALTER fallback only mattered for a
   demo-shortcut path we are no longer taking.)
2. **Retry model (VS-4):** the `mission_steps` unique constraint makes in-place requeue destroy the
   audit trail. New Mission + `parent_mission_id` is the only clean option; it costs a document-byte
   copy (another reason to want VS-13).
3. **Queue tech (VS-7):** the real migration cost is two call sites + retry classification, not
   tangled execution code. **Locked: Redis + arq** behind an `enqueue()` seam, `run_mission` stays
   the entry point.
4. **Email "Test Connection" (VS-2):** don't fake synchronous testing — replace it with a guided
   "send a test bill + waiting/received" flow.
5. **Email fan-out (VS-8):** **Locked: one inbox → one Sydekyk** — no fan-out, idempotency on
   `(message_id, attachment_hash)`, duplicate-bill risk removed.
6. **Storage boundary timing (VS-13):** pull the abstraction to Sprint B; every slice that touches
   `document.content` first makes the S3 migration worse.
7. **N+1 in mission lists (VS-3):** don't copy the per-row `_filename` helper into the tenant-wide
   list; use a single join.
8. **Readiness/registry genericity (VS-1, VS-9):** resist building generic frameworks for a
   one-Sydekyk product — keep both Ledger-owned and plain until Sydekyk #2.
9. **Test DB (VS-10):** Postgres-only column types mean SQLite tests give false confidence — test
   against real Postgres.
10. **Usage events (VS-15):** **Locked: committed** — build `usage_records` per hosted-AI call,
    reconciled against LiteLLM (LiteLLM stays the source of truth for money).

---

## 6. Recommended sequencing (one coordinated pass)

This plan is executed as **one coordinated implementation pass**, not a near-demo shortcut. That
removes the earlier "ship no-schema demo polish before Alembic" tension: with one pass we keep a
**foundation-first** posture and land migration-cost reducers before the features that would
otherwise pay the migration tax.

Dependency graph (arrows = "must precede"):

```
VS-0 (Alembic) ─► VS-13 (storage bnd) ─┬─► VS-4 (retry)
                                        └─► VS-7 (queue)
VS-0 ─► VS-8 (ingest events) ─► VS-11 (webhook hardening)
VS-9 (fe registry) ─┬─► VS-2 (email UI) ─► VS-1 (readiness) ─┬─► VS-6 (demo check)
                    ├─► VS-5 (playbook panel)                └─► VS-12 (vision test)
                    └─► (VS-1 setup UI lives here too)
VS-3 (ops page) ─► VS-4 (retry button surfaces here) ─► VS-14 (filters/export)
VS-10 (tests) — grows alongside every slice, not a final phase
VS-15 (usage) — committed (build usage_records, reconcile vs LiteLLM)
```

**Execution order:**

1. **VS-0** — Alembic baseline.
2. **VS-13** — DocumentStorage boundary (backed by current `bytea`). *Before* any new document copy.
3. **VS-9** — Frontend Sydekyk refactor + registry. *Before* VS-1/VS-2/VS-5 so their Ledger UI is
   built in `frontend/src/sydekyks/ledger/` once, not built in `components/` then moved.
4. **VS-2** — Ledger email inbox UX.
5. **VS-1** — Ledger readiness checklist.
6. **VS-5** — Read-only Ledger Playbook panel.
7. **VS-3** — Tenant-wide Mission operations page.
8. **VS-4** — Failed-Mission retry (surfaces in VS-3's page; needs VS-13's boundary).
9. **VS-8** — Email ingest events + idempotency + size cap (gives VS-7 operational visibility for
   email-triggered Missions).
10. **VS-10** — Backend test suite: **started early, expanded as each slice lands** (not deferred).
11. **VS-7** — Queue-backed execution (add `failure_category` before turning on auto-retry).
12. **VS-11** — Webhook hardening (rate limit + replay).
13. **VS-12** — Vision readiness test.
14. **VS-14** — Export + advanced filters.
15. **VS-15** — Billing-grade usage events (committed): `usage_records` per hosted-AI call,
    reconciled against LiteLLM.

**Rationale for the key ordering choices:**
- VS-0 and VS-13 first — reduce migration cost before new schema and document-copy behavior land.
- VS-9 early — VS-1/VS-2/VS-5 all add Ledger frontend UI; refactoring first avoids moving the same
  components twice.
- VS-3 before VS-4 — retry needs a natural place to appear.
- VS-8 before VS-7 — queue/retry work benefits from email-ingest visibility already being in place.
- VS-10 in parallel — the suite is far more useful growing alongside the slices than arriving last.

**Scope guardrails (hold even in one pass):** no editable Playbooks; no scheduled Signals; no
generic frontend plugin system beyond the plain registry object; no S3 backend (boundary only);
usage events emit + reconcile only — no invoicing/Stripe/overage enforcement yet. Consistent with the review's core
recommendation: *finish Ledger's operational surface, don't build the whole target architecture.*
