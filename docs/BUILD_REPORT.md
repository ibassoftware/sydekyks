# Sydekyks — Build Report

_As-built architecture review of the system constructed to date. Audience: senior engineer / architect. This is not end-user documentation — it explains what exists, why it's shaped the way it is, and where the sharp edges are._

---

## 1. System overview

Sydekyks is a multi-tenant SaaS where each tenant ("**HQ**") activates AI agents ("**Sydekyks**"). Some Sydekyks are shared across all tenants ("**Roster**"), some are exclusive to one HQ. A Sydekyk can be chat-mode, workflow-mode, or both. The first real workflow Sydekyk — **Ledger** — ingests vendor bills (PDF/image) and files them into the tenant's Odoo.

**Stack:** FastAPI + SQLAlchemy 2.0 (Postgres/pgvector) backend; React 19 + Vite + Tailwind v4 (TypeScript) frontend; a **LiteLLM Proxy** as the AI gateway; Odoo via XML-RPC as the first external integration. Auth is email/password + JWT.

**Themed vocabulary** (product-facing name → technical concept). Underlying tables/code use plain names; the UI uses the theme:

| Themed | Technical |
|---|---|
| HQ | tenant |
| Commander / Hero | tenant admin user / regular user (roles) |
| Sydekyk | AI agent (`sydekyks` table) |
| Roster / Exclusive Sydekyk | shared (`tenant_id` null) vs. tenant-owned |
| Gadget / Gadget Link | integration type / a tenant's connected instance |
| Power Core | the Sydekyks-hosted LLM tier |
| Power Meter | per-HQ LLM spend tracking |
| Mission | one execution of a Sydekyk's workflow (with a step audit trail) |
| Playbook | the ordered steps a workflow Sydekyk runs |

**Request flow (workflow):** Commander uploads bills (or emails them) → FastAPI creates a `Mission` per bill and schedules a `BackgroundTask` → the Mission's registered playbook runs (extract via the tenant's assigned LLM engine → act on the tenant's assigned Odoo) → each step is persisted to `mission_steps` → the frontend polls the Mission for status/results.

---

## 2. Data model

Grouped by subsystem. All tenant-scoped tables carry `tenant_id`; isolation is enforced at the app layer (see §3).

**Tenancy / auth**
- `tenants` (HQ), `users` (role: `super_admin` | `commander` | `hero`).

**Sydekyk catalog**
- `sydekyks` — catalog entry. Notable columns added this build: `accepts_document_uploads` (generic capability flag gating the intake UI) and `playbook_key` (dispatch key → registered playbook; never an `if slug ==` check).
- `sydekyk_installs` — which tenant installed which Roster Sydekyk.

**Gadgets (integrations)**
- `gadgets` — catalog of integration *types*. `type` (`built_in`|`external`) is orthogonal to the new `category` (`erp`|`email`|…). Seeded: Odoo (`erp`), Email Inbox (`email`).
- `tenant_gadget_links` — a tenant's connected instance. Originally Odoo-shaped (`url`/`database`/`username`/`encrypted_secret`). **Design decision:** rather than a sibling table per Gadget type, these columns became nullable and a `config` JSONB column was added. The email type stores `{provider, inbound_local_part, inbound_domain}` in `config` and reuses `encrypted_secret` for its webhook secret. Rationale: a sibling table would force `TenantSydekykGadgetAssignment.gadget_link_id` to be polymorphic (FK to N tables) — awkward in Postgres — and would duplicate the identical `status`/`last_tested_at` lifecycle. Precedent already existed (`TenantSydekykLLMConfig.model` is null for Power Core). A unique partial index on `config->>'inbound_local_part'` routes inbound email.

**Generic Sydekyk↔Gadget assignment** (new; mirrors the LLM-engine-assignment pattern)
- `sydekyk_gadget_requirements` — a Sydekyk declares "I need a Gadget of category X for role Y" (`role_key`, `gadget_category`, `is_required`). Populated per-Sydekyk by that Sydekyk's own seed.
- `tenant_sydekyk_gadget_assignments` — a tenant's chosen `TenantGadgetLink` satisfying a requirement. Unique `(tenant_id, requirement_id)`.

**LLM engine assignment** (built previously)
- `tenant_provider_credentials` — a tenant's BYOK keys (multiple providers).
- `central_provider_keys` — keys Sydekyks holds centrally, backing Power Core.
- `sydekyk_hosted_assignment` — admin's global per-Sydekyk Power Core provider/model.
- `tenant_sydekyk_llm_config` — each tenant's chosen engine per Sydekyk (Power Core or a BYOK provider+model). Holds the LiteLLM `model_alias` + encrypted virtual key.
- `tenant_sydekyk_usage_snapshot` — cached spend per (tenant, Sydekyk). **Only Power Core usage is metered** — BYOK spend is the tenant's own affair.

**Mission engine** (new; generic)
- `missions` — one run. `status` (`queued`|`running`|`succeeded`|`failed`) is deliberately minimal and Sydekyk-agnostic; playbook-specific nuance ("duplicate", "needs_review") lives in `result_summary` (JSONB), not the enum. `signal_type` records how it started (`manual_upload`|`email`|…). `playbook_key` copied from the Sydekyk.
- `mission_steps` — ordered audit trail; each step has `input`/`output` JSONB.
- `mission_documents` — the uploaded bill. **Storage decision: bytes live in Postgres (`bytea`)** for v1, with a `storage_backend` discriminator reserved for a future S3 move. Rationale: the backend isn't containerized with a persistent volume, volume is low (small bills), and it keeps document + Mission creation atomic in one transaction. Explicitly a v1 choice.

**Ledger-specific**
- `ledger_tenant_settings` — `auto_create_partner`, `auto_post_threshold`. Owned entirely inside Ledger's package (not the generic assignment system — this is Ledger's own business config).

---

## 3. Backend architecture

**Layering:** `models/` (SQLAlchemy) → `schemas/` (Pydantic) → `services/` (business logic, external calls) → `routers/` (HTTP, dependency-injected auth + db).

**Tenant isolation:** every tenant-facing query is scoped by `user.tenant_id`, resolved from the JWT via `require_tenant_member` / `require_commander` / `require_super_admin` dependencies. Cross-tenant access returns **404, not 403** (never confirm existence of another tenant's resource). The background task (`run_mission`) re-verifies `mission.tenant_id` against the Gadget Link's `tenant_id` before any external call — it never trusts an in-memory reference carried across the request/background boundary.

**Secrets:** all provider keys, Odoo passwords, virtual keys, and email webhook secrets are encrypted at rest via `core/crypto.py` (Fernet, key from `settings.encryption_key`). Nothing sensitive is returned to the frontend (`has_api_key: bool`, `inbound_address` derived, etc.).

**The three "generic infrastructure" pillars** (each usable by any future Sydekyk; Ledger is just the first consumer of all three):
1. **Gadget assignment** — a Sydekyk declares Gadget requirements; a tenant assigns links.
2. **LLM engine assignment** — a Sydekyk gets an engine per tenant, routed through LiteLLM.
3. **Mission engine** — generic run/step/document records + a playbook registry + `BackgroundTasks` execution.

**Error-handling convention:** external-service wrappers return `(ok, message[, data])` tuples (Odoo, LiteLLM), consumed directly into `status`/`last_test_error` fields. `run_mission` is the one top-level guard that converts any uncaught exception into `status="failed"` with a surfaced message.

---

## 4. Sydekyk extension architecture (new pillar)

The goal: a partner (future) — or us (now) — can add a Sydekyk by adding **one folder**, touching no shared/core files.

**Structure:** `backend/app/sydekyks/<slug>/` is a self-contained package — `playbook.py` (the runner, registered), `tools.py` (LLM-callable tools; empty for Ledger v1), `models.py` / `schemas.py` / `router.py` (the Sydekyk's own settings), `seed.py`, plus its business logic modules.

**Discovery** (`app/sydekyks/__init__.py`): `discover_sydekyk_packages()` imports every subpackage once. That import runs each package's registration side-effects and its `models.py` (so SQLAlchemy metadata sees its tables before `create_all`). `collect_routers()` / `collect_seed_functions()` gather each package's `router` and `seed(db)`. Discovery is invoked from exactly three places, none of which change as Sydekyks are added:
- `services/missions.py` (lazily, so playbooks are registered before any Mission runs — lazy to avoid the circular import, since a Sydekyk package imports `missions`),
- `main.py` (a loop mounting discovered routers),
- `seed.py` (a loop running discovered seeds, after `create_all`).

**Playbook vs. Tool** (a real distinction): a **playbook step** is a deterministic action our code orchestrates (Ledger's whole pipeline). A **tool** is a function the LLM itself decides to call mid-run (`tool_calls`) — relevant for future agentic Sydekyks, and typically a thin wrapper over a Gadget call. Both have registries; Ledger uses only the playbook one.

**"Platform" vs. "Sydekyk-owned":** the catalog models, Gadget/LLM/Mission systems, and generic routers are platform (a Sydekyk populates *rows*, never owns those tables). Only a Sydekyk's own business logic, settings tables, router, and seed live in its folder. Verified concretely: adding Ledger required **zero** edits to `main.py`'s route list, `seed.py`'s seed functions, or the Mission engine's dispatch — beyond the one-time discovery wiring.

**Not built (deliberately deferred):** external package installation, a manifest format, versioning, and a security/sandbox boundary for untrusted third-party code. The internal convention is in place; the partner-facing productization is YAGNI until a partner program exists.

---

## 5. Infrastructure

**Containerized** (`docker-compose.yml`): `postgres` (app DB, pgvector), `litellm-postgres` (LiteLLM's own DB), `litellm-proxy` (the AI gateway). Backend and frontend run **directly** (`uvicorn`, `npm run dev`) — not yet containerized; this is why v1 avoids local-disk file storage.

**LiteLLM Proxy role:** the single egress for all LLM calls. Per tenant+Sydekyk we register a model (`/model/new`) and mint a scoped **virtual key** (`/key/generate`); chat/vision calls go through the proxy with that virtual key, which enforces the model scope and tracks spend (`/key/info`). This is what makes "usage always tracked for Power Core" structural rather than bolted on, and keeps real provider keys out of the request hot path (only the proxy holds them / the tenant's encrypted key is decrypted momentarily at registration).

**No migration tool.** Schema changes are `Base.metadata.create_all` for new tables, plus hand-run `ALTER TABLE` via `docker exec … psql` for changes to existing tables. The exact ALTERs for this build are in the plan file and were applied to the dev DB.

---

## 6. Frontend architecture

React 19 + Vite + Tailwind v4, TypeScript. **No TanStack Query / Redux** — plain `useState`/`useEffect` + an axios instance (`lib/api.ts`) with a JWT bearer interceptor, and hand-written response interfaces. Polling (e.g. Mission status) is a plain `setInterval` while work is in flight.

Shared primitives in `components/ui.tsx` (`Button`, `Card`, `Input`, `Label`, `Badge`, `Modal`, `PageShell`). New generic components this build: `FileDropZone`, `DocumentIntakeSection` (upload + Mission list + step viewer + a generic `result_summary` fallback renderer so any future playbook works with zero frontend changes), `GadgetRequirementList`. The single sanctioned Sydekyk-specific component is `LedgerMissionSummary` (a `result_summary` shape is inherently playbook-specific). Sections mount in the existing Roster detail modal gated on generic flags (`accepts_document_uploads`), with the one Ledger-only section gated on `slug === "ledger"`.

Theme: dark ink/gold ("heroic") palette; role-gated routes via `ProtectedRoute`.

---

## 7. Known limitations / deferred work / tech debt

- **No background worker.** Mission execution uses FastAPI `BackgroundTasks` (in-process, post-response). Fine for current volume; a real queue (Celery/RQ/arq) is needed for retries, scheduling, and horizontal scale. No retry policy on failed steps.
- **Document bytes in Postgres `bytea`**, not S3/MinIO. Deliberate v1 choice; migrate before meaningful volume.
- **No rate-limiting** anywhere — notably the public email webhook (app-wide Basic Auth + fail-closed inbound-address lookup is the only gate). A per-tenant token bucket is a reasonable stopgap.
- **Power Meter has no automatic quota reset**; admin adjusts manually.
- **Anthropic model list is a static maintained constant** (no reliable public list-models endpoint verified). Ollama Cloud's exact API shape (`ollama/` vs `openai/` prefix) is assumed and needs verification against a real account.
- **Vision-model requirement is enforced at runtime, not validated at assignment.** If a tenant points Ledger at a non-vision model, extraction fails with a clear "assign a vision-capable model" message rather than being blocked up front (chosen to avoid a brittle per-model capability registry).
- **Odoo:** the field set for `account.move` creation was verified against a live **Odoo 19 Enterprise** instance (`ref`, `partner_id`, `invoice_date`, `invoice_line_ids`; `action_post`). Custom Odoo modules can add required fields — Ledger handles this by introspecting `fields_get` on create failure and reporting the unmet required fields into the Mission for human review, rather than failing opaquely. Still, real-world Odoo variance (localization, taxes, fiscal positions) will need iteration.
- **Email ingestion** depends on Postmark account + DNS + webhook config — a deployment-time step outside the code. Email Gadget Links have no synchronous "test connection" (a "send yourself a test email" flow is a sensible follow-up).
- **Extension architecture is internal-only** (see §4) — no partner packaging/sandboxing yet.

---

## 8. What Ledger adds (the first real workflow Sydekyk)

Ledger lives entirely in `app/sydekyks/ledger/`. Its pipeline (each step recorded to `mission_steps`):

1. **Extract** — a vision chat-completion through the tenant's assigned LLM engine (via its LiteLLM virtual key), prompted for strict JSON (vendor, invoice number, date, line items, totals, self-reported confidence). Unparseable output is preserved in the step's `output` for debugging.
2. **Vendor** — `res.partner` fuzzy lookup; create if missing (gated by `auto_create_partner`), else stop as `needs_review`.
3. **Duplicate** — vendor + invoice-number exact match, else vendor + amount proximity fallback; flags in our UI only, never writes a flag into Odoo.
4. **Account** — infers the expense account from the vendor's prior `account.move.line` history; falls back to a default account (and lowers confidence).
5. **Create** — `account.move` (`move_type=in_invoice`) with a hero-toned narration note stamping Ledger's attribution + confidence.
6. **Post** — auto-posts (`action_post`) iff blended confidence ≥ the tenant's `auto_post_threshold`; otherwise leaves it as a draft.

**Confidence** blends the model's self-report with deterministic penalties (partner auto-created, account guessed, duplicate inconclusive) — Ledger's own tunable heuristic.

**Ingestion** is provider-agnostic: web drag-and-drop and the Postmark inbound-email webhook both converge on the same `create_mission_for_document(...)`.

**Verification status:** the Odoo half was exercised end-to-end with production code against the live Odoo 19 instance (partner created, expense account inferred, bill created and posted — `BILL/2026/07/0002`). The async pipeline was verified via both web upload and the Postmark webhook (Missions created, background execution, full step trail, fail-closed on bad webhook auth). The **only** unverified seam is a real vision model returning good JSON — it requires a real provider API key (none was available during the build; the pipeline correctly reports the graceful "assign a vision-capable model" failure with the placeholder key). Plug a real key into a tenant's Ledger engine to close that loop.
