# Quill — Proposal Generator Sydekyk

## Context

Quill is the next Sydekyk (already stubbed as an `UPCOMING` Sales teaser in `roster.ts`). Unlike
every shipped agent — which are batch/cron/document→record pipelines driven by the Mission engine —
**Quill's heart is an interactive authoring workbench**: a rep picks a template (HTML or Markdown),
drops in their notes, has AI generate a polished proposal, then edits it — both by hand in a rich-text
editor **and by conversation** ("Ask Quill" — a chat panel where Quill reads the live proposal HTML and
rewrites the work-in-progress on request), inserts images, and exports a PDF. It maps most closely to
the doc's §12 "Reply" pattern (draft customer-facing prose, human in the loop, `<agent>_records` as the
store), but adds a real in-app rich-text editor + AI co-editing loop the codebase does not have yet.

Per the user's decisions:
- **PDF:** server-side **WeasyPrint** (crisp HTML/CSS→PDF, and it lets us merge an Odoo quotation PDF).
- **Odoo:** hooks built in v1 but **every Odoo step is individually optional** — create a draft
  `sale.order`, merge its official PDF, and upload the merged doc back to the quotation are all opt-in.
  Quill is fully usable with no Odoo connection at all.
- **AI:** generate from **template + user notes**, with an **optional** "pull facts from an Odoo
  opportunity (`crm.lead`)" grounding step.

Three things are net-new to the repo: a rich-text editor (no tiptap/lexical present), HTML→PDF
(only PDF *reading* exists today), and any `sale.order` usage (Quill is the first).

---

## Key decisions (settled)

- **Editor lib: TipTap** (`@tiptap/react` + starter-kit + image/link extensions). React 19-native,
  outputs clean HTML, first-class image support. Avoids the name clash with the "Quill" JS editor.
- **Canonical editor format is HTML.** Markdown templates are converted on import with `marked`
  (md→html); optional MD export via `turndown` (html→md). HTML is what's stored and edited.
- **Editor is a reusable component** (`frontend/src/components/RichDocEditor.tsx`) with only Quill
  consuming it now — matches the platform's "build the generic thing, wire one consumer" ethos while
  keeping scope tight. A future contract/SOW agent can reuse it.
- **Every AI turn runs as a Mission** — the initial `quill.draft` generation *and* each conversational
  `quill.refine` edit. Running each turn through the mission engine means metering
  (`usage_guard.check_allowed` pre-flight + `mission_ai.emit_usage`), the activity popup, and savings
  all work the standard way, and — critically — **every token is tracked** through the existing
  `UsageRecord` ledger (prompt/completion/total tokens + `cost_usd`, keyed by `mission_id`), rolling
  into the tenant's monthly cap and daily usage. Refine missions render as calm, muted revision rows.
- **Token tracking is first-class.** Because Quill is far more token-intensive than the other agents
  (long HTML in *and* out on every refine turn), the editor shows a **live per-proposal token + est.
  cost counter**, per-turn counts are stored on `quill_chat_messages`, and the Quill dashboard card
  leads with tokens/AI-cost. `usage_guard` denials (monthly cap hit) surface the human-readable reason
  as a toast and disable the chat send until the window frees.
- **`erp` gadget requirement is `is_required=False`** (unlike Nudge) — Quill works without Odoo.

---

## Backend — new package `backend/app/sydekyks/quill/`

Mirror `backend/app/sydekyks/nudge/` structure. Files:

- `__init__.py` — import `models, playbook`; re-export `router` + `seed`.
- `models.py` — five tables (see below).
- `playbook.py` — registers **two** playbook keys via `register_playbook(...)`:
  - `PLAYBOOK_KEY = "quill.draft"` (the catalog's primary) — `run(db, mission)` reads `trigger_context`
    `{proposal_id, template_id, notes, odoo_lead_id?}`, optionally reads the opportunity via
    `odoo_crm.read_lead`, calls `generate_proposal`, writes the generated HTML onto the proposal,
    ends with `result_summary` `{proposal_id, title, customer, action: "drafted"}`.
  - `"quill.refine"` — `run(db, mission)` reads `trigger_context` `{proposal_id, message}`, loads the
    proposal's current `content_html` + recent `quill_chat_messages` history, calls `refine_proposal`,
    writes the returned HTML back onto the proposal, appends the user + assistant turns to
    `quill_chat_messages` (with the turn's token counts copied from its `UsageRecord`), ends with
    `result_summary` `{proposal_id, title, action: "revised", changed: "<one-line summary>"}`.
- `extraction.py` — two AI calls through `app.services.vision_ai.llm_completion` (text completion):
  - `generate_proposal(...)` — inputs = template body + user notes + optional grounded CRM facts;
    output = HTML body. Every factual claim about the customer must trace to a read Odoo field (§12);
    if a fact isn't present, the draft says "confirm" rather than inventing.
  - `refine_proposal(current_html, message, history)` — system prompt: "You are Quill, editing an
    in-progress proposal. Given the current HTML and the user's instruction, return the **full updated
    HTML**, a short chat reply, and a one-line summary of what you changed. Change only what's asked;
    preserve existing structure, images (`<img src=/api/tenant/quill/assets/...>`), and formatting."
    Returns JSON `{reply, html, changed_summary}`. Both calls are gated by `usage_guard.check_allowed`
    and attributed with `emit_usage`.
- `schemas.py` — Pydantic for settings, templates, proposals, generate-request, export-request.
- `router.py` — `APIRouter(prefix="/api/tenant/quill", dependencies=[Depends(require_tenant_member)])`.
  Guard config with `permissions.assert_can_configure`, actions with `assert_can_use`.
- `readiness.py` — checklist (AI engine set? Odoo assigned? — Odoo shown as *optional*).
- `insights.py` — dashboard aggregates + `quill_activated`. Because Quill is token-heavy, the card
  **leads with tokens + est. AI cost** (proposals drafted · revisions · tokens · ~$cost), sourced from
  the existing per-Sydekyk `metering`/`UsageRecord` aggregates, then savings.
- `seed.py` — set `playbook_key`, add `erp` gadget requirement with `is_required=False`; seed a couple
  of **built-in starter templates** (tenant_id=None) so a new tenant isn't staring at a blank editor.
- `pdf.py` — WeasyPrint render (`render_html_to_pdf(html, page_setup) -> bytes`) + `pypdf` merge
  (`merge_pdfs([...]) -> bytes`). Wrap the proposal body HTML in a branded print stylesheet.

### Data model (`models.py`) — new migration

| Table | Purpose / key columns |
|-------|-----------------------|
| `quill_tenant_settings` | one per tenant: `default_template_id`, page setup (size/margins), brand (logo asset id, accent color), savings assumptions (`estimated_hourly_wage`, `estimated_minutes_per_proposal`), default Odoo toggles (`auto_create_quotation`, `merge_quotation_pdf`, `upload_to_quotation` — all default false). |
| `quill_templates` | `tenant_id` (NULL = built-in/shared), `name`, `format` (`html`/`md`), `body` (Text), `created_by`, timestamps. "Save as new template" writes a row here. |
| `quill_proposals` | `tenant_id`, `sydekyk_id`, `title`, `content_html` (Text), `status` (`draft`/`final`), `template_id` (origin), `odoo_lead_id` (nullable), `odoo_sale_order_id` (nullable), `mission_id` (the generate mission), `created_by`, timestamps. This is the §12 draft store. |
| `quill_assets` | `tenant_id`, `proposal_id` (nullable → reusable brand logo), `filename`, `content_type`, `content` (LargeBinary), `created_by`. Image bytes in Postgres, mirroring the `document_storage` boundary. |
| `quill_chat_messages` | The "Ask Quill" transcript + per-proposal token ledger: `proposal_id`, `tenant_id`, `seq` (turn order), `role` (`user`/`assistant`), `content` (Text), `mission_id` (the `quill.refine` mission, nullable), `prompt_tokens`, `completion_tokens`, `total_tokens`, `cost_usd`, `created_by`, `created_at`. Token counts are copied from the turn's `UsageRecord` so the editor can show a running per-proposal total without re-aggregating. The authoritative ledger stays `UsageRecord`/`metering`. |

Add all five to `backend/app/models/__init__.py`. Migration is handwritten + idempotent
(`migrations.helpers.has_table/has_column`), numbered after `0023`.

### Router endpoints (`/api/tenant/quill`)

- `GET/PUT /settings`, `GET /readiness`, `GET /playbook`, `GET /insights`
- `GET /templates`, `POST /templates`, `GET/PUT/DELETE /templates/{id}` (built-ins are read-only)
- `GET /proposals?limit=&offset=` (paged), `POST /proposals` (blank or `from_template_id`),
  `GET/PUT/DELETE /proposals/{id}` (PUT saves edited `content_html`/`title`/`status`)
- `POST /proposals/{id}/generate` — body `{template_id, notes, odoo_lead_id?}`; validates the command,
  creates + enqueues the `quill.draft` Mission, and returns `202 MissionStartOut`. The editor observes
  the shared Mission SSE endpoint and refetches the proposal after completion. Metered.
- **`POST /proposals/{id}/chat`** — body `{message}`; validates the command, creates + enqueues a
  `quill.refine` Mission, and returns `202 MissionStartOut`. The editor observes shared Mission SSE,
  then refetches the proposal and transcript. Guarded by `assert_can_use`; a `usage_guard` denial is a
  `mission.failed` event with a safe reason the editor can toast.
- **`GET /proposals/{id}/chat`** — the conversation transcript (from `quill_chat_messages`) + the
  proposal's running token/cost total, for rehydrating the editor on load.
- `POST /proposals/{id}/assets` (image upload, multipart via `python-multipart`), `GET /assets/{id}`
  (serve bytes with content-type — the editor's `<img src>` points here)
- `POST /proposals/{id}/pdf` — body `{merge_quotation?: bool}`; WeasyPrint render → optional merge →
  returns `application/pdf`
- **Odoo (all optional):** `GET /odoo/opportunities?q=` (live `crm.lead` search for the AI-grounding
  picker), `POST /proposals/{id}/quotation` (create a **draft** `sale.order` via new `odoo_sales.py`;
  returns quotation id + deep link), `POST /proposals/{id}/attach-to-quotation` (upload the merged PDF
  back to the `sale.order` via `odoo.attach_document`).

### New shared service `backend/app/services/odoo_sales.py`

First `sale.order` integration in the repo. Mirror `odoo_crm.py`: version-safe `fields_get`,
`create_quotation(client, partner_id, lines, ...)` (draft state only — never confirm), `read_order`,
deep-link via `gadget_links.odoo_form_url`. Teach `gadget_links.mission_generic_record` about
`sale.order` → "Open quotation in Odoo". Reused by the future "Comparex" agent.

### Backend dependencies (`backend/requirements.txt`)

Add `weasyprint` and `pypdf`. **WeasyPrint needs system libs** (pango, cairo, gdk-pixbuf,
libffi) — update the backend Dockerfile/apt install list. Call this out as an infra step; it's the
one non-trivial ops change.

---

## Frontend

### New reusable component
- `frontend/src/components/RichDocEditor.tsx` — TipTap editor (bold/italic/headings/lists/links/
  images/tables toolbar), `value`/`onChange` HTML, an `onInsertImage` hook that uploads to
  `POST /proposals/{id}/assets` and inserts the returned `GET /assets/{id}` URL. Styled with the ink/
  gold theme tokens from `index.css`.

### New full-page workbench
- `frontend/src/pages/QuillEditor.tsx` (wrapped in `HQShell`), route
  `/hq/quill/editor/:proposalId` registered in `frontend/src/App.tsx` under
  `<ProtectedRoute roles={["commander","hero"]}>`. Three-column layout:
  - **Center:** `RichDocEditor` showing the live proposal HTML.
  - **Right rail — "Ask Quill" chat** (`QuillChatPanel.tsx`): the conversation transcript (each Quill
    turn shows its one-line "what changed" + an **Undo this revision** affordance that restores the
    pre-turn HTML), a message input, and a **live token/cost badge** for this proposal (updated from
    each `/chat` response; also fed by `GET /chat` on load). A `usage_guard` 429 toasts the cap reason
    and disables send.
  - **Top bar / tools:** **Generate with AI** (template picker + notes + optional opportunity picker),
    **Save / Save as template**, **Export PDF**, and a collapsible **Odoo** panel (create quotation,
    merge into PDF, attach back — each a toggle/button, all optional).
  - On a `/chat` reply, the returned HTML replaces the editor content (with client-side undo), and the
    new user+assistant turns append to the transcript.

### Per-Sydekyk UI (`frontend/src/sydekyks/quill/`) + registry
- `QuillSettingsSection.tsx` — readiness (Odoo optional), savings inputs, page/brand setup, Odoo
  default toggles.
- `QuillOperationsSection.tsx` — **the entry point**: "New proposal" button (creates a proposal →
  navigates to the editor) + a paged list of recent proposals (open/duplicate/delete) + a templates
  list. Rendered as the registry `operationsPanel` on `SydekykDetail`.
- `QuillMissionSummary.tsx` — shows the generated proposal (title, customer) with an "Open in editor"
  link.
- Register in `frontend/src/sydekyks/registry.tsx`: `quill` entry (`setupSection`, `operationsPanel`,
  `missionSummary`, `missionRowLabel`, `functionGroup: "sales"`, `reviewNoun: {one:"proposal",
  many:"proposals"}`) + a `QUILL_VERBS` pool + both `quill.draft` and `quill.refine` in `BY_PLAYBOOK`.
  Row labels: draft → "Drafted the proposal 'Acme rollout' for Acme Corp"; refine → muted "Revised
  'Acme rollout' · shortened the intro".

### Marketing + catalog wiring
- `frontend/src/content/roster.ts`: add `"quill"` to `RosterSlug`, add a full `ROSTER` entry
  (domain `Sales`, `accent: "gold"`), and remove Quill from `UPCOMING`.
- `backend/app/seed.py`: add a Quill row to `_ROSTER_SYDEKYKS` (`slug="quill"`, tagline,
  `system_prompt`, `model="gpt-4o-mini"`, `chat_enabled=False`, `workflow_enabled=True`).
- Add avatar `frontend/public/sydekyks/quill.png`.

### Frontend dependencies (`frontend/package.json`)
Add `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extension-image`, `@tiptap/extension-link`,
`marked` (md→html import). Optional: `@tiptap/extension-table`, `turndown` (md export).

---

## Reused, not rebuilt

- Odoo connection + helpers: `app/services/odoo.py` (`connect`, `attach_document`, `post_message`),
  `gadget_links.find_assigned_link`/`odoo_form_url`, `odoo_crm.read_lead`.
- AI plumbing + metering: `vision_ai.llm_completion`, `mission_ai.get_llm/emit_usage`,
  `usage_guard.check_allowed`, `savings.compute/processing_seconds`.
- Mission engine (`missions.create_mission` no-doc shape, `record_step`, `run_mission`).
- `document_storage` boundary pattern for asset bytes; `FileDropZone`, `Modal`, `Button`, `Card`,
  `PageShell` from `components/ui.tsx`; `useTenantCurrency`/`formatMoney`; the axios "Saved" interceptor.
- Zero-touch discovery: `app/sydekyks/__init__.py` auto-imports the package; `main.py` mounts the
  router; no central-registry edits.

---

## Verification (end-to-end)

1. `alembic upgrade head` applies the new migration; re-run `seed` → the Quill catalog row, flags,
   optional `erp` requirement, and built-in templates exist.
2. Backend imports clean, `discover_sydekyk_packages()` registers **both** `quill.draft` and
   `quill.refine`, `collect_routers()` includes the router. `pytest -q` green (add tests:
   `PLAYBOOK_STEPS`↔`step_key` invariant, AI HTML output shape, templates built-in read-only guard,
   WeasyPrint render returns non-empty PDF bytes, and a `/chat` turn writes both `quill_chat_messages`
   rows + a `UsageRecord` and returns the running token total).
3. Frontend `npx tsc --noEmit` clean; `npm run build` succeeds with the TipTap deps.
4. **Manual E2E** (use the `/run` skill to launch the app):
   - New proposal → pick a built-in template → enter notes → **Generate with AI** → HTML loads in the
     editor; a `quill.draft` Mission + a `UsageRecord` are recorded.
   - **Ask Quill** in the chat ("shorten the intro and add a pricing table") → the editor HTML updates,
     the transcript shows what changed, and the **per-proposal token counter increments** (a
     `quill.refine` Mission + a `UsageRecord` recorded; verify tokens roll into the monthly metering).
     Undo restores the pre-turn HTML.
   - Insert an image (uploads to `/assets`, renders via `/assets/{id}`), edit text, **Save as template**.
   - **Export PDF** → a crisp PDF downloads with the image.
   - **Optional Odoo path** (on a real instance, if connected): pick an opportunity to ground the
     draft; create a draft `sale.order`; export with `merge_quotation=true` → merged PDF; attach it
     back to the quotation and confirm it appears in Odoo. Each step works and is skippable.
5. Dashboard: the Quill insights card renders only when installed and has data; roster shows Quill
   under Sales (no longer in "upcoming").

---

## Follow-up: update the build brief

After shipping, add a **§14 to `docs/PROMPT_FOR_NEW_ODOO_AGENT.md`** capturing the new patterns this
agent introduces (the first *interactive-workbench* Sydekyk): the reusable `RichDocEditor`, the
full-page `/hq/<slug>/...` route escape hatch from the `SydekykDetail` shell, the **AI co-editing loop**
(a `<slug>.refine` chat playbook that rewrites work-in-progress content, with each turn a metered
Mission so tokens flow through the normal `UsageRecord` ledger + a live per-document token counter),
HTML→PDF via WeasyPrint + pypdf merge, the `quill_assets` image-bytes store, and the new
`odoo_sales.py` service — so the next document-generation agent reuses them.
