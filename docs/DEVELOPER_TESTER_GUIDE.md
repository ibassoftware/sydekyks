# Sydekyks / Ledger — Developer & Tester Guide

Date: 2026-07-05
Scope: how to stand the system up locally, the mental model, and a feature-by-feature walkthrough
with the exact endpoints and commands to exercise each one. Written for developers and testers.

This complements:
- `ARCHITECTURE.md` (repo root) — target architecture
- `docs/LEDGER_VERTICAL_SLICES.md` — the build plan (VS-0 … VS-15)
- `docs/LEDGER_SLICES_BUILD_REPORT.md` — what shipped + live verification results

---

## 1. Mental model (read this first)

The platform hosts **Sydekyks** — packaged AI workers. **Ledger** is the first one: it ingests
vendor bills and creates them in Odoo.

| Term | What it is |
|------|-----------|
| **Sydekyk** | A packaged worker (Ledger is one). Backend lives in `backend/app/sydekyks/<name>/`, frontend UI in `frontend/src/sydekyks/<name>/`. |
| **Mission** | One execution of a Sydekyk's Playbook — the run record. Has a status, a step trail, an optional document, and (after a failure) a `failure_category`. |
| **Playbook** | The ordered steps a Sydekyk runs. Ledger's is a **fixed** 7-step Python function (`ledger.vendor_bill_ingest`) — not user-editable yet. |
| **Gadget** | An external integration a Sydekyk needs. Ledger needs an **Odoo** gadget (required) and an **Email Inbox** gadget (optional). A tenant creates a **Gadget Link** and **assigns** it to the Sydekyk's requirement. |
| **AI Engine** | The model a Sydekyk uses. Either **Power Core** (Sydekyks-hosted, admin-configured) or **BYOK** (the tenant's own OpenAI/Anthropic/Ollama-Cloud key). Runs through the **LiteLLM proxy** with a per-tenant virtual key. |
| **Signal** | What triggered a Mission: `manual_upload` (web) or `email` (Postmark webhook). |

**Roles:** `super_admin` (platform admin), `commander` (tenant owner — can configure + upload),
`hero` (tenant member — read-mostly).

**The happy path:** install Ledger → configure an AI Engine → connect + assign Odoo → (optionally)
create an Email Inbox → upload or email a bill → a Mission runs the Playbook → the bill lands in
Odoo → inspect it in the Missions ops page.

---

## 2. Architecture at a glance

```
Browser (Vite :5173) ──/api──▶ FastAPI backend (:8000) ──▶ Postgres (:5432)
                                      │
                                      ├─ enqueue ▶ Redis (:6379) ▶ arq worker ▶ run_mission
                                      └─ LLM calls ▶ LiteLLM proxy (:4000) ▶ provider (OpenAI/Anthropic/Ollama Cloud)
Postmark ──POST /api/webhooks/email/postmark──▶ backend (inbound bills)
```

Components & ports:

| Component | Port | Notes |
|-----------|------|-------|
| Frontend (Vite dev) | 5173 | proxies `/api` → `127.0.0.1:8000` (`frontend/vite.config.ts`) |
| Backend (FastAPI/uvicorn) | 8000 | `uvicorn app.main:app` |
| Postgres | 5432 | `docker-compose.yml` (`sydekyks/sydekyks/sydekyks`) |
| Redis | 6379 | `docker-compose.yml` — only needed when `queue_enabled=true` |
| LiteLLM proxy | 4000 | `docker-compose.yml`; master key in `.env`/compose |
| arq worker | — | `arq worker.WorkerSettings` (separate process) |

---

## 3. Prerequisites

- **Docker** (Postgres, Redis, LiteLLM) — `docker --version`
- **Python 3.12+** (repo verified on 3.14) with a venv
- **Node 18+** for the frontend

---

## 4. First-time setup

```bash
# 0. Infra
docker compose up -d postgres redis litellm-proxy   # litellm-proxy optional until you use AI

# 1. Backend deps
cd backend
python -m venv ../.venv && source ../.venv/Scripts/activate   # Windows Git Bash path
pip install -r requirements.txt

# 2. Environment — copy the example and adjust if needed
cp .env.example .env            # DATABASE_URL etc. Defaults match docker-compose.

# 3. Schema (Alembic owns it — NOT create_all)
alembic upgrade head            # fresh DB: builds everything
#   Existing/drifted DB instead:  alembic stamp 0001_baseline && alembic upgrade head
python -m scripts.schema_diff   # expect: "Schema in sync with models."

# 4. Seed platform data (admin user, Ledger catalog row, gadgets, requirements)
python -m app.seed              # data only; set SCHEMA_AUTO_CREATE=1 to also create tables (dev/test)

# 5. Run the API
uvicorn app.main:app --reload   # http://127.0.0.1:8000  (docs at /docs)

# 6. (Optional) Run the worker — only if queue_enabled=true
arq worker.WorkerSettings

# 7. Frontend (separate terminal)
cd ../frontend
npm install
npm run dev                     # http://localhost:5173
```

**Default super-admin** (from `.env`): `rein@ibasuite.com` / `admin123`.

> **Queue note:** with `queue_enabled=false` (default), Missions run **in-process** (fine for local
> dev/demo, no Redis/worker needed). Set `queue_enabled=true` + run the worker to exercise the
> durable arq path (VS-7).

---

## 5. Create a tenant and log in

Everything below uses the API directly (the UI does the same calls). Save the token from login.

```bash
API=http://127.0.0.1:8000/api

# Log in as super-admin
ADMIN_TOKEN=$(curl -s $API/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"rein@ibasuite.com","password":"admin123"}' | python -c "import sys,json;print(json.load(sys.stdin)['access_token'])")

# Create a tenant + its commander user
curl -s $API/admin/tenants -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Acme","slug":"acme","commander_email":"boss@acme.test","commander_password":"acme123"}'

# Log in as the commander
TOKEN=$(curl -s $API/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"boss@acme.test","password":"acme123"}' | python -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
```

In the browser: go to `http://localhost:5173`, log in as the commander, land on **/hq**.

---

## 6. Configure Ledger end-to-end

Ledger is **exclusive/published** by seed, so it's active without an install step. The
**readiness checklist** (top of the Ledger page) tells you exactly what's left.

### 6a. AI Engine

**Option A — BYOK (simplest for testing; verified with Ollama Cloud):**

```bash
# Find Ledger's id
LEDGER=$(curl -s $API/tenant/sydekyks -H "Authorization: Bearer $TOKEN" \
  | python -c "import sys,json;print([s['id'] for s in json.load(sys.stdin) if s['slug']=='ledger'][0])")

# Store your provider key (Ollama Cloud shown — api_base is REQUIRED for ollama_cloud)
curl -s -X PUT $API/tenant/provider-credentials/ollama_cloud -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"api_key":"<YOUR_OLLAMA_CLOUD_KEY>","api_base":"https://ollama.com/v1"}'

# Point Ledger at a model (kimi-k2.7-code and gemma3:4b both verified vision-capable)
curl -s -X PUT $API/tenant/sydekyks/$LEDGER/llm-config -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"provider":"ollama_cloud","model":"kimi-k2.7-code"}'

# Confirm the engine actually works (round-trips a real completion)
curl -s -X POST $API/tenant/sydekyks/$LEDGER/llm-config/test -H "Authorization: Bearer $TOKEN"
```

> **Ollama Cloud specifics (verified live 2026-07-05):** it's OpenAI-compatible at
> `https://ollama.com/v1`; the platform drives it through LiteLLM's `openai/<model>` provider (not
> `ollama/`). Cost is `$0` (subscription-priced, no LiteLLM price map) but **token usage is still
> captured**. OpenAI/Anthropic additionally report per-call dollar cost.

**Option B — Power Core (Sydekyks-hosted):** super-admin sets a central key
(`PUT /api/admin/provider-keys/{provider}`) and a hosted assignment
(`PUT /api/admin/sydekyks/{id}/hosted-assignment`), then the tenant picks `power_core` in the
llm-config. Use this to test per-tenant hosted-spend tracking.

### 6b. Odoo (required)

Create an Odoo Gadget Link and assign it to Ledger's `erp` requirement. In the UI: **Gadgets →
Add Odoo**, then the Ledger page's **Integrations** section to assign it. Via API:

```bash
# Create the link
curl -s $API/tenant/gadget-links -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"gadget_slug":"odoo","name":"Prod Odoo","url":"https://odoo.example.com","database":"mydb","username":"me@ex.com","secret":"<api-key>"}'
# Test it
curl -s -X POST $API/tenant/gadget-links/<LINK_ID>/test -H "Authorization: Bearer $TOKEN"
# Assign it: Ledger page → Integrations, or PUT the gadget-requirement assignment
```

### 6c. Email Inbox (optional — VS-2)

One click on the Ledger page ("Create Email Inbox") creates the link **and** assigns it. Via API:

```bash
curl -s -X POST $API/tenant/ledger/email-inbox -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"name":"Ledger Inbox"}'
# → { "link_id": "...", "inbound_address": "acme-xxxx@inbound.sydekyks.app" }
```

### 6d. Check readiness (VS-1 / VS-6)

```bash
curl -s $API/tenant/ledger/readiness -H "Authorization: Bearer $TOKEN"   # UI shows this as the checklist
# CLI gate:
python -m scripts.check_demo_readiness acme    # exits non-zero if a required item is blocked
```

### 6e. Send a bill

- **Upload:** Ledger page → drop a PDF/PNG/JPG/WEBP (≤15MB), or
  `POST /api/tenant/sydekyks/{id}/documents` (multipart `files`).
- **Email:** send a bill to the inbound address (needs Postmark/DNS wired in a real deploy; locally
  simulate with the webhook curl in §9).

Watch the Mission run in **Recent Missions** (Ledger page) or the **Missions** ops page.

---

## 7. Feature reference (by slice)

| Feature | Where (UI) | Endpoint(s) | Notes |
|---------|-----------|-------------|-------|
| **Readiness checklist** (VS-1) | Top of Ledger page | `GET /tenant/ledger/readiness` | States: ok/warn/blocked; upload is gated on required items. |
| **Email inbox** (VS-2) | Ledger page → Email intake | `POST /tenant/ledger/email-inbox` | Composed create+assign; shows/copies the inbound address. |
| **Mission ops page** (VS-3) | `/hq/missions` | `GET /tenant/missions` (filters + pagination) | Filter by status/source/filename; drill into the step trail. |
| **Retry** (VS-4) | Failed-mission detail (both places) | `POST /tenant/missions/{id}/retry` | Creates a **new** linked Mission (`parent`/`root`/`attempt_number`), replays the original Playbook + document. Failed-only. |
| **Read-only Playbook** (VS-5) | Ledger page → Playbook | `GET /tenant/ledger/playbook` | The 7 fixed steps + failure hints. Labeled "not editable". |
| **Vision readiness test** (VS-12) | Ledger page → readiness test | `POST /tenant/ledger/vision-test` | Runs the real engine on a bundled sample invoice; sets `ledger_vision_ok`. |
| **CSV export** (VS-14) | `/hq/missions` → Export CSV | `GET /tenant/missions/export` | Same filters as the list. |
| **Usage attribution** (VS-15) | (data) | `usage_records` table | One row per hosted-AI call: tokens always; cost when the provider is priced. |
| **Queue execution** (VS-7) | (infra) | `enqueue_mission` → arq | `queue_enabled=true` + worker; else in-process fallback. |
| **Email diagnostics** (VS-8) | (data) | `email_ingest_events` table | Every inbound recorded with an outcome; idempotent on `message_id`. |

**Failure categories** (set on a failed Mission, drive retry policy): `setup` (missing config),
`validation` (bad/unusable input), `transient` (LLM/proxy), `external` (Odoo), `unknown`.

---

## 8. Migrations workflow

Schema is owned by **Alembic** (`backend/migrations/`), not `create_all`.

```bash
alembic upgrade head            # apply
alembic downgrade -1            # roll back one
python -m scripts.schema_diff   # verify models == DB
```

**Adding a migration** after a model change:
1. Change the model.
2. `alembic revision -m "what changed"` (autogenerate is available, but this repo hand-writes
   small migrations for clarity).
3. Make additive ops **idempotent** using `migrations/helpers.py` (`has_column`/`has_table`/…) —
   the baseline builds current-model tables, so guards keep migrations safe on both fresh and
   drifted DBs.
4. `alembic upgrade head` + `schema_diff`.

Existing/drifted DB adoption: `alembic stamp 0001_baseline` then `alembic upgrade head`.

---

## 9. Testing

```bash
cd backend
# Pure-logic tests run anywhere:
pytest tests/test_extraction.py tests/test_duplicates_confidence.py tests/test_postmark_and_playbook.py

# Full suite incl. DB-gated integration tests — point at a REAL throwaway Postgres:
createdb -h localhost -U sydekyks sydekyks_test   # or: docker exec sydekyks-postgres createdb -U sydekyks sydekyks_test
TEST_DATABASE_URL=postgresql+psycopg://sydekyks:sydekyks@localhost:5432/sydekyks_test pytest
```

Why real Postgres: models use `JSONB`/`bytea`/`UUID`; SQLite would give false confidence. Without
`TEST_DATABASE_URL` reachable, the DB-gated tests **skip** (they don't fail).

**Simulate the Postmark webhook locally** (no real Postmark needed — it's just an authed POST):

```bash
# Basic auth = email_webhook_basic_auth_user:pass from .env (defaults postmark:dev-...secret)
AUTH=$(printf 'postmark:dev-inbound-webhook-secret-change-me' | base64)
curl -s -X POST http://127.0.0.1:8000/api/webhooks/email/postmark \
  -H "Authorization: Basic $AUTH" -H 'Content-Type: application/json' \
  -d '{"OriginalRecipient":"acme-xxxx@inbound.sydekyks.app","FromFull":{"Email":"vendor@ex.com"},
       "Subject":"Invoice","MessageID":"msg-1",
       "Attachments":[{"Name":"bill.pdf","ContentType":"application/pdf","Content":"'"$(printf '%%PDF-1.4 test' | base64)"'"}]}'
# Repeat with the same MessageID → {"status":"duplicate"}.  Unknown local-part → {"status":"no_match"}.
# Inspect: SELECT outcome, reason FROM email_ingest_events ORDER BY created_at DESC;
```

---

## 10. Configuration reference (`backend/app/core/config.py` / `.env`)

| Setting | Default | Purpose |
|---------|---------|---------|
| `database_url` | `postgresql+psycopg://sydekyks:sydekyks@localhost:5432/sydekyks` | Main DB |
| `jwt_secret` / `access_token_expire_minutes` | dev / 60 | Auth |
| `encryption_key` | dev Fernet key | Encrypts stored secrets (Odoo/provider keys) |
| `litellm_proxy_url` / `litellm_master_key` | `:4000` / dev key | LiteLLM admin + completions |
| `redis_url` | `redis://localhost:6379/0` | arq queue |
| `queue_enabled` | `false` | `true` = arq worker; `false` = in-process |
| `max_document_bytes` | 15 MiB | Shared upload + email size cap |
| `email_webhook_basic_auth_user`/`_pass` | `postmark`/dev | Webhook auth |
| `email_webhook_rate_limit_per_minute` | 60 | Webhook flood guard (VS-11) |
| `email_inbound_domain` | `inbound.sydekyks.app` | Inbound address domain |
| `SCHEMA_AUTO_CREATE` (env only) | unset | `1` = `create_all` for local/test bootstrap only |

**Secrets:** never commit real keys. `backend/.env` is gitignored. Provider keys live encrypted in
the DB and (for models) in LiteLLM's own store — not in the repo.

---

## 11. Troubleshooting

| Symptom | Likely cause / fix |
|---------|--------------------|
| `alembic: command not found` | `pip install -r requirements.txt` (adds alembic/arq/redis/pillow). |
| `relation "missions" does not exist` | Ran seed/app before `alembic upgrade head`. Migrate first. |
| Mission stuck in `queued` | `queue_enabled=true` but no worker running → start `arq worker.WorkerSettings`, or set `queue_enabled=false`. |
| Upload disabled on Ledger page | Readiness has a `blocked` required item — check the checklist (AI engine / Odoo). |
| Vision test fails | The model can't read images. Use a vision-capable model (e.g. `gemma3:4b`, `kimi-k2.7-code`, OpenAI `gpt-4o`). |
| Emailed bill never appears | Check `email_ingest_events` — `no_match` (address), `no_sydekyk` (not assigned), `rejected_size`, `duplicate`. |
| `queue` enqueue silently runs in-process | Redis unreachable → intentional inline fallback; check `redis_url` + `docker compose up -d redis`. |
| LiteLLM 4xx on engine test | Provider key/model wrong, or (Ollama Cloud) missing `api_base=https://ollama.com/v1`. |

---

## 12. Verified-live status (see build report for detail)

✅ Alembic upgrade/downgrade/idempotency + `schema_diff` clean · ✅ 21/21 pytest on real Postgres ·
✅ arq enqueue→worker→drain over Redis · ✅ real vision extraction through LiteLLM on a live Ollama
Cloud key (vendor/invoice#/total read correctly; token usage captured) · ✅ frontend `tsc` + `vite
build`.

Not yet run end-to-end: `reconcile_tenant` against live **priced** spend (Ollama is $0); the
Postmark webhook over real DNS (locally simulatable per §9).
```
