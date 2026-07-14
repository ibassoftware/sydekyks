# Prompt for a New Odoo Agent (Sydekyk)

A working brief for designing and building a new **Sydekyk** — an AI agent that turns documents or
Odoo records into finished ERP work. Hand this to a developer (or an AI coding agent) as the spec.
It captures the architecture and the hard-won lessons from building **Ledger** (vendor-bill encoder),
**Decode** (résumé parser), **Scout** (résumé scorer), **Mirror** (duplicate-bill detector),
**Shield** (fraud-risk detector), and **Nudge** (stale-opportunity follow-up drafter).

**Agent shapes.** Some agents turn an inbound *document* into a record (Ledger, Decode). Others
*analyse existing Odoo records* in batches and flag/score them (Scout, Mirror, Shield) — no upload, a
"Run now" + cron trigger, and a Mission that carries just the record id in `trigger_context`. A third
shape *monitors records for a condition and drafts an action* (Nudge — see §10). Two further shapes
are specified in §12–§13: agents that **draft customer-facing text for human review** (Reply) and
agents that **learn their own config/rubric from won/lost history** (Spark). For the record-analysis
shape reuse `missions.create_mission` (no-doc), and for bill auditors the shared `odoo_finance`
(bill/partner reads, reference normalization, employee cross-refs) + `bill_poll` (scan-forward
watermark poller, ≤5 days, ≤30/run, skips already-analysed via the finding store).
**Ground the facts deterministically; let AI do the judgment.** This is an AI platform — bake real
intelligence into every agent. The pattern for audit-style agents: deterministic checks surface
*grounded candidates/signals* (same reference, shared VAT/bank, a bank change on an unpaid bill — no
hallucinated ids), and the **LLM is the primary judgment layer** that reasons over them plus the full
record context: *is this truly the same purchase billed twice?* *how risky is this bank change given
the vendor's history?* The model renders the verdict/score and the narrative and can surface concerns
the rules missed; a deterministic fallback keeps the agent working if the engine is briefly down.

Every new agent should mirror those three: a self-contained backend package, zero-config discovery,
a grounded AI pipeline, an Odoo write layer, a settings + readiness + insights surface, and a
per-agent frontend registered in one place. **Reuse the shared services — never fork them.**

---

## 1. Define the agent up front

Answer these before writing code:

- **Name & slug** — e.g. `Scout` / `scout`. The slug keys the backend package, the API prefix
  (`/api/tenant/<slug>`), the frontend registry, and the avatar (`frontend/public/sydekyks/<slug>.png`).
- **One-line job** — "scores a résumé against its job position." One agent, one responsibility.
  (We split résumé *parsing* and *scoring* into Decode and Scout rather than one bloated agent.)
- **Triggers** — any of: **Email** (inbound address), **Manual upload** (dropzone), **Cron poll**
  (poll Odoo for unprocessed records), **Run-now** (on-demand batch). Decode = Email + Upload + Cron;
  Scout = Run-now + Cron (it reads records itself, no upload).
- **Odoo footprint** — which model(s) it reads and writes (`account.move`, `hr.applicant`, …), and
  which fields. **Assume nothing about field names** — read them at runtime via `fields_get`.
- **Definition of done** — the record state that means "processed" (a posted bill, a tagged
  applicant), and whether a human ever needs to review (Ledger yes; Scout no — scoring is advisory).
- **Cost-benefit basis** — what one unit of manual work costs (minutes × wage) so the dashboard can
  show "$ saved" and "N encoded in ~T of manual work."

---

## 2. Backend package (mirror `app/sydekyks/ledger/`)

Create `backend/app/sydekyks/<slug>/` with:

| File | Responsibility |
|------|----------------|
| `__init__.py` | Import models/playbook/tools; re-export `router` + `seed`. Importing the package **registers the playbook** and makes it discoverable. |
| `playbook.py` | `PLAYBOOK_KEY = "<slug>.<verb>"`, `PLAYBOOK_STEPS` (list of `{key,title,description,likely_failures}`), `run(db, mission)`, and `register_playbook(PLAYBOOK_KEY, run)` at the bottom. |
| `extraction.py` | The AI calls (classify, extract, map, score). All go through `app.services.vision_ai`; every returned Odoo id/option is **validated against real config**. |
| `models.py` | `<Agent>TenantSettings` (per-tenant config) + `<Agent>Record` (a store of what it produced — powers the dashboard/insights). |
| `schemas.py` | Pydantic in/out for settings, readiness, playbook, insights, run-now. |
| `router.py` | `APIRouter(prefix="/api/tenant/<slug>")` — settings GET/PUT, readiness, playbook, insights, and any trigger endpoints (`/run-now`, `/email-inbox`). |
| `readiness.py` | Computes the setup checklist (Odoo assigned? inbox? AI engine?) → gates uploads/runs. |
| `insights.py` | Dashboard aggregates + `<agent>_activated` (installed check) + savings. |
| `seed.py` | The catalog `Sydekyk` row, flags (`accepts_document_uploads`, `playbook_key`), and gadget requirements (`erp`, optionally `inbox`). |

**Zero-config discovery.** `app/sydekyks/__init__.py` auto-imports each subpackage and collects its
`router` + `seed`. You do **not** touch `main.py`, `migrations/env.py`, or a central registry — just
add the package. `app/models/__init__.py` must import the new models so Alembic/metadata see them.

**Mission engine.** Work is a `Mission`. `create_mission_for_document(...)` (with optional
`trigger_context` JSONB carrying per-trigger data — e.g. `{"odoo_applicant_id": 8, "job_id": 3}`)
creates it; `run_mission(id)` dispatches by `playbook_key` through the registry. Your `run(db,
mission)` drives the Mission to a terminal status and records a `MissionStep` per step via
`record_step(...)`. Always end with a `result_summary` dict — the frontend renders from it.

---

## 3. Odoo integration (`app/services/odoo.py`, `odoo_hr.py`)

- **Connect** via the assigned Gadget Link: `gadget_links.find_assigned_link(db, tenant_id,
  sydekyk_id, role_key="erp")` → `odoo.connect(url, db, user, secret)` → `OdooClient`
  (`execute_kw`, `search_read`, `create`, `fields_get`, `required_fields`).
- **Be version-safe.** Discover field names at runtime: `odoo.fields_get(client, model)`. Find a
  relation field by what it points to, not its name:
  `find_field_by_relation(schema, "hr.recruitment.degree")`. This survives Odoo version differences.
- **Generic helpers already exist** — reuse, don't reinvent: `attach_document`, `read_attachments`,
  `attachment_bytes`, `post_message`, `build_odoo_record_url` (deep link to any record's form view).
- **⚠️ Chatter notes / HTML gotcha.** `message_post(body=...)` over XML-RPC **escapes** an HTML body
  (Odoo runs `plaintext2html` on the non-`Markup` string, so `<p>` shows as literal text). The fix
  lives in `odoo.post_message`: post the note, then **write the html `body` field** on the returned
  `mail.message` (an html-field write preserves tags). Always route notes through `post_message`.
- **Idempotency via tags.** Stamp each processed record with a per-agent tag (`Sydekyks: <Agent>ed`).
  The cron/poll query filters on **tag-absence** (`["categ_ids","not in",[tag_id]]`) so it only ever
  touches unprocessed records — never a full-table scan. Hard-cap the batch (≤30).
- **Scope the query** to what the agent can actually act on (e.g. Scout only scores applicants with a
  `job_id`: add `["job_id","!=",False]`). Archived records are excluded by Odoo's default
  `active_test` — usually what you want.

---

## 4. AI pipeline (`app/services/vision_ai.py`)

- **Text-first, vision-fallback.** `document_to_llm_input(bytes, content_type, max_pages)` returns
  `("text", str)` when the PDF has embedded text (cheap text-only completion) or `("images", [...])`
  for scanned/photo docs. Résumés/bills are usually text PDFs → big token savings.
- **Classify before you act.** First AI step confirms the document is what the agent expects
  ("is this a résumé?"). Reject non-matches with a clear reason — that reason becomes the Mission's
  error and the row's fallback label.
- **⚠️ pdfium is not thread-safe.** Missions run concurrently; two of them opening or rasterizing a
  PDF at the same time crash the whole **process** with a native "access violation". Serialize every
  pdfium call behind one process-wide lock (`app/services/pdfium_lock`). PDF work is milliseconds, so
  this barely dents throughput — the slow LLM call stays outside the lock and fully concurrent.
- **Ground every AI output in real Odoo config.** Never trust an id the model returns. Offer the
  model the actual options (from `fields_get` selections / relation option lists) and **validate the
  reply against the offered set**; drop anything not offered. For mapping that LLMs are bad at
  (matching to exact ids), have the model pick by **name/category** and resolve the id
  deterministically in the playbook (see Decode's skill mapping).
- **Feed the AI the full picture.** For scoring/matching, pass everything HR/Finance configured — e.g.
  Scout reads the job's `description`, `requirements`, `expected_degree`, and `skill_ids` and scores
  against all of them. The Odoo record *is* the rubric; don't add a redundant manual one.
- **Meter every call.** Gate with `usage_guard.check_allowed(...)` (windowed monthly-token +
  rolling-hour GPU caps); record with `mission_ai.emit_usage(...)`. On cap-exceeded, raise a
  `tenant_issues.report_issue(...)` and fail the Mission with `failure_category="quota"`.

---

## 5. Data, migrations, savings

- **Two tables:** `<agent>_tenant_settings` (config: processed-tag name, cron enable + poll limit,
  wage/minutes assumptions) and `<agent>_records` (what it produced — for insights + a future
  learning loop).
- **Migrations are handwritten and idempotent.** Use `migrations.helpers.has_table/has_column/
  has_index` guards so re-running is safe. Number sequentially.
- **Savings** via `app.services.savings.compute(db, tenant_id, sydekyk_id, count=..., minutes_each=...,
  hourly_wage=...)` → `{estimated_manual_cost, ai_cost, estimated_net_savings, ...}`.
- **Speed** via `app.services.savings.processing_seconds(db, tenant_id, sydekyk_id)` — the actual
  wall-clock the agent spent (sum of succeeded-Mission `completed_at − created_at`). The dashboard
  **leads with how fast the agent was**, using the manual-hours equivalent only as contrast:
  *"142 bills encoded in 3 min · ~19 h by hand"* (`processing_seconds` vs `count × minutes_each`).
  Show the AI time first — that's the wow; the manual figure is the payoff.

---

## 6. Frontend (register in one place)

Add an entry to `frontend/src/sydekyks/registry.tsx` — this is the only shared file you touch. Shared
pages (`SydekykDetail`, `MissionList`, `Issues`, `TenantDashboard`) stay generic and read from it:

```ts
<slug>: {
  setupSection: <Agent>SettingsSection,   // readiness + integrations + config
  playbookPanel: <Agent>PlaybookPanel,    // the step list, for transparency
  missionSummary: <Agent>MissionSummary,  // expanded Mission detail
  operationsPanel: <Agent>OperationsSection, // OPTIONAL: "Run now" + Recent Missions (non-upload agents)
  uploadContext: <Agent>UploadContext,    // OPTIONAL: per-upload context (e.g. pick a job)
  domain: "hr",                            // OPTIONAL: tints Mission rows (HR = bluish; accounting = default)
  missionRowLabel: (m) => ({...}),         // verb-led headline for a Mission row (see below)
  reviewNoun: { one: "bill", many: "bills" }, // what a needs-review item is called
}
```

**Mission row headlines lead with a past-tense verb**, not the filename, and read like a sentence
with the key business fields folded in — *"Encoded the bill INV-001 by Northwind · $1,200.00"*,
*"Graded the application of Diego Khan · 78/100"*, *"Parsed the résumé of Jane Doe for Senior Dev"*.
**Vary the verb** from a small pool, picked deterministically off the mission id, so a long list
doesn't read as a wall of the same word. Fall back (muted) to the friendly error / filename when the
Mission produced no business object (queued, running, or rejected as "not a résumé").

Build these components (mirror an existing agent):

- **Settings section** — Readiness checklist (`ReadinessList`), Integrations (`GadgetRequirementList`
  — this is how the Odoo instance gets assigned), agent config, estimated-savings inputs, and (if
  email-triggered) an inbox block that **reads the existing address from readiness** and hides the
  "Create" button once set.
- **Operations panel** (for non-upload agents) — the batch action (`Run now`) **at the top** + a live
  **Recent Missions** list (`MissionList`) that polls while work is active.
- **Dashboard insights card** — renders only when the agent is installed and has data. Lead with a
  small **agent thumbnail** (`AgentThumb slug="<slug>"`, from `/sydekyks/<slug>.png`) + the agent
  name so the value block is instantly recognizable. Show `$ saved` and the **speed line** (AI time
  vs manual contrast) up top. **Then design the body around a decision, not throughput** — ask "what
  would the manager who owns this actually log in to decide or catch?" (see below). Load the `dataviz`
  skill before charting; simple CSS bars/tables (no chart lib) match the house style.

  Two worked examples:
  - **Scout (a scoring/triage agent)** is a *decision cockpit*: **pipeline health by role** (per job:
    scored / strong / avg / top, expandable to a **shortlist** with an *Open in Odoo* link on each
    candidate), the **common gaps & strengths** themes across the pool (the AI-only insight that
    drives JD/sourcing changes), and a score distribution. Resolve each candidate's Odoo deep link
    server-side (`gadget_links.assigned_odoo_base_url` + `odoo_form_url`).
  - **Decode (an intake/parsing agent)** is an *intake monitor*: **applications by position** (where
    interest lands + the size of the unrouted pool), **data-quality tiles** (% captured with email /
    phone / skills / experience — trust in the Odoo data), **seniority mix**, and the top skills in
    the pool.
- **Mission summary** — reads `result_summary` and shows the business object (applicant · position ·
  score), not raw JSON. Put the AI's "why it needs review" narrative on the Mission's `result_summary`
  (not only the Odoo chatter) so the reviewer reads it in-app without opening Odoo.
- **Feedback + readiness (DRY).** One axios response interceptor toasts "Saved" on every settings
  `PUT` — no per-form wiring (`lib/toast`). Changing the AI engine (`llm-config`) or the Odoo
  connection (gadget assignment) gates the agent's readiness, so those also **reload** to re-fetch it.
  And a readiness checklist fetched once must **re-fetch when an in-settings action** (a vision or
  connection test) flips its state — pass a `refreshKey`; don't leave it stale until a manual refresh.
- **Dashboard metrics: money + honesty.** Format value figures as money in the record's currency
  (`formatMoney`), show BOTH what was *caught* (value / exposure) and what was *saved* (time + $), and
  never double-count — e.g. Mirror flags both halves of a duplicate pair, so cluster them and count
  only the avoidable extra copies. **Paginate** action queues (approve/clear) server-side via a keyed
  endpoint (`GET /tenant/<slug>/<queue>?limit=&offset=`) — never render a capped list.

**Progress feedback (popup).** A batch of concurrent Missions surfaces automatically in the global
`ActivityProvider` toast — **one aggregated popup with a progress bar** ("X of N complete · Y
running", then a done/failed summary), not one toast per Mission. You get this for free as long as
run-now/upload create Missions the normal way; nothing agent-specific to build.

---

## 7. Triggers, permissions, concurrency

- **Email:** provision an inbound address (`inbox` gadget requirement); the webhook creates a Mission
  with `trigger_context` from the email.
- **Upload:** the generic `DocumentIntakeSection` dropzone posts to
  `/tenant/sydekyks/{id}/documents`; add an `uploadContext` control if the user must supply context
  (Decode's job picker).
- **Cron + Run-now:** share one routine (e.g. `recruitment_poll.enqueue_untagged_applicants`) — DRY.
  Cron needs `queue_enabled=True` + Redis + the running **arq worker** (`worker.py`, `cron_jobs`).
  Run-now works inline without the worker. Surface the worker requirement in the settings UI.
- **RBAC (enforce on BOTH ends).** Backend: guard config endpoints (settings, gadget assignment,
  recurring/suppression) with `permissions.assert_can_configure`, and action endpoints (run-now,
  retry, decide-on-finding, upload) with `permissions.assert_can_use`. A commander has both; a hero
  is scoped by per-Sydekyk `can_use`/`can_configure` flags. Frontend: the sydekyk endpoint
  (`/tenant/sydekyks/{id}`) returns the requesting user's `can_use`/`can_configure`, and
  `SydekykDetail` gates **run-actions on `canUse`** (operations panel, upload) and **settings/engine
  on `canConfigure`** — so a use-only teammate can actually operate an agent they're granted without
  seeing (server-blocked) config controls. Don't gate the UI on `role === "commander"` alone.
- **Concurrency:** the arq worker runs at its **default `max_jobs = 10`** (not set explicitly). A
  run-now of ≤30 records therefore executes ~10 at a time. If the agent hammers Odoo or an LLM rate
  limit, set an explicit `max_jobs` in `WorkerSettings`.

---

## 8. Verification checklist

1. `alembic upgrade head` runs the new migration(s); re-run `seed` → the catalog row, flags, and
   gadget requirements exist.
2. `discover_sydekyk_packages()` registers the new `<slug>.<verb>` playbook; `collect_routers()`
   includes the new router.
3. Backend imports cleanly; `pytest -q` green. Add tests for: the `PLAYBOOK_STEPS`↔`step_key`
   invariant, AI id/option validation (offer a set, assert hallucinations are dropped), the
   unprocessed-only + ≤30 cap query, and any scoring/banding logic.
4. **Live Odoo research at implementation start (read-only):** `fields_get` the target models on a
   real instance to confirm field/relation shapes before you code against them.
5. **E2E on a real instance:** each trigger produces the right record state + tag + a store row, and a
   re-run **skips** already-tagged records. Confirm chatter notes render as HTML, deep links open the
   record, and metering records a `UsageRecord`.
6. Frontend `npx tsc --noEmit` clean; the dashboard card + Mission rows render only when installed.

---

## 9. Design principles (the lessons)

- **DRY across agents.** Ledger, Decode, and Scout share the Odoo layer, AI plumbing, mission engine,
  metering, savings, and frontend shells. A new agent is mostly *configuration + a playbook*, not new
  infrastructure.
- **Ground the AI in reality.** Read the instance's real fields/options and validate every AI answer
  against them. LLMs are good at *classifying/choosing by name*, bad at *inventing ids*.
- **One responsibility per agent.** Split rather than bloat (parse vs. score).
- **Idempotent by tag.** Process-once via a per-agent tag; query only untagged; cap the batch.
- **Advisory vs. authoritative.** Decide if a human must review. If not (Scout), don't build a review
  workflow — the note + a field write is enough.
- **Version-safe Odoo.** `fields_get` everything; find fields by relation, not name.
- **Surface value.** Every agent shows `$ saved` and throughput so the user sees the payoff.
- **Dashboards drive a decision, not a scoreboard.** Throughput proves the agent works; it isn't why
  a manager logs in. Design the dashboard around the decision the record's owner makes (who to
  interview, which req is starving, is the captured data trustworthy) and surface the insight only an
  AI could produce (aggregated gaps/themes), with a click-through into Odoo to act.
- **Consistent UX via the registry.** Per-agent display (row labels, hue, review noun, panels) lives
  in one registry; shared pages never branch on slug.
- **Common tools are built once, keyed by sydekyk_id.** The review-assignment tool is the model:
  ONE table (`agent_review_assignments`), ONE service (`review_assignment` — `assign_on_flag` +
  `audit_assignees`), ONE router (`/tenant/sydekyks/{id}/reviewers` + `/odoo-users`), and ONE
  frontend component (`ReviewerAssignment`, rendered generically in `SydekykDetail` for every
  workflow agent). Each playbook only adds a single `review_assignment.assign_on_flag(...)` call at
  its flag point (the record model + id it just flagged). A daily worker cron audits the assigned
  Odoo users and raises a Command-Center issue if one was removed/deactivated. When a capability is
  common to all agents, resist per-agent copies — add a shared table/service/router/component keyed
  by `sydekyk_id` and wire agents in with one call.
- **Make review activities ACTIONABLE.** The Odoo activity an agent creates should carry the *why*
  **plus a "What to do" checklist** (`assign_on_flag(..., steps=[...])`) — concrete next steps to fix
  the issue (open both bills and cancel the duplicate; set the missing tax and post; assign the job
  position), not just the reason. A reviewer should be able to resolve it without guessing. Note:
  `mail.activity.note` is an html field, so the steps render as real HTML (unlike chatter's
  `message_post`, which needs the plaintext2html workaround).

## 10. Record-monitoring / sales agents (the Nudge lessons)

Some agents don't parse a document at all — they **watch existing Odoo records for a condition** and
act (Mirror/Shield on bills; **Nudge** on `crm.lead` opportunities). The shape:

- **The cron does the catching (deterministic); the AI does the writing.** Nudge detects staleness
  with plain math (days since last real touch vs a per-stage threshold) — cheap, explainable, no
  tokens. The LLM only *drafts the follow-up*, grounded in the real thread + opp fields, matched to
  the stage. Never spend a model call on something a query can answer.
- **Poll forward, never full-sweep, hard-capped.** A shared poller (`lead_poll` / `bill_poll`) pulls
  a bounded candidate set (open, not-won, untouched-since-cutoff, no *future* scheduled activity),
  enqueues one Mission per record with just the id in `trigger_context`, and caps at 30/run. The
  playbook re-confirms the condition per record (state can change between poll and run).
- **Guard rails prevent nagging.** Three checks *before* acting: a **snooze/whitelist** memory for
  legitimately-paused records (`snooze_until` date = pause until; NULL = never — the "circle back in
  Q3" trap), a **cadence guard** (never act on the same record more than once per M days, keyed off
  the finding store), and an **implicit-handled** signal (a future-dated `mail.activity` means the
  human already planned the next touch — skip). A skipped run still `succeeds` with a `skipped`
  reason on the summary, so the Mission row reads calmly ("Left X alone — paused deal").
- **Don't duplicate what Odoo already tracks.** If an *overdue* `mail.activity` already exists,
  surface it — don't create a second To-Do.
- **Draft, don't send.** For anything that goes to a customer, the agent writes the suggestion to the
  chatter + a To-Do for the record's owner; the human edits and sends. Definition of done = the
  next-touch activity exists + the record is tagged/stored for this cycle so the cron skips it until
  it goes stale again.
- **Rank by value-at-risk.** The queue's sort key is the business stake weighted by how overdue it is
  (`expected_revenue × days_over_ratio`), so the highest-value-at-risk record surfaces first — not
  just the oldest.
- **Coverage as the headline metric.** "Follow-ups never missed" = records acted on / open records
  tracked. The open-total denominator is a live `search_count` **snapshotted during the poll** (stored
  on settings), so the dashboard never hits Odoo on every load.
- **Group the roster by business function.** Each registry entry declares a `functionGroup`
  (`sales | accounting | hr`); the Roster page and Dashboard render Sydekyks grouped Sales ·
  Accounting · HR in one place. Shared pages still never branch on slug.

## 11. Hard-won details (verified live against a CRM-enabled Odoo)

- **Version-safe fields are not optional.** `crm.lead` has **no `currency_id`** on modern Odoo — it's
  `company_currency`; leads and opportunities share one table split by `type` (`lead` vs
  `opportunity` — only ever act on opportunities). Filter every read to the fields the instance
  actually exposes (`fields_get`, cached per client) and resolve model-specific fields (currency,
  etc.) from whichever name exists. A hard-coded field name **will** 500 on some instance.
- **Some Odoo datetime fields are ORM-managed; you cannot backdate them.** `write_date` and
  `create_date` are overwritten on every write — never trust `write_date` as an "engagement" signal
  (a trivial edit or automation bumps it, masking a truly-neglected record). Base staleness on real
  engagement — the latest **chatter/email message** (`mail.message` where `message_type in
  ('comment','email')`) and the last **stage movement** (`date_last_stage_update`, which *is*
  writable, so it's also how you age records for testing). Exclude the agent's own posted notes
  (`notification`/subtype "Note") so it never resets its own clock or feeds itself into the AI thread.
- **The coarse poll filter and the precise playbook check are different on purpose.** The poller uses
  a cheap DB-domain pre-filter; the playbook re-derives the exact condition (including messages the
  domain can't express). Expect some "queued but turned out fine" — surface that honestly.
- **Leave a run receipt even when nothing happened, and account for the WHOLE population.** A "sweep"
  Mission per run carries a disposition of every record (handled / snoozed / recently-acted / queued),
  not just the count it queued — otherwise the user asks "where did the other N go?". Never label
  queued-for-review as "done/drafted": the playbook, running async, decides the real outcome.
- **Pick real records, don't type ids.** Any "choose a record" UI (snooze/whitelist a deal) searches
  live Odoo (`name`/`partner` `ilike`) and returns typed rows; a Refresh button re-runs it after the
  Odoo connection comes up or data changes. Same pattern as the reviewer picker.
- **Money honesty.** A metric labelled in dollars must be real dollars. Keep any urgency-weighted
  score (e.g. `revenue × overdue_ratio`) as an internal **sort key only** — never render it as "$ at
  risk" (a $22.5k deal 20× over a 1-day threshold would read as $450k). "Exposure/at-risk" headlines
  sum the **actual** amount of the still-open (undecided) items, de-duplicated per record.
- **Tenant reporting currency is one setting, applied everywhere.** `Tenant.currency` (ISO-4217,
  default USD; set on the HQ Settings page) is the dashboard's display currency. The frontend reads it
  through one shared `useTenantCurrency()` hook (module-cached, one fetch for all cards, **notifies
  subscribers** so a save updates mounted cards without a reload) + `formatMoneyCompact`/`formatMoney`;
  wage labels render `({currency})`. Don't scatter hard-coded `$`. The rule for WHICH currency to
  show: **rollup headlines and labor-cost savings → the tenant reporting currency** (a sum across
  records is only meaningful in one currency, and figures like wage-based savings have no intrinsic
  one); **an individual record's amount in a review/decision queue → that record's own currency** (a
  reviewer approving a specific bill must see its true currency). Amounts are **not FX-converted** — a
  tenant's Odoo is single-currency and should match this setting; don't fake a conversion by relabeling.
- **Dashboard cards link straight to the agent.** Each insight card header is the shared
  `AgentCardHeader` (thumb + name + kicker + an "Open agent →" smart button via `useSydekykLink`),
  so a manager jumps to the agent's page without detouring through the Roster. One fetch of
  `/tenant/sydekyks` (slug→id) shared across all cards.
- **Deep-link the record from the Mission.** Teach the single shared resolver
  (`gadget_links.mission_generic_record`) about your record model (`crm.lead` → "Open opportunity in
  Odoo") so the "Open in Odoo" link shows on the mission card, its detail, and the Issues review view
  — all three surfaces at once, no per-view wiring.

## 12. Draft-and-review agents — customer-facing text (the Reply design)

When the agent's output is **prose a customer will read** (an email reply, a proposal), drafting is
LLM home turf — but the discipline is everything: **answer only from retrieved Odoo facts, never
invent, and draft-only — never auto-send.** This is §10's "draft, don't send" taken to its strictest.

- **⚠️ Odoo has NO native email-draft store — decide the draft home deliberately.** `mail.compose.message`
  is a *transient* wizard (its records get vacuumed); `mail.mail` states are `outgoing/sent/exception/
  cancel` — a cancelled mail is not a reviewable draft, and parking real `mail.mail` records pre-send
  is dangerous (one bad cron and you've emailed customers). Third-party "save as draft" apps exist
  precisely because core Odoo lacks this. **So the Command Center is the draft store:** the mandated
  `<agent>_records` table *is* it — `subject, body, intent, confidence, facts_sourced, status
  (pending/edited/sent/discarded)`. The rep reviews and edits in our UI (richer than Odoo's composer),
  and **edit-vs-send-as-is is captured for free — that's the learning loop.**
- **Send on approve = one `post_message`.** On approve, `post_message` on the thread with the partner
  as recipient → Odoo emits the outbound email and logs it to chatter as the audit trail. One call,
  works over XML-RPC, and it's the same HTML-safe `post_message` helper (§3). Never write `mail.mail`
  rows yourself.
- **Meet reps where they live (hybrid delivery).** The Command Center is the workbench, **plus a
  `mail.activity` on the Odoo record that deep-links back to the draft** (mirror `build_odoo_record_url`).
  Reps who live in Odoo all day won't check a second app — the activity is the notification, the
  Command Center is where the work happens.
- **Ship the cheap v1 first, prove adoption, then build the workbench.** A near-free v1 is just the
  `mail.activity` + suggested text in the note (rep copy-pastes). Measure adoption, *then* invest in
  the in-app editor. General rule: validate demand before building the richer surface.
- **Answerability tiers, so it never bluffs.** (1) **Classify intent first** (quote / order-status /
  pricing / complaint / general) and route by it; anything out of scope is flagged with a reason, not
  answered. (2) **Grounded retrieval** — pull the exact facts the reply needs (order status from
  `sale.order`, invoice/payment from `account.move`, delivery from `stock.picking`); **every factual
  claim must trace to a read field**, and if the fact isn't in Odoo the draft says "let me confirm"
  rather than inventing. (3) **Confidence tiers**: High (all facts, one clear intent) → full draft
  ready to send; Medium (partial) → draft with the gaps flagged for the rep; Low (out of scope, angry
  customer, refund/legal) → short holding draft + **escalate**, never a substantive answer.
  (4) **Tone-match** the prior thread and the partner's language.
- **The trap: a confident wrong answer or an over-promise.** The failure mode isn't a clumsy sentence
  — it's "your order shipped" when it hasn't, or a commitment the business can't honor. **Hard rule:
  no claim that isn't grounded in a read Odoo field; anything touching money / refunds / discounts /
  legal auto-escalates instead of drafting** (Reply's version of Shield's "flag, never accuse").
- **Done / metric.** Done = a draft in `<agent>_records` + a `mail.activity`, and the inbound message
  tagged handled so cron doesn't re-draft it. Metric "faster replies" = median inbound-to-draft time;
  savings = replies drafted × minutes-per-manual-reply × wage.

## 13. Config-learning agents — learn the rubric from history (the Spark design)

Some agents shouldn't be *told* their rubric — they should **derive it from the tenant's own outcome
history** (won/lost deals, resolved tickets). This is §4's "the Odoo record is the rubric; don't add a
redundant manual one" applied to the agent's *configuration itself*.

- **Defer to native features; add only the AI-only layer.** Check what Odoo already computes (e.g. it
  ships predictive lead scoring) and **don't re-implement the number-cruncher.** The differentiation is
  LLM **reasoning over free text** the native scorer can't read (buying signals, decision-maker
  language, competitor mentions) plus the learning loop below.
- **Split the hot path from the learning path — it's what preserves "one agent, one thing."** Per-record
  scoring runs every poll (fast, cheap, reads config). Deriving the config runs as a **separate
  periodic cron** (monthly/quarterly). The learning step produces a **proposal a human approves**
  before it writes to tenant settings; the hot path only ever reads approved config.
- **Learn from won AND lost — never won-only** (survivorship bias: you'd learn "who we sold to," not
  "who's worth pursuing"). `lost_reason_id` is gold you already have — "no budget" vs "price" vs "chose
  competitor" are different rules. **Weight by deal quality, not just win/loss** (`expected_revenue`,
  cycle length from `create_date → date_closed`, and downstream payment/churn if you can reach
  `account.move`), and use channel (`source_id / medium_id / campaign_id`) — often the single most
  predictive feature.
- **⚠️ The self-reinforcement trap (applies to ANY agent whose output shapes the data it later learns
  from).** Score → reps work only the hot ones → only those close → config derives from those closes →
  the profile narrows forever, *looking great on every metric* while quietly blinding you to a whole
  segment. Three cheap mitigations: **(1)** seed the initial profile from the **pre-agent historical
  baseline**; **(2)** track the **false-negative that succeeded anyway** (a lead scored cold that won)
  as a **first-class bias-alarm metric**; **(3)** optionally route a small **random control sample**
  regardless of score.
- **Cold start.** Below a minimum sample (~20–30 outcomes) don't trust the derived config — fall back
  to the configured default and **say so in the UI.**
- **Don't hard-gate on a single field; score holistically and always attach the reason.** A free-email
  address isn't disqualifying (solo founders buy); a polished form can be spam. The reason is what lets
  a human override — and feeds the learning loop.
- **⚠️ Field safety / degrade gracefully.** Don't assume enrichment fields exist — stock Odoo has
  `industry_id` and `country_id`, but headcount/revenue only exist with Partner Autocomplete.
  `fields_get` first and skip cleanly what's absent.
- **The killer dashboard is "stated vs actual".** The AI-only insight that changes a decision on
  Monday: *"You say you target enterprise manufacturing. You actually win mid-market logistics, from
  referrals, in 6 weeks — enterprise takes 5 months and you lose 80% on price."* Pair it with the
  false-cold bias alarm and the ranked list deep-linked into Odoo. This is §9's "dashboards drive a
  decision, not a scoreboard" at its peak — often more valuable than the per-record scores themselves.

## 14. Interactive-workbench agents — a human authors WITH the AI (the Quill design)

Most agents run headless (cron/upload → record). **Quill** (proposal generator) is the first
*interactive workbench*: a rep drives a full-page editor, the AI drafts and co-edits, and the human
ships the result. It still lives inside the platform (a package + registry entry + missions +
metering), but it breaks a few defaults on purpose. The patterns, so the next document-generation
agent (a contract/SOW writer, a report builder) reuses them:

- **A full-page route is the escape hatch from the `SydekykDetail` shell.** Settings/operations still
  render in the shared detail page via the registry (`operationsPanel` is the entry point — "New
  proposal" → navigate), but the editor itself is its own route (`/hq/<slug>/editor/:id`,
  `frontend/src/pages/QuillEditor.tsx`, registered in `App.tsx`). Don't try to cram a workbench into a
  settings panel.
- **The rich editor is a shared, generic component, not agent-specific.** `components/RichDocEditor.tsx`
  (TipTap, HTML in/out, image insert) has one consumer today but is deliberately reusable — the
  platform's "build the generic thing once, wire one consumer" rule (§9). Editor content is HTML;
  Markdown templates convert on the way in (`marked`).
- **Every AI turn is still a Mission — even the interactive ones.** Both `quill.draft` (generate) and
  `quill.refine` (the "Ask Quill" chat that rewrites the work-in-progress) are playbooks run **inline**
  from the router (`run_mission(mid)` synchronously, then re-read the mutated row) so the editor gets
  its result immediately, while metering (`usage_guard.check_allowed` + `mission_ai.emit_usage`), the
  activity feed, and savings all work unchanged. A package can `register_playbook` **more than one**
  key; the catalog's `playbook_key` is just the primary. Refine missions render as muted revision rows.
- **Token tracking is a product surface, not just billing.** Generative agents are far more
  token-hungry than classifiers (long content in *and* out every turn). Copy each turn's token counts
  (from its `UsageRecord`) onto a per-document chat store (`quill_chat_messages`) so the editor shows a
  **live per-document token + cost badge**; lead the dashboard card with tokens/AI-cost. A `usage_guard`
  denial becomes a **429** the UI toasts, pausing the chat until the window frees.
- **⚠️ An `<img>` can't send the bearer token.** Serving user images from an auth-gated
  `/assets/{id}` route 401s inside the editor. Return the uploaded image as a **data URI** and embed
  that (TipTap `Image.configure({ allowBase64: true })`) — it renders in the editor *and* in the PDF
  with no auth dance. Keep the bytes in a `<agent>_assets` table (mirroring the `document_storage`
  boundary) for the record/logo reuse.
- **HTML→PDF is WeasyPrint + pypdf, imported lazily.** `sydekyks/quill/pdf.py` wraps the fragment in a
  branded print stylesheet and renders server-side (crisp vector text). Do the heavy/native import
  *inside* the function so package discovery never needs pango/cairo present — only an export call
  does; a missing lib is a clean 501, not an import crash. **WeasyPrint needs system libs**
  (pango/cairo/gdk-pixbuf) in the backend image — the one real ops step. `pypdf` merges the proposal
  with the official Odoo quotation PDF.
- **Odoo stays optional and best-effort.** Quill is the first `sale.order` integration
  (`services/odoo_sales.py`, reusable): create **draft** quotations only (never confirm), add free-text
  lines best-effort (a stock `sale.order.line` may require a product — skip a rejected line rather than
  fail the quotation), and `fetch_quotation_pdf` degrades to `None` on any version/marshalling snag so
  the merge falls back to proposal-only. The `erp` gadget requirement is `is_required=False` — the
  agent is fully usable with no Odoo at all. Teach `gadget_links.mission_generic_record` the new model
  (`sale.order` → "Open quotation in Odoo").
- **Draft, never send** still holds (§12): Quill produces a document and (optionally) a draft
  quotation + a PDF attached back to it; the human reviews and sends.
- **Per-record ownership scoping rides on the existing RBAC — no new flag.** A workbench full of
  user-authored documents needs "salespeople see their own, managers see all." Map it onto the two
  grants you already have: `can_configure` (or Commander) = manager → sees/edits every proposal in the
  HQ; plain `can_use` = author → scoped to `created_by == user.email`. Enforce it in ONE helper the
  list query and the single-record fetch both call (`_proposal_or_404` checks tenant **and** ownership;
  the list adds a `created_by` filter), and return a `sees_all` flag so the UI can label the list and
  show the owner column. Resist adding a third permission flag unless a real "view-all-but-not-config"
  role is needed — it's a cross-cutting schema + Team-UI change.
- **The shared "Review Assignment" panel is for flag-based agents only.** `SydekykDetail` renders it
  for every workflow agent; an authoring agent that never auto-flags opts out with a registry flag
  (`hideReviewerAssignment: true`) rather than the shared page branching on slug.
- **Keep settings for what's global; per-run choices live at the point of use.** PDF branding (page
  size, accent, footer line) and savings assumptions belong in settings; per-proposal Odoo actions
  (create quotation, merge, attach) are buttons in the editor, NOT global default toggles — a default
  that silently mutates an external system on every export is a footgun.
- **Editor niceties are TipTap extensions + inline styles that survive to PDF.** Text alignment
  (`@tiptap/extension-text-align`) and image width (an `Image.extend` with a `width` attribute rendered
  as an inline `style`) both serialize into the stored HTML as inline styles, so WeasyPrint honors them
  on export with zero extra work. Page numbers + a footer line come from CSS `@page` margin boxes
  (`@bottom-right { content: "Page " counter(page) ... }`).
