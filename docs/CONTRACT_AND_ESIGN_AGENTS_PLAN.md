# Contract Authoring (**Seal**) + Native E-Signature (**Signet**) — Plan

A working spec for **two new paired Sydekyks** that together cover the contract lifecycle from a blank
page to a signed PDF. Written to mirror `docs/PROMPT_FOR_NEW_ODOO_AGENT.md` (the agent-building brief,
especially §14 "interactive-workbench" and §10 "record-monitoring") and
`docs/QUILL_PROPOSAL_GENERATOR_PLAN.md`. **This is a spec for review, not an implementation.**

> **Names are working codenames.** **Seal** (Quill *writes*; Seal *seals*) and **Signet** (a signet ring
> is what presses a wax seal — the pair reads as one system). Alternatives — Seal: Vellum, Notary,
> Codex, Clause; Signet: Hancock, Autograph, Sable, Emissary. The slug keys the backend package, the API
> prefix (`/api/tenant/<slug>`), the frontend registry, and the avatar
> (`frontend/public/sydekyks/<slug>.png`), so **lock both names before coding.** This doc uses `seal` /
> `signet` as placeholders.

## Context

We just shipped **Quill**, our first *interactive-workbench* Sydekyk (§14): a rep drives a full-page
editor, the AI drafts and co-edits, and the human ships a PDF. Quill proved the workbench pattern
(full-page route, TipTap `RichDocEditor`, inline-mission AI turns, per-document token badge, optional
best-effort Odoo). This plan adds two agents that extend that lifecycle to contracts:

1. **Seal** — drafts a contract from a brief + template, then **reviews it clause-by-clause** and
   proposes redlines the human accepts/rejects. Mirrors Quill's workbench, adds a review engine.
2. **Signet** — **gets the finished contract signed**: sends a public hosted signing link to the
   signatories, tracks who has signed, and chases the stragglers with reminders. The platform-native
   e-sign path.

**Why two agents.** One agent, one job (§9). Authoring/de-risking a contract and orchestrating its
signature are distinct responsibilities with different shapes (a workbench vs. a monitored workflow).

**Signing — two complementary paths, both optional.**
- **Odoo Sign** (`sign.template` → `sign.request`) is offered from Seal for tenants on **Odoo
  Enterprise** (the Sign app is Enterprise-only).
- **Signet** is the **native fallback** for everyone else (Community / no-Odoo tenants) — a hosted,
  public signing interface the platform owns end to end. The two are alternatives at the point of "Send
  for signature," never both at once.

### Decisions locked
- **Wow factor (Seal):** draft **and** clause-level review with redlines.
- **Signing:** Odoo Sign (Enterprise) from Seal **and** Signet as the native fallback.
- **Scope (Seal):** general-purpose, template-driven (NDA, MSA, SOW, service, employment, …).
- **Signature capture (Signet):** typed full name + "I agree", with an **optional** drawn signature.
- **Email copy (Signet):** per-envelope user choice of **AI-written** (with an optional "what to say"
  prompt) **or** fixed template; template is always the fallback.

---

# PART A — Seal (contract authoring & review)

## One-line job & shape
**"Drafts a contract from a brief and a template, then reviews it clause-by-clause and proposes redlines
— human approves and hands off for signing."** The second **interactive-workbench** agent (§14) — AI
engine **required**, Odoo **optional**. It is **draft-only, never auto-signs** (§12 discipline).

## What it does — three AI turns, all metered Missions
Quill has two playbooks (`quill.draft`, `quill.refine`). Seal adds a **third** — the review engine:

| Playbook key | Trigger | What it does |
|---|---|---|
| `seal.draft` | "Generate" in editor | Mirror `quill.draft`. Draft full contract HTML from `template_body` + a plain-language `notes` brief + grounded Odoo facts (partner/opportunity). Fills parties, term, governing law, amounts from the brief; anything not supplied becomes a `[confirm …]` placeholder — never invented. |
| `seal.refine` | "Ask Seal" chat | Mirror `quill.refine`. Conversational co-edit of the work-in-progress; two chat rows per turn (user + assistant) with the per-turn token ledger; undo last revision. |
| `seal.review` | "Review contract" button | **The wow factor.** Reads the current contract clause-by-clause, grounded in the tenant's **review playbook**, and emits a structured **findings list**: each `{clause_label, category, severity, issue, suggested_redline, rationale}`. Findings render in the right rail; the user **accepts** a redline (applies the suggested text into the HTML) or **dismisses** it. |

### Review findings — the novel part
- The model is the primary judgment layer (§4 "let AI do the judgment"), but findings are **grounded,
  not free-invented**: the prompt supplies (a) the full contract text, (b) the tenant's **review
  guidelines** (their standard positions / risk tolerance), and (c) a fixed **category taxonomy** so
  severities are comparable across contracts. Every finding must **quote the offending clause text** it
  refers to (traceable, like Reply's "every claim traces to a read field") — a finding with no locatable
  clause is dropped.
- **Category taxonomy (validated set the model must pick from):** `liability_cap`, `indemnity`,
  `auto_renewal`, `payment_terms`, `termination`, `ip_ownership`, `confidentiality`, `governing_law`,
  `warranty`, `data_privacy`, `missing_clause`, `other`. Anything outside the offered set is dropped
  (the "validate against the offered set" discipline from Decode's id mapping, §4).
- **Severity** `high | medium | low`; the review panel sorts high-first (Shield/queue framing).
- **Accept a redline = deterministic apply:** the finding stores `clause_anchor` (the exact quoted
  text) + `suggested_redline`; accept replaces the anchor span in `content_html` server-side and marks
  the finding `accepted`. Dismiss marks it `dismissed`. Re-running review supersedes the prior finding
  set (new `review_seq`), like a fresh mission.
- **Flag, never auto-apply.** Nothing rewrites the contract without an explicit accept — the human is
  always the editor of record.

### Templates & clause library ("based off a template / save as a template")
- Full-contract templates mirror `quill_templates` (`seal_templates`, nullable `tenant_id` for
  built-in / shared). Seed built-in general-purpose templates: **Mutual NDA, Service Agreement, SOW,
  MSA** (html/md). "Save as template" from the editor → `POST /templates` (the Quill flow).
- **Review guidelines** (the tenant's playbook) live as a text field on settings in v1
  (`review_guidelines`, seeded with sensible defaults) — the rubric the review turn is grounded in. A
  structured, per-clause clause library is **Phase 2** (keeps "one agent, one thing" and ships a
  polished v1).

### Import a counterparty contract for review (optional intake)
Upload a PDF/DOCX → `vision_ai.document_to_llm_input` (text-first, vision-fallback) extracts text into a
new contract record's `content_html` → run `seal.review`. Lets Seal review *inbound* contracts, not just
its own drafts. Kept lean (extract → editor → review), not a full diff-vs-template engine.

### Handing off to signing (from the Seal editor)
A **"Send for signature"** button offers whichever path is available:
- **Odoo Sign** (if the Sign app is present) via a best-effort new service
  `backend/app/services/odoo_sign.py` (mirrors `odoo_sales.py`'s degrade-to-None style):
  `create_sign_template(client, *, name, pdf_bytes) -> int | None` and
  `request_signature(client, *, template_id, signer_partner_ids) -> int | None`, both returning `None`
  on any missing-module / version / marshalling snag. Sign is an **enterprise** module many tenants
  lack.
- **"Send via Signet"** (Part B) — creates a Signet envelope from the contract PDF and navigates there.

Odoo stays fully optional (`erp` gadget requirement `is_required=False`). Teach
`gadget_links.mission_generic_record` a `sign.request` branch (`odoo_sign_request_id` →
`("sign.request", id, "Open signature request in Odoo")`). **Live research first (§8.4):** `fields_get`
`sign.template` / `sign.request` / `sign.request.item` on a real Sign-enabled instance before coding.

## Backend package — `backend/app/sydekyks/seal/` (mirror `quill/`, deltas only)

| File | Delta for Seal |
|---|---|
| `__init__.py` | import `models` + `playbook`; re-export `router` + `seed`. |
| `playbook.py` | keep `run_draft` / `run_refine`; **add `run_review`** + `PLAYBOOK_KEY_REVIEW="seal.review"` + `PLAYBOOK_STEPS_REVIEW` (`load_contract`, `load_guidelines`, `check_quota`, `analyze`, `save_findings`). `register_playbook` all three. Same inline-mission + `_finish(failure_category=…)` discipline. |
| `extraction.py` | keep generate/refine (contract wording); **add `review_contract(virtual_key, model_alias, *, contract_html, guidelines, timeout)` → `(ok, msg, {findings:[…]}, meta)`** — JSON-only, each finding validated against the taxonomy; drop findings whose `clause_anchor` isn't found in the source. Via `vision_ai.llm_completion`. |
| `models.py` | mirror the 5 Quill tables (`seal_tenant_settings`, `seal_templates`, `seal_contracts`, `seal_assets`, `seal_chat_messages`) **plus `seal_review_findings`**. Settings adds `review_guidelines` (Text). `seal_contracts` mirrors `quill_proposals` + `odoo_partner_id`, `odoo_sign_request_id`. |
| `schemas.py` | mirror Quill's groups; add `FindingOut`, `ReviewOut`, `ReviewRunIn`, `FindingDecisionIn{decision: accept\|dismiss}`, `SignRequestIn`. |
| `router.py` | `APIRouter(prefix="/api/tenant/seal", dependencies=[require_tenant_member])`. All Quill endpoints (settings, readiness, playbook, insights, templates CRUD, contracts CRUD, `/generate`, `/chat`, `/assets`, `/pdf`, opportunities) **plus**: `POST /contracts/{id}/review`, `GET /contracts/{id}/findings`, `POST /contracts/{id}/findings/{fid}/decision`, `POST /contracts/{id}/import`, `POST /contracts/{id}/sign-request` (Odoo Sign or handoff-to-Signet). Same `permissions.assert_can_use` / `assert_can_configure` gates; same `_run_inline` + `_raise_if_mission_failed` (429 on quota). |
| `readiness.py` | `ai_engine` required + `odoo_assigned` optional (never blocks); soft `odoo_sign` info item. |
| `insights.py` | mirror Quill **+** contracts reviewed, **high-severity findings caught**, redlines accepted (the "what was caught" honesty metric). |
| `seed.py` | set `Sydekyk.playbook_key="seal.draft"`; one optional `erp` gadget requirement (`is_required=False`); seed built-in contract templates + default `review_guidelines`. |
| `pdf.py` | mirror Quill's WeasyPrint doc builder (contract print CSS: numbered clauses, signature block, `@page` footer/counter). |

## Frontend — copy Quill, register in the same 4 places
- `frontend/src/pages/SealEditor.tsx` (from `QuillEditor.tsx`) — same top bar (title autosave, token
  badge, Save-as-template, Preview, Export PDF) + left `RichDocEditor` (reused **verbatim**). Right rail
  gains a **Review panel** (findings grouped by severity, Accept-redline / Dismiss) beside
  Generate/Ask/Odoo, plus a **Send for signature** button (Odoo Sign / Send-via-Signet).
- `frontend/src/sydekyks/seal/*.tsx` — `SealSettingsSection` (adds the **review-guidelines editor**),
  `SealOperationsSection` (New contract / from template / **Import for review**; recent list; Templates
  manager), `SealMissionSummary` (drafted / revised / **reviewed — N findings, M high**),
  `SealInsightsSection` (dashboard card leading with speed + contracts reviewed + high-severity caught).
- `frontend/src/lib/api.ts` — add the parallel interface block (`SealSettings`, `SealContract`,
  `SealFinding`, `SealReview`, …); generic `api.*` (no dedicated client fns, like Quill).
- Register (4 hand-wired places): (1) `registry.tsx` — `BY_SLUG.seal` (`setupSection`,
  `operationsPanel`, `missionSummary`, `missionRowLabel` with a `SEAL_VERBS` pool incl.
  "Reviewed"/"Redlined", `functionGroup:"sales"`, `reviewNoun:{one:"contract",many:"contracts"}`,
  `hideReviewerAssignment:true`) **and** `BY_PLAYBOOK` for `seal.draft` / `seal.refine` / `seal.review`;
  (2) `App.tsx` — import `SealEditor` + `<Route path="/hq/seal/editor/:contractId">` under
  `<ProtectedRoute roles={["commander","hero"]}>`; (3) `TenantDashboard.tsx` — import + place
  `SealInsightsSection`; (4) `gadget_links.py` — the `sign.request` branch. Plus avatar
  `public/sydekyks/seal.png` + a `content/roster.ts` entry.

---

# PART B — Signet (native e-signature dispatch & tracking)

## One-line job & shape
**"Sends a finished contract out for signature via a public link, tracks who has signed, and chases the
stragglers — nothing gets signed without the parties actually signing."** A **workflow + monitoring**
agent (the Nudge §10 shape), *not* a workbench. AI **optional/light**; Odoo **optional**; **outbound
email required** (that's how signers are invited). It **sends only on human launch**: the human
assembles the envelope and clicks Send; the platform then delivers, tracks, and reminds.

**Hard dependency: Signet consumes Seal's output → it requires Seal installed, or auto-installs it.** A
shared helper `ensure_installed(db, tenant_id, slug)` creates the `SydekykInstall` row for Seal if absent
whenever a Signet envelope is created from a Seal contract (and installs Signet itself on the first
handoff from Seal). No new install mechanism — reuse the existing `SydekykInstall`.

## The signing flow (envelope → public link → signed PDF)

1. **Assemble an envelope (authenticated, in-app).** From Seal's "Send via Signet" **or** Signet's own
   operations panel: pick the source PDF (a Seal contract, or an upload), then declare **signatories**
   (name + email), signing **order** (parallel or sequential), **reminder cadence** (every N days, max
   M reminders), and an **expiry** (void after D days). This is the "public interface for signing…
   asking who the signatories are and their email address" requirement.
2. **Send (human-initiated).** On launch, Signet mints a **per-signer opaque token**
   (`secrets.token_urlsafe`, stored Fernet-wrapped via `encrypt_secret` — the gadget-link /
   `addressing.py` precedent) and emails each signer (in order) a link to the **public** signing page.
3. **Public signing page — the new public surface.** `frontend/src/pages/SignContract.tsx` at an
   **unwrapped** route `/sign/:token` (sibling of `/login`, before the `*` catch-all; reuses the shared
   `api` axios instance, which omits the bearer when no token is stored). Backend serves it via a
   **public, no-auth router** modeled on `email_webhook.py` (no `Depends(require_*)`; self-authenticates
   by validating the token with `secrets.compare_digest`; IP rate-limited; never leaks tenant existence):
   - `GET /api/sign/{token}` → envelope title + document (PDF) + this signer's name; logs a **viewed**
     event.
   - `POST /api/sign/{token}` → submit signature: **typed full name + "I agree" checkbox** (a valid
     electronic signature) and **optional drawn signature** (canvas → PNG data URI); logs a **signed**
     event with timestamp + IP.
   - `POST /api/sign/{token}/decline` → decline with a reason; logs **declined**, holds the envelope.
4. **Completion.** When all signers have signed, Signet **assembles the final signed PDF** — stamps each
   signature block onto the document and **appends an audit-certificate page** (each signer's name,
   email, timestamp, IP) — via `signet/pdf.py` (WeasyPrint stamp + `pypdf` merge, mirroring Seal's
   `pdf.py`). It emails the completed PDF to all parties + the sender, marks the envelope `completed`,
   and (best-effort, optional) attaches the signed PDF back to the Odoo record via
   `odoo.attach_document`.
5. **Monitoring, reminders, hold (the Nudge §10 discipline).** A `cron(poll_signet, …)` in
   `backend/worker.py` (watermark pattern like `poll_nudge`) scans `sent` envelopes with pending
   signers:
   - **Follow-up after N days** — if a pending signer's `last_reminded_at` is older than the cadence and
     the envelope isn't on hold/expired and `reminder_count < max` → send a reminder, bump the counter,
     log **reminded**. Guard rails: cadence guard + max reminders — never nag.
   - **When to hold** — an envelope can be put **on hold** (pauses reminders — Nudge's snooze); it
     **auto-holds on decline**; it **auto-voids at expiry**. A held/completed/expired envelope still
     leaves a receipt in the audit trail ("left alone — on hold"), never a silent drop.

## AI layer (per-envelope, user-chosen, metered)
Email copy is a **per-envelope choice**: the sender toggles **AI-written** or **fixed template**. When AI
is chosen, the sender can supply a short **"what to say" prompt** (e.g. "warm, mention the Q3 renewal
deadline") and Signet drafts a personalized invitation + **escalating reminder** copy (more urgent as it
ages), grounded in the envelope + signer. A **deterministic template is always the fallback** — used
when the sender picks template, or when the AI engine/quota is unavailable. AI turns are metered as
Missions (`usage_guard` + `mission_ai.emit_usage`). Settings hold the tenant default (AI vs template) +
the default prompt; the launch dialog can override per envelope.

## New shared infrastructure Signet introduces (built once, reusable — §9)
- **`backend/app/services/mailer.py` — the platform's first outbound mailer.**
  `send_email(db, *, to, subject, html, reply_to=None, tag=None) -> bool` calling the Postmark Server
  API (`https://api.postmarkapp.com/email`, header `X-Postmark-Server-Token`) with the token read via
  `decrypt_secret(postmark_config.get_config(db).encrypted_server_token)` — **the storage slot already
  exists in `PostmarkConfig`, just unused.** From/Reply-To reuse `build_inbound_local_part` +
  `get_inbound_domain` so signer replies thread back through the existing inbound webhook. Degrades
  cleanly (returns `False` + `tenant_issues.report_issue`) when no server token is configured. Keyed for
  reuse by any future agent that needs to send.
- **Public signing router** — the first Sydekyk-owned public route; the `email_webhook.py` self-auth +
  rate-limit precedent is the template.

## Backend package — `backend/app/sydekyks/signet/`
Same package skeleton (`__init__`, `models`, `playbook`, `schemas`, `router`, `readiness`, `insights`,
`seed`, `pdf`), plus a public `public_router.py` for the token routes (also collected by
`collect_routers()`; it declares **no** auth dependency).

- **`models.py` — 4 tables + settings:**
  - `signet_tenant_settings` (unique `tenant_id`): default reminder-interval-days, max-reminders,
    default-expiry-days, sender display name, savings wage/minutes, optional cc, `email_copy_mode`
    (ai|template) + default "what to say" prompt.
  - `signet_envelopes`: `tenant_id`, `sydekyk_id`, `seal_contract_id` (nullable), `title`,
    `source_asset_id` (the PDF bytes), `status` (draft/sent/partially_signed/completed/declined/voided/
    expired), `signing_order` (parallel|sequential), `reminder_interval_days`, `max_reminders`,
    `expires_at`, `hold` (bool), `signed_pdf_asset_id` (nullable), `odoo_record` link (nullable),
    `created_by`, timestamps (`sent_at`, `completed_at`).
  - `signet_signers`: `envelope_id`, `name`, `email`, `order`, `token_encrypted`, `status`
    (pending/viewed/signed/declined), `signed_at`, `viewed_at`, `signature_image` (nullable),
    `decline_reason`, `last_reminded_at`, `reminder_count`, `ip_address`.
  - `signet_events` (audit trail / certificate): `envelope_id`, `signer_id` (nullable), `event_type`
    (created/sent/viewed/signed/reminded/declined/completed/voided), `detail`, `ip`, `created_at`.
  - `signet_assets`: PDF bytes in Postgres (mirrors Seal's asset table) — source + final signed PDF.
- **`playbook.py`:** `signet.dispatch` (send an envelope's invites — a Mission for the activity
  feed/audit; optional AI email copy) and `signet.remind` (a reminder cycle, enqueued by the cron).
  Envelope-completion assembly runs inline on the final public sign POST.
- **`router.py`** (`/api/tenant/signet`, `require_tenant_member`): settings GET/PUT, readiness,
  insights, `POST /envelopes` (create from a Seal contract or upload), `GET /envelopes` (paginated,
  ownership-scoped like Quill), `GET /envelopes/{id}` (status + signer states + event log),
  `POST /envelopes/{id}/send`, `POST /envelopes/{id}/hold` (toggle), `POST /envelopes/{id}/void`,
  `POST /envelopes/{id}/remind` (manual nudge), `GET /envelopes/{id}/signed-pdf`. Permission gates:
  `assert_can_use` on create/send/hold/void/remind; `assert_can_configure` on settings.
- **`public_router.py`** (no auth, token-scoped, rate-limited): `GET /api/sign/{token}`,
  `POST /api/sign/{token}`, `POST /api/sign/{token}/decline`.
- **`readiness.py`:** **Postmark server token configured** (required — that's how it sends) + **Seal
  installed** (required; auto-install offered) + AI engine (optional, only for AI copy) + Odoo
  (optional). `readiness.can_send` gates the launch button.
- **`insights.py`:** envelopes sent, **completion rate**, **median time-to-signature** (the wow metric),
  reminders sent, at-risk (pending & overdue — Nudge's coverage framing). Savings = documents signed ×
  manual-chase-minutes × wage.
- **`seed.py`:** catalog `Sydekyk(slug="signet")`, `playbook_key="signet.dispatch"`, gadget requirements
  (`inbox`/email for the sender identity, optional `erp`), and a declared dependency on Seal surfaced in
  readiness.

**Migration** `0029_seal_tables` then `0030_signet_tables` after `0028_postmark_webhook_auth`,
handwritten + idempotent (`migrations.helpers.has_table/has_column/has_index`), chaining `down_revision`.
**`backend/app/models/__init__.py` must import both agents' models** so Alembic/metadata see them.

## Frontend — Signet
- `frontend/src/pages/SignContract.tsx` — the **public** signing page (unwrapped `/sign/:token`):
  renders the PDF, captures typed name + "I agree" (+ optional drawn signature), submits to the public
  API; decline flow. Plain, mobile-friendly, no app chrome.
- `frontend/src/sydekyks/signet/*.tsx` — `SignetSettingsSection` (cadence/expiry/sender + email-copy
  default + Postmark-token readiness + the Seal-dependency / auto-install prompt),
  `SignetOperationsSection` (New envelope: pick source + signatories + cadence + AI/template copy choice;
  envelope list with live status; per-envelope drawer showing signer states + event log +
  Hold/Void/Remind), `SignetMissionSummary`, `SignetInsightsSection` (completion rate + time-to-sign).
- Register: `registry.tsx` — `BY_SLUG.signet` (+ `BY_PLAYBOOK` for `signet.dispatch` / `signet.remind`,
  `functionGroup:"sales"`, `reviewNoun:{one:"envelope",many:"envelopes"}`, `hideReviewerAssignment:true`);
  `App.tsx` — **public** `<Route path="/sign/:token">` (not wrapped in `ProtectedRoute`);
  `TenantDashboard.tsx` — place `SignetInsightsSection`; avatar `public/sydekyks/signet.png` +
  `content/roster.ts` entry.

---

## Reused shared services (never fork — §9)
Missions (`create_mission` / `run_mission` / `record_step` / `register_playbook`) · AI (`vision_ai`,
`mission_ai`, `usage_guard`) · Odoo (`gadget_links`, `odoo`, `odoo_crm`, `attach_document`, reuse
`odoo_sales`, new `odoo_sign`) · `savings` · **new shared `mailer.py`** · `SydekykInstall`
(auto-install) · `secrets.token_urlsafe` + `encrypt_secret` (signer tokens) · `RichDocEditor.tsx`
verbatim (Seal) · shared shells / toast / `useTenantCurrency` / `AgentCardHeader`.

## Out of scope for v1 (Phase 2 candidates)
- **Seal:** structured per-clause clause library (snippets + swap UI); Spark-style learning of the
  playbook from accepted redlines (§13); full diff-vs-template compare for inbound contracts.
- **Signet:** SMS delivery; multi-document envelopes; advanced field placement (drag-drop signature
  boxes on the PDF — v1 uses a standard signature block); legally-binding certificate
  hashing/blockchain; branded custom domains for the signing page.
- Auto-send / auto-confirm signature — always human-approved (draft-only discipline).

## Verification (§8)
1. `alembic upgrade head` runs the new migrations; re-run `seed` → both catalog rows, playbook keys,
   gadget requirements, Seal built-in templates + default guidelines all exist.
2. `discover_sydekyk_packages()` registers `seal.draft` / `seal.refine` / `seal.review` and
   `signet.dispatch` / `signet.remind`; `collect_routers()` includes both routers **plus the public
   `/api/sign` router**; backend imports clean; `pytest -q` green. New tests: `PLAYBOOK_STEPS`↔`step_key`
   invariants; **review category validation** (offer the set, assert out-of-taxonomy + unlocatable-anchor
   findings drop); accept-redline anchor swap; ownership scoping on lists/fetches; **signing-token
   validation** (bad / expired / reused token rejected; constant-time compare); **reminder cadence
   guard** (never exceeds max, respects hold/expiry); mailer degrades without a server token.
3. **Live Odoo research (read-only) first:** `fields_get` `sign.template` / `sign.request` /
   `sign.request.item`; confirm partner/opp reads for grounding.
4. **E2E on a real instance:** Seal draft → Ask Seal edits → **Review flags a planted risky clause**
   (uncapped liability, auto-renewal) → accept a redline mutates the HTML → Export PDF → **Send via
   Signet** → signer receives a real Postmark email → opens the public `/sign/:token` page (no login) →
   signs → the **cron reminder** fires for a second pending signer → completion assembles the signed PDF
   + certificate and emails all parties → envelope `completed`, deep-links resolve, a `UsageRecord` is
   recorded for each AI turn. Also test **hold** (reminders pause) and **decline** (envelope holds).
5. Frontend `npx tsc --noEmit` clean; the Seal editor route, the **public signing route**, and both
   dashboard cards render correctly (cards only when the agent is installed).

---

### Still open
- **Confirm both names** (Seal / Signet, or an alternative) — everything is slug-keyed, so this is the
  one thing to lock before implementation begins.
