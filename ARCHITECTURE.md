# Sydekyks — Architecture Overview

## 1. What we're building

Sydekyks is a multi-tenant SaaS where each tenant ("HQ") activates AI "Sydekyks" — some shared across all tenants, some built exclusively for one tenant by the Sydekyks team. Visual theme: heroic dark (black/brown) with gold accents, premium feel.

A Sydekyk is not limited to being a chat agent. Each Sydekyk independently supports one or both modes:

- **Chat mode** — conversational agent a Hero talks to directly (as described throughout this doc as "Missions").
- **Workflow mode** — an AI-powered automated process ("Playbook") that runs a defined sequence of steps without needing a back-and-forth conversation, triggered manually, on a schedule, or by an external event.

A single Sydekyk can be chat-only, workflow-only, or both — the two capabilities are independent and share the same underlying config (model, knowledge/Intel, Gadgets) where applicable.

## 2. Tech stack

| Layer | Choice |
|---|---|
| Frontend | React (Vite SPA) + Tailwind CSS + shadcn/ui |
| Backend | FastAPI |
| Database | PostgreSQL (+ pgvector extension) |
| AI Gateway | LiteLLM Proxy (separate service) |
| File storage | S3-compatible object storage |
| Auth | Email/password + JWT (access + refresh tokens) |
| Billing | Subscription + usage overage (metered) |
| Deployment | Docker containers, single cloud provider (TBD), no Kubernetes for now |

## 3. Themed domain vocabulary

Product/UI-facing names use the sydekyk theme; underlying DB tables and code use plain technical names (`tenants`, `users`, `conversations`, etc.) for clarity. Mapping:

| Technical concept | Themed name | Meaning |
|---|---|---|
| Tenant / customer org | **HQ** | A company's workspace |
| Tenant owner/admin role | **Commander** | Manages HQ's roster, billing, team |
| Employee / end user | **Hero** | Person chatting with sydekyks |
| AI agent | **Sydekyk** | Core product entity |
| Sydekyk available to every HQ | **Roster Sydekyk** | Shared catalog, built by Sydekyks |
| Sydekyk exclusive to one HQ | **Exclusive Sydekyk** | Custom-built by Sydekyks for that tenant only |
| Chat session or workflow run | **Mission** | One execution instance with a sydekyk — a chat thread if chat mode, a Playbook run if workflow mode |
| Workflow definition | **Playbook** | Ordered steps a workflow-mode sydekyk executes |
| What kicks off a Playbook run | **Signal** | Manual, scheduled, or event/webhook trigger — evokes the Bat-Signal |
| Knowledge doc feeding a sydekyk | **Intel** | Uploaded files powering RAG |
| Tool/function a sydekyk can call | **Gadget** | Built-in capability or external integration |
| Per-tenant external integration | **Gadget Link** | OAuth/API-key connection to tenant's CRM/helpdesk/etc. |
| Usage/spend tracking | **Power Meter** | Per-HQ token usage and cost tracking |

Adjust/rename freely — this is a first pass to keep the doc and future naming consistent.

## 4. Multi-tenancy model

- **Shared database, shared schema.** Every tenant-scoped table carries a `tenant_id` (HQ id) foreign key.
- All queries are filtered by `tenant_id` at the application layer (a FastAPI dependency injects the current HQ's id from the authenticated JWT into every query).
- Postgres Row-Level Security (RLS) can be layered on later as defense-in-depth without changing the app-level model.
- Roster Sydekyks (shared) live in tenant-agnostic tables; Exclusive Sydekyks carry a `tenant_id`.

## 5. Core data model (high level)

```
tenants (HQ)
  id, name, slug, plan, subscription_status, created_at

users (Heroes)
  id, tenant_id, email, hashed_password, role (commander|hero), created_at

sydekyks
  id, tenant_id (nullable = Roster/shared), name, avatar_url,
  system_prompt, model, temperature, is_exclusive,
  chat_enabled, workflow_enabled, created_at

sydekyk_knowledge (Intel)
  id, sydekyk_id, source_file_url, chunk_text, embedding (vector), created_at

gadgets
  id, name, type (built_in|external), schema (tool-call spec), created_at

tenant_gadget_links (Gadget Links)
  id, tenant_id, gadget_id, encrypted_credentials, status, created_at

playbooks (workflow definitions, only for workflow_enabled sydekyks)
  id, sydekyk_id, name, input_schema, steps (ordered JSON list), created_at
  -- v1: linear ordered steps only (LLM call | gadget call | wait).
  -- Branching/DAG structure deferred, see section 16.

playbook_signals (triggers)
  id, playbook_id, type (manual|scheduled|event),
  schedule_cron (nullable), webhook_secret (nullable), enabled, created_at

missions (chat conversations AND workflow runs)
  id, tenant_id, user_id, sydekyk_id, mode (chat|workflow_run),
  signal_id (nullable, set when mode=workflow_run), status, created_at

messages (mode=chat missions)
  id, mission_id, role (user|assistant|tool), content, token_count, created_at

mission_steps (mode=workflow_run missions)
  id, mission_id, playbook_step_index, step_type (llm_call|gadget_call|wait),
  input, output, status, started_at, completed_at

usage_records (Power Meter)
  id, tenant_id, mission_id, model, prompt_tokens, completion_tokens, cost, created_at

subscriptions
  id, tenant_id, plan, stripe_customer_id, stripe_subscription_id,
  included_quota, billing_period_start, billing_period_end
```

## 6. Auth & authorization

- FastAPI issues short-lived **access JWTs** + long-lived **refresh tokens** on login.
- JWT payload carries `user_id`, `tenant_id`, and `role` (`commander` / `hero`).
- A shared FastAPI dependency resolves the current tenant + user on every request and scopes all DB queries accordingly.
- Roles: **Commander** (manage HQ settings, billing, invite/remove Heroes, view Power Meter) vs **Hero** (chat with assigned sydekyks only).
- SSO (SAML/OIDC) is not in scope for v1 but the JWT-based model doesn't block adding it later as an alternate login path.

## 7. AI / LLM layer

**LiteLLM Proxy** runs as its own service between FastAPI and model providers (OpenAI, Anthropic, etc.):

- Each tenant gets a **virtual key** in LiteLLM, enabling per-HQ budget limits, rate limits, and usage tracking without touching provider keys directly.
- Model selection per sydekyk (`sydekyks.model`) is passed straight through to LiteLLM, which routes to the right provider.
- Provider fallback (e.g. Anthropic → OpenAI on outage) is configured in LiteLLM, not in application code.
- FastAPI never talks to OpenAI/Anthropic directly — always through the proxy.

**RAG pipeline (Intel):**

1. Commander uploads a file for a sydekyk → stored in object storage.
2. Background job extracts text, chunks it, generates embeddings (via LiteLLM), stores chunks + `vector` column in `sydekyk_knowledge` (pgvector).
3. On each Mission message, FastAPI runs a similarity search (`pgvector` cosine distance) scoped to that sydekyk's Intel, injects top-k chunks into the prompt sent to LiteLLM.

**Tool calling (Gadgets):**

- A small built-in set of Gadgets ships in the codebase (e.g. web search, calculator, date/time).
- Tenants can additionally connect their own systems (CRM, helpdesk, Slack) as **Gadget Links** — credentials stored encrypted, scoped to `tenant_id`.
- FastAPI maintains a tool registry; when a sydekyk's LLM response includes a tool call, FastAPI executes the corresponding Gadget (built-in function or authenticated call to the tenant's external system) and returns the result to LiteLLM to continue the completion.
- Each Gadget declares which tenants/roles may invoke it — external Gadget Links are opt-in per HQ.

## 8. Workflow engine (Playbooks)

Workflow-mode sydekyks run a **Playbook**: an ordered list of steps (v1 is linear only — see section 16). Each step is one of:

- **LLM call** — a prompt (optionally with RAG lookup against the sydekyk's Intel) sent through LiteLLM.
- **Gadget call** — invokes a built-in or tenant-linked Gadget, same registry used by chat mode.
- **Wait** — a delay or a wait-for-external-event pause point.

Because a Playbook run can be long-running (minutes, or waiting on an external event) it does **not** run inline on the request thread like chat does — it's picked up by a background worker:

- A **Signal** fires (manual click, cron schedule, or inbound webhook) → a `missions` row is created with `mode=workflow_run` and enqueued.
- A worker process executes each step in order, writing a `mission_steps` row per step (status, input, output, timestamps) as it goes — this is the workflow's audit trail, parallel to `messages` for chat.
- Step failures mark the Mission `status=failed` and stop execution (retry policy TBD); step outputs can feed into subsequent steps' inputs.
- On completion, the Hero/Commander is notified in-app (and, for event-triggered Playbooks, optionally via a callback/webhook back to the originating system).

Scheduled and event Signals require two new pieces of infrastructure (see section 14): a **scheduler** to fire cron-based Signals, and a **per-tenant webhook receiver endpoint** to accept event-based Signals.

## 9. Chat request flow

```
Hero (React SPA)
  │  POST /missions/{id}/messages
  ▼
FastAPI
  │  1. Resolve tenant/user from JWT
  │  2. Load sydekyk config (system prompt, model, gadgets)
  │  3. RAG lookup against sydekyk_knowledge (pgvector)
  │  4. Build prompt, call LiteLLM Proxy (streaming)
  ▼
LiteLLM Proxy
  │  Applies tenant virtual key, budget check, routes to provider
  ▼
Model Provider (OpenAI/Anthropic/etc.)
  │  Streams tokens back
  ▼
FastAPI  →  Server-Sent Events (SSE)  →  React SPA renders tokens live
  │
  └─ On completion: persist message + usage_records (Power Meter)
```

Streaming uses **SSE** (not WebSockets) — simpler over plain HTTP, sufficient since the only server-initiated data is the token stream itself. This flow applies to `mode=chat` Missions only.

## 10. Workflow run flow

```
Signal fires (manual click | cron schedule | inbound webhook)
  ▼
FastAPI
  │  1. Resolve tenant + Playbook from the Signal
  │  2. Create `missions` row (mode=workflow_run), enqueue job
  ▼
Worker (background job queue)
  │  For each step in playbook.steps, in order:
  │    - llm_call  → LiteLLM Proxy → Model Provider
  │    - gadget_call → built-in function or tenant Gadget Link
  │    - wait       → delay or pause for external event
  │  Persist a mission_steps row per step (input/output/status)
  ▼
On completion (or failure): update mission.status,
persist usage_records (Power Meter), notify Hero/Commander in-app
(and callback the originating system for event-triggered runs, if configured)
```

Unlike chat, workflow runs don't need real-time token streaming to a browser tab — the Hero/Commander checks Mission status/results asynchronously (in-app, or via callback for event-triggered Playbooks).

## 11. Billing & usage metering

- **Subscriptions**: Stripe-based plans (e.g. Starter/Pro/Enterprise) per HQ, each with an included usage quota (messages/tokens).
- **Usage overage**: every AI call logs actual token/cost in `usage_records`. A periodic job aggregates usage against the HQ's plan quota; overage is reported to Stripe as metered usage for the billing period.
- **Power Meter** (Commander-facing dashboard) shows current period usage vs. quota in real time, sourced from `usage_records` + LiteLLM's own per-key usage stats as a cross-check.
- LiteLLM per-tenant budgets act as a hard safety cap independent of the billing pipeline (prevents runaway cost even if invoicing lags).

## 12. File storage

- Intel documents, sydekyk avatars, and other uploads go to an **S3-compatible bucket**; Postgres stores only metadata (`source_file_url`, size, content type).
- Bucket is partitioned by `tenant_id` prefix for easy per-tenant export/deletion.

## 13. Frontend architecture

- **Vite + React SPA**, TypeScript.
- **Tailwind CSS + shadcn/ui** as the component base, themed with a custom dark (black/brown) + gold Tailwind palette for the premium heroic look.
- Suggested (not yet confirmed) supporting choices:
  - **TanStack Query** for server state (conversations, sydekyk roster, usage data).
  - **Zustand** or React Context for lightweight local/UI state (active Mission, streaming buffer).
  - **EventSource** (native) or a small SSE client hook for streaming Mission responses.
- Route structure sketch: `/login`, `/hq/:tenantSlug/roster`, `/hq/:tenantSlug/missions/:missionId` (chat), `/hq/:tenantSlug/playbooks/:playbookId/runs/:missionId` (workflow run status/results), `/hq/:tenantSlug/settings` (Commander-only), `/hq/:tenantSlug/power-meter` (Commander-only).

## 14. Deployment & infrastructure

- All services containerized with Docker: `frontend` (static build behind a CDN/reverse proxy), `backend` (FastAPI), `litellm-proxy`, `postgres` (managed), object storage (managed).
- Single cloud provider, container-based (e.g. ECS/Fargate-style or a PaaS) — no Kubernetes for v1.
- Background jobs run as a worker process/queue (e.g. FastAPI + Celery/RQ or an async task runner) separate from the request-serving backend, handling: Intel ingestion/embedding, usage aggregation, Stripe overage reporting, **and Playbook step execution**.
- **Scheduler** component (e.g. Celery beat or equivalent) fires scheduled Signals on their cron expression.
- **Webhook receiver**: a per-tenant, per-Playbook endpoint (e.g. `/webhooks/{tenant_id}/{playbook_id}`) accepts inbound event Signals; validated via the Playbook's `webhook_secret` before enqueueing a run.
- Environment separation: dev / staging / production, each with its own Postgres, LiteLLM proxy config, and Stripe test/live keys.

## 15. Security considerations

- Tenant isolation enforced at the application layer via `tenant_id` scoping on every query; RLS as future hardening.
- Gadget Link credentials (tenant-provided API keys/OAuth tokens) encrypted at rest, decrypted only in-memory when executing a tool call.
- LiteLLM proxy holds the only copy of upstream provider API keys — never exposed to frontend or stored per-tenant.
- JWT refresh-token rotation + revocation list for logout/compromised-session handling.
- Rate limiting at the FastAPI layer per user/tenant in addition to LiteLLM's own budget/rate limits.
- **Webhook Signals**: inbound requests must be signed/validated against the Playbook's `webhook_secret`; reject unsigned or replayed payloads; rate-limit per endpoint to prevent a tenant's misconfigured integration from triggering runaway runs.

## 16. Explicitly deferred (not in this pass)

- Enterprise SSO (SAML/OIDC).
- Dedicated internal admin UI for building Exclusive Sydekyks (v1 uses direct DB/backend access by the team).
- Kubernetes / multi-region deployment.
- Final cloud provider selection.
- Branching/conditional/parallel (DAG) Playbook structure — v1 ships linear ordered steps only.
- Retry policy for failed Playbook steps.
