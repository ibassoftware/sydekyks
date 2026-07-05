# Ledger Vertical Slices Feedback

Date: 2026-07-05
Reviewed file: `docs/LEDGER_VERTICAL_SLICES.md`
Assumption revised: this work will be implemented in one coordinated pass, not as a near-demo shortcut.

## Revised Verdict

Under the revised assumption, I would approve `LEDGER_VERTICAL_SLICES.md` as the working implementation plan with a few targeted edits.

My earlier concern was sequencing for an immediate demo: I recommended shipping no-schema demo polish before Alembic. If we are doing the work in one go, that concern no longer applies. In that mode, the vertical slices plan is directionally correct to pull Alembic forward and handle foundation before piling on more operational features.

The plan is strong because it does not just list features. It names the real files, endpoints, data-model pressure points, acceptance criteria, and hidden migration costs. It also challenges the readiness review in the right places.

## What Is Strong

- VS-0 Alembic first is the right choice for one-pass implementation. Several planned slices add tables or columns, and continuing with manual ALTERs would create avoidable drift.
- VS-4 correctly chooses a new Mission linked to the original instead of requeueing in place. The `mission_steps` unique constraint makes in-place retry a bad audit-trail tradeoff.
- VS-7 correctly observes that `run_mission(mission_id)` is already close to a worker entry point. The migration is mostly about scheduling, retry policy, and observability.
- VS-8 correctly prioritizes email diagnostics and idempotency. For email-driven demos and pilots, silent webhook branches are a support trap.
- VS-9 is scoped well: a plain frontend registry and `frontend/src/sydekyks/ledger/`, not a speculative plugin framework.
- VS-13 correctly pulls the document storage boundary earlier than full S3. The boundary matters more than the actual storage backend right now.
- VS-15 is correctly conditional. Billing-grade usage events should wait for a real usage-billing product decision.

## Required Edits Before Treating It As Final

### 1. Keep Alembic First

With one-pass implementation, do not split demo polish ahead of Alembic. Keep VS-0 first.

Tighten VS-0 details:

- In the current code, `Base.metadata.create_all(bind=engine)` is in `backend/app/seed.py`, not app startup.
- Add Alembic to `backend/requirements.txt`.
- Separate schema setup from seed data in the developer workflow: `alembic upgrade head` first, then seed.
- Keep `create_all` only temporarily for local bootstrap/test fixtures if explicitly needed.
- Replace "diff schemas by hand" with a documented command/checklist or scripted schema comparison.

### 2. Put DocumentStorage Before Retry

The plan says the storage boundary should land before VS-4's document copy, but the dependency diagram still lets VS-4 follow VS-0 directly.

For one-pass execution, use this foundation order:

1. VS-0 Alembic baseline.
2. VS-13 DocumentStorage boundary, backed by current Postgres `bytea`.
3. VS-4 failed-Mission retry.
4. VS-8 email ingest events and idempotency.
5. VS-7 queue-backed execution.

This avoids adding new direct `MissionDocument.content` access in retry before the storage boundary exists.

### 3. Tighten Retry Fields

`parent_mission_id` is right, but `retry_count` on a new Mission row is ambiguous.

Prefer:

- `parent_mission_id`, nullable.
- `attempt_number`, default `1`.
- Optional but better: `root_mission_id` for grouping a retry chain.

If keeping it lean, use `parent_mission_id + attempt_number`. Avoid `retry_count` unless it is clearly defined as a counter on the root Mission.

Also specify that retry copies the original document and original `playbook_key`. A retry should replay the original Mission contract unless the UI explicitly offers "retry with latest Playbook" later.

### 4. Add Failure Category Before Queue Auto-Retry

VS-7's automatic retry policy needs structured failure information. Today many Ledger failures are handled inside the playbook by setting Mission status and error fields, not by raising typed exceptions.

Add one small model/convention before queue retry policy:

- `Mission.failure_category`, with values like `setup`, `transient`, `validation`, `external`, `unknown`; or
- a structured `result_summary.failure_category` convention for v1.

Without this, retry policy will drift into string matching. It is acceptable for queue v1 to only move execution out of process first, then add automatic retry once failure categories are populated.

### 5. Add Navigation/IA Acceptance Criteria

The plan adds Ledger setup panels and `/hq/missions`, but should explicitly include navigation polish because hidden capabilities undermine demos.

Add acceptance criteria to VS-3 or a small new slice:

- HQ dashboard links clearly to Missions, Gadgets, Roster, and Settings.
- Ledger links to the full Gadgets page only when deeper integration management is needed.
- Mission detail is reachable from both Ledger and `/hq/missions` using shared UI.
- The Retry button appears consistently wherever failed Mission detail is shown.

### 6. Fix Markdown Formatting

`LEDGER_VERTICAL_SLICES.md` appears to end with an extra closing code fence. Remove the trailing ```.

Also check whether the rendered Markdown handles the emoji/arrows correctly. If there is any mojibake in the IDE preview, replace decorative symbols with ASCII. For implementation docs, durability beats visual polish.

## Revised Sequencing For One-Pass Implementation

Use this order instead of my previous "demo first" split:

1. VS-0: Alembic baseline.
2. VS-13: DocumentStorage boundary.
3. VS-9: frontend Sydekyk modular refactor and registry.
4. VS-2: Ledger Email Inbox UX.
5. VS-1: Ledger readiness checklist.
6. VS-5: read-only Ledger Playbook panel.
7. VS-3: tenant-wide Mission operations page.
8. VS-4: failed-Mission retry.
9. VS-8: email ingest events, idempotency, size cap.
10. VS-10: backend test suite, started early and expanded as slices land.
11. VS-7: queue-backed execution.
12. VS-11: webhook hardening.
13. VS-12: actual vision readiness test.
14. VS-14: export and advanced filters.
15. VS-15: usage events only if usage billing is committed.

Rationale:

- VS-0 and VS-13 reduce migration cost before new schema and document-copy behavior land.
- VS-9 should happen early because VS-1, VS-2, and VS-5 all add Ledger-specific frontend UI; doing the refactor first avoids moving the same components twice.
- VS-3 before VS-4 gives retry a natural place to appear.
- VS-8 before VS-7 gives queue/retry work better operational visibility for email-triggered Missions.
- VS-10 should run in parallel, but the test suite will be more useful if it grows alongside the slices instead of arriving only at the end.

## Optional Scope Control

Even in one pass, keep these boundaries:

- Do not build editable Playbooks.
- Do not build scheduled Signals yet.
- Do not build a generic frontend plugin system beyond a plain registry object.
- Do not build S3 yet; build the `DocumentStorage` boundary with the current Postgres backend.
- Do not build billing-grade usage events unless usage billing is committed.

## Final Recommendation

Yes, the vertical slices plan is good. With the revised assumption that this is implemented in one coordinated pass, I would no longer recommend delaying Alembic for demo polish. Keep the foundation-first posture.

Make the targeted edits above, especially DocumentStorage-before-retry and structured failure categories before automatic queue retry. Then use `LEDGER_VERTICAL_SLICES.md` as the implementation backlog.