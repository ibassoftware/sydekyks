# Ledger Demo Readiness Review

Date: 2026-07-05

Scope: independent review of `docs/BUILD_REPORT.md`, `ARCHITECTURE.md`, and the current source code. The goal is to make Ledger demo-ready ASAP while polishing the minimum shared infrastructure needed to keep building sidekicks without painting the platform into a corner.

## Executive summary

Ledger is closer to a functional demo than the high-level architecture document implies. The core path exists: install Ledger, configure an AI engine, connect Odoo, upload or email a bill, create a Mission, run the Ledger playbook, write step history, and show the result in the UI.

The biggest gaps are not in the Odoo bill-creation logic. The biggest gaps are demo control, setup clarity, operations visibility, and durable execution:

1. Mission execution is in-process `BackgroundTasks`, not a worker queue. This is acceptable for a controlled demo but is the first thing that will become painful with real customers.
2. There is no first-class Mission operations page. Run history exists, but only inside a Sydekyk detail panel and without filters, retry, replay, or cross-source visibility.
3. Email ingestion exists in the backend and partially in the UI, but it is not presented as a complete Ledger setup flow. A customer can create an Email Inbox Gadget Link, but there is no guided test or clear status that Postmark/DNS/webhook routing is working.
4. Playbooks are code-registered functions, not persisted definitions. That is fine for Ledger v1, but the product should not promise editable Playbooks yet.
5. Backend Sydekyk structure is in good shape after the refactor: Ledger lives under `backend/app/sydekyks/ledger/` with its own playbook, settings, models, router, seed, and business logic. The frontend has not had the same modular refactor yet.
6. The architecture document is ahead of the implementation in several places: worker queue, S3 storage, playbook tables, signals, chat messages, usage records, scheduler, object storage, and production deployment.

Recommendation: do not broaden the product surface right now. Polish Ledger's existing path and add the smallest operational backbone: mission history, retry/requeue, setup checklist, email test flow, and basic queue-backed execution.

## Current state: docs vs code

### What is implemented and usable

- Generic Mission records exist: `missions`, `mission_steps`, and `mission_documents` in `backend/app/models/mission.py`.
- Web upload creates Missions and schedules execution via FastAPI `BackgroundTasks` in `backend/app/routers/documents.py`.
- Email webhook ingestion exists for Postmark in `backend/app/routers/email_webhook.py`.
- Ledger registers a code playbook under `ledger.vendor_bill_ingest` in `backend/app/sydekyks/ledger/playbook.py`.
- Ledger declares required Odoo and optional Email Gadget requirements in `backend/app/sydekyks/ledger/seed.py`.
- Generic Gadget Links exist for Odoo and Email Inbox in `backend/app/routers/gadgets.py`.
- Ledger setup UI includes AI Engine, Ledger settings, Gadget requirement assignment, document upload, and recent Missions in `frontend/src/pages/SydekykDetail.tsx` and `frontend/src/components/DocumentIntakeSection.tsx`.
- Mission detail shows step audit trail and Ledger-specific summary.
- Power Core usage is cached from LiteLLM virtual key spend snapshots in `backend/app/services/usage.py`.

### Backend structure is ahead of frontend structure

The backend already has the right direction for adding sidekicks without constantly editing shared platform files. Ledger is isolated in `backend/app/sydekyks/ledger/`, and the generic discovery/registration pattern lets the platform collect routers, seed functions, and playbook registrations. This is a strong foundation.

The frontend is still more centralized:

- `frontend/src/pages/SydekykDetail.tsx` contains generic Sydekyk detail UI, AI Engine UI, Ledger settings UI, and Ledger-specific conditional rendering.
- `frontend/src/components/DocumentIntakeSection.tsx` is generic enough for upload/history, but it directly switches to `LedgerMissionSummary` for Ledger result rendering.
- Ledger-specific UI exists in shared component/page locations instead of a Ledger-owned frontend package.

Recommended frontend direction:

- Add `frontend/src/sydekyks/ledger/` for Ledger-owned UI.
- Move Ledger settings, Ledger mission summary, and read-only Ledger Playbook panel into that folder.
- Add a small frontend registry, similar in spirit to the backend registry, where each Sydekyk can provide optional detail sections, mission summary renderers, setup panels, and icons/assets.
- Keep truly generic pieces in `frontend/src/components/`, such as upload controls, mission list primitives, status badges, and Gadget assignment controls.

This should be a P1 refactor. It is not a blocker for the next demo, but it will become messy once a second real workflow sidekick is added.

### What `BUILD_REPORT.md` gets right

`docs/BUILD_REPORT.md` is mostly accurate as an as-built report. It correctly calls out:

- `BackgroundTasks` instead of a worker queue.
- Postgres `bytea` document storage instead of object storage.
- No rate limiting.
- Email ingestion depends on Postmark/DNS/webhook deployment setup.
- No synchronous Email Inbox test.
- No migration tool.
- Vision extraction still depends on testing with a real provider key.

### Where `ARCHITECTURE.md` is ahead of the code

`ARCHITECTURE.md` should be treated as target architecture, not current state. These items are not currently implemented as described:

- Worker queue for Playbook execution.
- Scheduler and scheduled Signals.
- Persisted `playbooks` and `playbook_signals` tables.
- Chat `messages` table and SSE chat flow.
- `usage_records` table and billing-grade usage events.
- S3-compatible object storage for uploads.
- Containerized backend/frontend production deployment.
- Refresh-token rotation/revocation.
- Rate limiting and replay protection for webhooks.
- RAG/Intel ingestion pipeline.

This is not a failure, but the distinction matters for planning and demos. The product should not imply those capabilities are available until they exist.

## Functional gaps that matter for Ledger demos

### P0: Ledger setup is not guided enough

Current state: Ledger has the necessary pieces, but the Commander has to discover the correct sequence:

1. Install Ledger.
2. Configure AI Engine.
3. Connect Odoo.
4. Assign Odoo to Ledger.
5. Optionally connect Email Inbox.
6. Assign Email Inbox to Ledger.
7. Upload or email a bill.

Problem: if any step is missing, the Mission fails after upload/email. That is technically correct but weak for demos and onboarding.

Build now:

- Add a Ledger readiness checklist in the Ledger detail page.
- Show status for AI Engine, Odoo assignment, Odoo connection test, Email Inbox assignment, and last inbound email.
- Disable or warn on upload when required setup is incomplete.
- Keep optional Email visible but label it as optional.
- Surface exact next action links: "Connect Odoo", "Assign Odoo", "Test AI Engine", "Create Email Inbox".

Why now: this is high demo value and low migration risk.

### P0: Mission history needs a real operations view

Current state: Mission history exists at `/api/tenant/sydekyks/{sydekyk_id}/missions` and appears as "Recent Missions" in the upload panel.

Problem: it is not enough once demos include email, multiple uploads, failed runs, or customer questions like "what happened to this bill?"

Build now:

- Add `/hq/missions` as a tenant-wide operations page.
- Add backend list endpoint across all tenant Missions with filters: Sydekyk, status, signal type, date range, filename, and limit/page.
- Include source (`web_upload` vs `email`) and created/completed timestamps.
- Allow opening a Mission detail drawer/page with step trail and result summary.
- Add a manual "Retry" action for failed Missions after setup is corrected.

Why now: run history is core trust infrastructure. It also reduces support burden during demos.

### P0: Email integration exists but is not productized

Current state: Email Inbox Gadget Links can be created, they generate an inbound address, and Postmark webhook ingestion can create Missions.

Problem: the user concern is valid. There is UI, but it is too indirect and lacks a clear Ledger email integration experience.

Build now:

- In Ledger setup, show the assigned inbound address directly, not only in the generic Gadgets page.
- Add "Create Email Inbox" from Ledger setup when no eligible Email Gadget Link exists.
- Add "Send test bill to this address" instructions and last received timestamp.
- Record ignored inbound events somewhere lightweight, at least logs or an `email_ingest_events` table, so a misrouted email can be diagnosed.
- Rename "Test Connection" behavior for Email Inbox. Returning "can't be tested synchronously" is technically true but poor UX.

Why now: email ingestion is a key demo differentiator and easy to misunderstand if hidden behind generic integration language.

### P0: Failed Missions cannot be retried

Current state: a failed Mission stays failed. The user can upload/email the document again.

Problem: if a Mission fails because Odoo was not assigned, AI Engine was not configured, or Postmark was misrouted, the original run cannot be recovered. This creates duplicates and noisy demos.

Build now:

- Add a `retry_count` and maybe `last_retried_at` to Missions, or use an appended step/result if avoiding schema change initially.
- Add `POST /api/tenant/missions/{id}/retry` for failed Missions.
- Retry should create a new Mission linked to the original or requeue the same Mission after clearing terminal fields. Prefer creating a new Mission with `parent_mission_id` for auditability.
- Add UI action on failed Mission detail.

Why now: retry is small compared with a full queue and gives immediate operational control.

### P1: Background execution needs a queue before real customers

Current state: `run_mission` is scheduled via FastAPI `BackgroundTasks`.

Problem:

- Jobs die if the backend process restarts.
- No retries/backoff.
- No concurrency controls.
- No visibility into stuck jobs.
- No horizontal scaling.
- No scheduler foundation.

Recommendation:

- For demo only: keep `BackgroundTasks` if time is extremely tight.
- Before onboarding initial 10 customers: introduce a real queue.

Suggested pragmatic path:

- Use `arq` or `RQ` with Redis if keeping the stack simple.
- Keep the current `run_mission(mission_id)` entry point and call it from the worker, so migration is contained.
- Add a `mission_jobs` concept only if the queue library does not provide enough observability.
- Add retry policy by failure class:
  - LLM/network timeout: retry with backoff.
  - Odoo network/auth transient: retry or mark actionable.
  - Validation/setup errors: do not auto-retry; mark needs setup.

This is one of the items that becomes painful to migrate later because the current request process owns too much execution responsibility.

### P1: Playbook is implemented as code, not as a product surface

Current state: Ledger's Playbook is a registered Python function. Steps are code-defined and persisted only as `mission_steps` after execution.

Problem: `ARCHITECTURE.md` describes Playbooks as workflow definitions with steps and Signals. That is not built. The current code is fine for Ledger, but "Playbook" should be positioned carefully.

Build now:

- Add a read-only Playbook panel for Ledger showing the code-defined steps:
  1. Extract bill data
  2. Connect Odoo
  3. Find/create vendor
  4. Duplicate check
  5. Infer account
  6. Create bill
  7. Post when confidence threshold passes
- Make this read-only. Do not build editable Playbooks yet.
- Add step descriptions and likely failure causes.

Defer:

- Persisted playbook editor.
- Branching/DAG.
- User-authored steps.
- Scheduling UI.

Why: read-only Playbook visibility helps demos without committing to a workflow builder.

### P1: Frontend needs the same modular Sydekyk structure as the backend

Current state: the backend has a clean per-Sydekyk structure, but the frontend still mixes generic and Ledger-specific code in shared files.

Problem: this is fine for one sidekick, but it will slow development once a second workflow sidekick needs custom setup, custom result summaries, or custom intake panels. It will also make shared UI changes riskier because shared files will accumulate sidekick-specific branches.

Build soon:

- Create `frontend/src/sydekyks/ledger/`.
- Move `LedgerMissionSummary` into `frontend/src/sydekyks/ledger/LedgerMissionSummary.tsx`.
- Extract `LedgerSettingsSection` from `SydekykDetail.tsx` into `frontend/src/sydekyks/ledger/LedgerSettingsSection.tsx`.
- Add `LedgerPlaybookPanel.tsx` in the same folder.
- Add a lightweight `frontend/src/sydekyks/registry.tsx` that maps `slug` or `playbook_key` to optional components:
  - setup section,
  - mission summary renderer,
  - playbook panel,
  - intake helper copy if needed.
- Keep `SydekykDetail.tsx` responsible for layout and generic sections only.

Why: backend modularity is already good. Matching that on the frontend is the right infrastructure polish before more sidekicks are built.

### P1: No migration system

Current state: schema changes are `Base.metadata.create_all` and manual ALTERs.

Problem: this becomes risky as soon as real customer data exists. It also makes repeatable demo/staging/prod setup harder.

Build now or immediately after demo:

- Add Alembic.
- Generate a baseline migration from current models.
- Capture existing manual ALTERs into migrations.
- Stop relying on `create_all` for evolving schemas.

Why: migration debt compounds quickly and is painful to unwind after customers are active.

### P1: No automated tests around the Ledger path

Current state: no tracked test files were found.

Build now:

- Unit tests for extraction JSON parsing/coercion.
- Unit tests for duplicate detection and confidence scoring.
- Service tests for Mission creation and step recording.
- Router tests for upload validation and tenant isolation.
- A fake Odoo client test for the Ledger playbook success/failure paths.
- A Postmark payload parser test.

Why: Ledger touches money-facing operations. The minimum test suite will pay for itself immediately.

### P1: Email webhook security and diagnosis need hardening

Current state: app-wide Basic Auth plus fail-closed local-part lookup.

Build soon:

- Rate limit the webhook.
- Store inbound event metadata: recipient, sender, attachment count, accepted/ignored reason, matched tenant/link/sydekyk if any.
- Add replay/idempotency using provider message ID and attachment hash.
- Enforce max attachment size for email, matching upload size.
- Consider per-link webhook secret only if the provider can route/sign per recipient; otherwise keep app-level auth plus local-part entropy.

Why: email endpoints are noisy in production and hard to debug without event records.

### P1: Vision model capability is detected too late

Current state: non-vision model assignment is allowed; extraction fails with a helpful message.

Build soon:

- Add a lightweight "Ledger readiness test" that validates the selected model with a tiny known invoice image/PDF.
- Store whether the config passed Ledger readiness.
- Do not rely on a static model capability registry for BYOK; test the actual configured engine.

Why: this prevents demo failure after uploading the first real bill.

## Items that can wait

These are not needed to demo Ledger or onboard the first small cohort if expectations are managed:

- Full editable Playbook builder.
- Scheduler and recurring Playbook Signals.
- Chat mode and SSE.
- RAG/Intel pipeline.
- Partner-facing Sydekyk packaging/sandboxing.
- Stripe billing integration.
- Full object storage migration, if bill volume is low and retention is controlled.
- Kubernetes or multi-region deployment.

## Items that will be painful to migrate later

Prioritize these before or during the first 10 customers:

1. Queue-backed Mission execution.
2. Alembic migrations.
3. Mission history/operations model, including retry/replay and event diagnostics.
4. Object storage boundary for Mission documents.
5. Idempotency for email ingestion and document processing.
6. Billing-grade usage events if Sydekyks-hosted AI will be charged by usage.

Postgres `bytea` storage is acceptable for demo and short-lived pilots, but define the storage service boundary before volume grows. The model already has `storage_backend` and `storage_key`, which is good; add a `DocumentStorage` service before sprinkling more direct `content` reads/writes through the code.

## Recommended build order

### Sprint A: Demo polish, 1-3 days

1. Ledger readiness checklist.
2. Show assigned Email Inbox address directly in Ledger setup.
3. Add tenant-wide Mission history page.
4. Add failed Mission retry action.
5. Add read-only Ledger Playbook panel.
6. Add demo seed/check script that verifies Ledger, Odoo link, AI config, and Email Inbox assignment.

### Sprint B: Operational backbone, 3-5 days

1. Add queue worker and move Mission execution out of FastAPI `BackgroundTasks`.
2. Add queue retries/backoff by failure type.
3. Add email ingest event logging and idempotency.
4. Add Alembic and baseline migration.
5. Refactor frontend Ledger-specific UI into `frontend/src/sydekyks/ledger/` and add a small Sydekyk frontend registry.
6. Add minimum backend test suite around Ledger and Mission execution.

### Sprint C: First-customer hardening

1. Add object-storage adapter for documents.
2. Add rate limiting.
3. Add Ledger readiness test using actual configured AI engine.
4. Add customer-facing Mission filters/export.
5. Add billing-grade usage events if Power Core overage is in scope.

## Product positioning for now

Use this language internally and in demos:

- "Ledger has a fixed Playbook for vendor bill intake."
- "You can inspect every Mission and step."
- "Bills can enter by upload or by inbound email."
- "Odoo is the first supported ERP integration."
- "AI Engine can be Sydekyks-hosted or tenant-provided, but Ledger requires a vision-capable model."

Avoid implying these are available today:

- Editable Playbooks.
- Scheduled Playbooks.
- General-purpose chat Missions.
- Production-grade retry/scheduling.
- Full billing automation.
- RAG/Intel.

## Final recommendation

For demo readiness, do not start by building the whole target architecture. Finish Ledger's operational surface:

- setup checklist,
- email visibility,
- mission history,
- retry,
- read-only playbook,
- and a minimal worker migration plan.

That gives the product a believable end-to-end story while preserving the architecture path toward more sidekicks.
