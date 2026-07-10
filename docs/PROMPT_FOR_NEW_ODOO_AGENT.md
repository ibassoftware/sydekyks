# Prompt for a New Odoo Agent (Sydekyk)

A working brief for designing and building a new **Sydekyk** — an AI agent that turns documents or
Odoo records into finished ERP work. Hand this to a developer (or an AI coding agent) as the spec.
It captures the architecture and the hard-won lessons from building **Ledger** (vendor-bill encoder),
**Decode** (résumé parser), **Scout** (résumé scorer), **Mirror** (duplicate-bill detector), and
**Shield** (fraud-risk detector).

**Two agent shapes.** Some agents turn an inbound *document* into a record (Ledger, Decode). Others
*analyse existing Odoo records* in batches and flag/score them (Scout, Mirror, Shield) — no upload, a
"Run now" + cron trigger, and a Mission that carries just the record id in `trigger_context`. For the
record-analysis shape reuse `missions.create_mission` (no-doc), and for bill auditors the shared
`odoo_finance` (bill/partner reads, reference normalization, employee cross-refs) + `bill_poll`
(scan-forward watermark poller, ≤5 days, ≤30/run, skips already-analysed via the finding store).
Mostly-deterministic agents (Mirror's tiers, Shield's rules) keep the LLM **optional** — used only
where judgement is needed (line-item semantic match; the advisory "warrants review" narrative).

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
  score), not raw JSON.

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
- **RBAC:** guard config with `permissions.assert_can_configure`, actions with
  `permissions.assert_can_use`.
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
