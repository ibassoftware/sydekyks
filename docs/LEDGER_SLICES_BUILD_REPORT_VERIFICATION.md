# Ledger Slices Build Report Verification

Date: 2026-07-05
Reviewed report: `docs/LEDGER_SLICES_BUILD_REPORT.md`
Scope: independent verification against the current source tree, local build/test commands, and the vertical-slices plan/feedback docs.

## Verdict

The build report is mostly accurate on scope: the claimed files and features are present, the frontend build passes, backend compile passes, OpenAPI includes the new routes, schema diff reports clean, and the repo `.venv` reproduces the reported `19 passed` backend tests.

However, I found several missed functional risks. Two are important enough to fix before relying on the report as a clean completion sign-off:

1. arq automatic retry currently re-runs the same Mission row and can collide with existing `mission_steps`.
2. email ingest duplicate/event logging conflicts with the unique `(provider, message_id)` constraint and can fail exactly when duplicate delivery happens.

These do not invalidate the whole build. They are targeted issues in otherwise substantial progress.

## Verification I Performed

Commands run locally:

- `..\.venv\Scripts\python.exe -m compileall app worker.py migrations scripts` from `backend`: passed.
- `..\.venv\Scripts\python.exe -m pytest tests` from `backend`: 19 passed, 1 pytest cache warning.
- `npm run build` from `frontend`: passed, 97 modules built.
- `..\.venv\Scripts\python.exe -m scripts.schema_diff` from `backend`: `Schema in sync with models.`
- OpenAPI import check: `app.openapi()` registered 41 paths; confirmed `/api/tenant/ledger/readiness`, `/api/tenant/missions`, and `/api/webhooks/email/postmark` exist.
- Grep checks:
  - No direct `MissionDocument.content` reads/writes outside `document_storage.py`.
  - No `slug === "ledger"` or `playbook_key === "ledger.vendor_bill_ingest"` branches in shared frontend pages/components. Ledger keys remain only in `frontend/src/sydekyks/registry.tsx`, as intended.

Could not verify Docker state through `docker ps` because the Docker API pipe was denied in this shell. The build report's Docker/Redis/live-LLM claims may still be true, but I did not independently reproduce them here.

## Confirmed As Implemented

- VS-0 Alembic files exist and `schema_diff` is clean in the current local DB.
- VS-13 `DocumentStorage` boundary exists and call sites use it.
- VS-9 frontend registry exists with Ledger-owned UI under `frontend/src/sydekyks/ledger/`.
- VS-1/VS-2/VS-5 Ledger readiness, email inbox, and playbook UI are present.
- VS-3 tenant-wide Missions page and backend list/export endpoints are present.
- VS-4 manual failed-Mission retry creates a new linked Mission with `parent_mission_id`, `root_mission_id`, and `attempt_number`.
- VS-8 email ingest event model and webhook path are present.
- VS-10 test suite exists and passes in the repo `.venv`.
- VS-12 vision readiness endpoint exists.
- VS-15 usage record model/service and extraction metadata plumbing are present.

## Findings

### P0: arq auto-retry re-runs the same Mission and can break on duplicate step indexes

Files:

- `backend/worker.py`
- `backend/app/services/missions.py`
- `backend/app/sydekyks/ledger/playbook.py`
- `backend/app/models/mission.py`

The manual retry path correctly creates a new Mission because `mission_steps` has a unique `(mission_id, step_index)` constraint. But the arq worker does not use that model. It calls `run_mission(mission_id)` again for the same Mission when `failure_category` is `transient` or `external`.

That is unsafe. A retryable failure usually records at least one failed step before the Mission is marked failed. On the next arq attempt, `run_mission` sets the same Mission back to `running`, the playbook starts at `idx = 0`, and `record_step(... step_index=0 ...)` can collide with the existing row.

Likely outcomes:

- transient extraction failure: step `0` already exists as failed; retry collides at step `0`.
- Odoo connection failure: step `0` succeeded and step `1` failed; retry collides at step `0`.
- later external failure: retry collides even more reliably.

The report says the worker retry policy is driven by `Mission.failure_category`; that is true, but the retry execution model conflicts with the audit-trail model.

Recommendation:

- For now, disable arq automatic retry for Mission execution, or have arq retry create a new linked Mission using the same lineage model as manual retry.
- Better: split queue job attempts from Mission attempts. A queue retry should only re-run if no steps were recorded, or it should create a new Mission attempt.
- Add a test that simulates a retryable failed Mission with an existing `mission_steps` row and then runs `run_mission_task` again.

### P0: email duplicate/event logging conflicts with `uq_email_ingest_provider_message`

Files:

- `backend/app/models/email_event.py`
- `backend/app/routers/email_webhook.py`
- `backend/migrations/versions/0003_email_ingest_events.py`

`email_ingest_events` has a unique constraint on `(provider, message_id)`. The webhook uses that same table both as an event log and an idempotency ledger.

That creates a conflict:

- First valid delivery records `outcome=accepted` with `message_id=X`.
- Duplicate delivery detects the existing accepted row.
- It then calls `_record(db, email, "duplicate", ...)` with the same `message_id=X`.
- The insert violates `uq_email_ingest_provider_message`.

So the duplicate branch that should be safe can 500 instead of recording `duplicate`.

There is a second variant:

- First delivery records `no_match` with `message_id=X`.
- Later, after config is fixed, the same message is retried.
- The duplicate check only looks for `accepted` or `ambiguous_inbox`, so it proceeds.
- Any new event row with `message_id=X` violates the unique constraint anyway.

Recommendation:

- Separate event logging from idempotency state.
- Option A: keep `email_ingest_events` append-only and add a separate `email_processed_messages` table keyed by provider/message_id or provider/message_id/attachment_hash.
- Option B: add a nullable `dedupe_key` column with a partial unique index only for processed/accepted events, and let event rows be append-only.
- At minimum, do not insert a second event row with the same unique key.
- Add a router/service test for repeated Postmark delivery hitting the actual duplicate branch.

### P1: webhook does not actually record every branch

The report says the webhook writes an event on every branch. Current code misses at least these branches:

- `rate_limited` returns before opening a DB session or recording an event.
- invalid JSON returns `ignored` without recording an event.

Also, if all attachments are unsupported, the loop creates zero Missions and then records `accepted` with `missions_created=0`. That is not technically an accepted bill; it should probably be `no_supported_attachment` or similar.

Recommendation:

- Record `rate_limited` and `ignored` outcomes.
- Add an explicit outcome when no attachments pass type filtering.
- Add tests for these branches.

### P1: queue/live verification claim is narrower than it sounds

The build report says the queue depth went `1 -> 0` and the worker registered/drained jobs. That proves arq wiring, not that Mission retry semantics are correct.

The existing tests do not cover:

- arq retry after a transient/external failure,
- duplicate step-index behavior on worker retry,
- queue fallback behavior when Redis enqueue fails,
- concurrent duplicate enqueue with the same `_job_id`.

Recommendation:

- Keep the build report claim, but qualify it: queue transport was verified; retry semantics still need a targeted test/fix.

### P1: readiness `last_inbound_email` is tenant-wide, not Ledger-inbox specific

File: `backend/app/sydekyks/ledger/readiness.py`

`last_event` is selected by `tenant_id` only. If future inboxes or sidekicks exist, Ledger readiness may show a timestamp from an unrelated email event.

Recommendation:

- Filter by `matched_sydekyk_id == ledger.id` or the assigned Ledger inbox link.
- For now it is low risk because Ledger is the only workflow sidekick, but this will matter at Sydekyk #2.

### P1: upload readiness gating is frontend-only

Files:

- `frontend/src/components/DocumentIntakeSection.tsx`
- `backend/app/routers/documents.py`

The report says upload is gated on `can_upload`. That is true in the UI, but the backend upload endpoint still accepts documents when readiness is incomplete and then creates a Mission that fails.

This may be acceptable for now because the playbook fails cleanly. But if the product expectation is "cannot upload until ready," enforce the required readiness checks server-side too, or document that the gate is UX-only.

### P1: baseline migration is pragmatic but non-standard

Files:

- `backend/migrations/versions/0001_baseline.py`
- `backend/migrations/helpers.py`

The name-filtered `create_all` baseline plus idempotent additive migrations works in the current environment and `schema_diff` is clean. The build report is transparent about this.

The tradeoff: revision `0001_baseline` is not a stable historical schema. On a fresh DB it creates current-model versions of baseline tables, including columns that later migrations also guard. On a stamped existing DB it represents whatever the existing DB already had.

This can be workable for a young project, but it should be called out as migration debt, not just an implementation detail.

Recommendation:

- Accept for now if the current DBs are all under control.
- Before production, consider replacing the baseline with explicit DDL or freezing a true baseline snapshot.
- Add CI that runs `alembic upgrade head` from empty and `schema_diff` every time.

### P2: email idempotency does not match the locked decision text exactly

The plan says one inbox -> one Sydekyk and idempotency key `(message_id, attachment_hash)`. Current implementation dedupes by `(provider, message_id)` only.

That is stricter than the stated key. It prevents reprocessing any attachment from the same email message, which may be fine. But the code/report should align. If a single email has multiple attachments, they are processed under one message-level event.

Recommendation:

- Either update the docs to say message-level idempotency, or add attachment-level event/processed rows with attachment hashes.

### P2: `ambiguous_inbox` still processes the first matching Sydekyk

The locked decision says one inbox -> one Sydekyk. Current code allows multiple assignments, chooses the first row, creates Missions, and records `ambiguous_inbox`.

That avoids fan-out, but the chosen Sydekyk is not deterministic without an order. If ambiguous configuration is invalid, reject processing instead of selecting a first row.

Recommendation:

- Enforce uniqueness at assignment time for email inbox links, or treat ambiguous inbox as rejected with zero Missions.

### P2: build report says `usage_records` is billing-grade, but reconciliation remains unproven

The plumbing exists and tests cover usage emission. The report also says live reconciliation still needs a priced provider. That caveat is important.

Recommendation:

- Do not call this billing-ready until reconcile has been exercised against a priced provider and a tenant-level billing period model exists.
- Current implementation is attribution-event ready, not full billing ready.

## Report Corrections Suggested

I would update `LEDGER_SLICES_BUILD_REPORT.md` with these clarifications:

- Change "all 16 slices implemented" to "implemented with the following remaining correctness fixes" unless the P0 issues are fixed first.
- Change VS-7 wording from "retry policy driven by Mission.failure_category" to "queue transport works; retry policy exists but needs same-Mission retry semantics fixed."
- Change VS-8 wording from "webhook writes an event on every branch" to list the unrecorded branches or fix them.
- Change email idempotency from `(message_id, attachment_hash)` to the actual `(provider, message_id)` implementation, or implement attachment hash.
- Clarify that upload gating is frontend-only.
- Add the migration-baseline tradeoff as accepted debt.

## Final Recommendation

Do not treat the build report as fully closed yet. The implementation is broad and much of it verifies, but fix the two P0 issues before demo/customer use:

1. align arq retry behavior with the new-Mission retry model, and
2. split email event logging from idempotency so duplicate deliveries do not violate the unique constraint.

After those are fixed, rerun the same checks plus new tests for duplicate email delivery and retryable worker failure.