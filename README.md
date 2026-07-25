# Sydekyks Desktop

Sydekyks is a local-first Electron app where **Syd** coordinates specialized assistants called **Sydekyks**. The installed roster includes **Ledger** for vendor bills, **Nudge** for CRM momentum, **Mirror** for duplicate-bill intelligence, and **Shield** for ranked accounts-payable risk review.

## What the MVP includes

- Syd as a Mastra supervisor with bounded delegation to least-privilege Ledger, Nudge, Mirror, and Shield agents.
- Persistent, auto-titled chat sessions backed by local Mastra memory, with visible portraits for Syd and installed Sydekyks.
- Ledger vendor-bill workflow with total and active-currency validation, vendor-scoped duplicate detection, partner lookup, AI vendor-history comparison, AI account and tax recommendations, permission-gated creation, and draft verification.
- Durable, sequential suspend/resume approvals for missing Odoo partners and purchase taxes. Configuration writes are deferred until every approval gate passes, so declining a later gate leaves no partially created vendor or tax.
- Remembered partner- and tax-creation permissions stored as explicit local records.
- IMAP inbound-email Gadget with OS-encrypted credentials, cursor-based polling, MIME/PDF extraction, attachment and message deduplication, and a per-Sydekyk verification policy.
- Chat document intake with a paperclip picker, drag and drop, local content-addressed storage, PDF text extraction, multimodal image/scanned-document analysis when the configured model supports it, and an inline Ledger review card.
- Structured-output Bill Intelligence for bill/not-bill classification, field extraction with confidence and evidence, vendor-history comparison, expense-account and tax recommendations, and bounded Odoo write-failure diagnosis.
- Mission Control bill-review queue, inline Chat approval cards, and native desktop approval notifications.
- Expandable specialist reports in Chat with live stage/status, consulted sources, verified facts, performed or proposed actions, rationale, confidence and uncertainty, approval requirements, and the specialist's final response—without raw chain-of-thought.
- Odoo Gadget with OS-encrypted credentials, connection testing, company selection, and live-write controls.
- AI Gadget with user-selectable OpenAI, Anthropic, Google, or Ollama Cloud models and OS-encrypted API-key storage.
- Internal generic Odoo Gateway for validated `fieldsGet`, `search`, `read`, `searchRead`, `create`, and `write` operations. Sydekyks reuse it behind workflow policy; Syd can also discover and read any Odoo model available to the connected user for bounded factual lookups when no specialist workflow matches. It is not a manual console or a cognitive fallback.
- A deterministic demo Odoo Gadget for testing without production credentials.
- Mission Control, Roster, Gadgets, and Markdown/GFM chat views.
- Nudge's read-only CRM workflow with AI assessment of activity gaps and recent messages, available from Chat, one-off Mission Control checks, or recurring local automations.
- Mirror's read-only, two-pass AI workflow: broad duplicate-candidate screening followed by full line-item confirmation, with support for split vendor records through opaque Tax ID and bank fingerprints.
- Shield's read-only **Watch → Assess → Rank → Brief** workflow: AI evaluates every supplied bill against bounded bill and vendor-change context, then creates a ranked, evidence-backed auditor brief. Sensitive identity values are fingerprinted before model analysis.
- Flexible timezone-aware Nudge, Mirror, and Shield automations for daily, weekday, weekly, and every-N-days cadences, including missed-run policy, pause/resume, run-now, edit, next-run preview, and quiet desktop notifications.
- Separate file-backed libSQL databases for Mastra snapshots/memory and application state.

## Run it

```bash
npm install
npm run dev
```

`npm run dev` starts Electron, which owns a private Mastra development worker. Electron and Mastra both reload during development; the same worker-supervision boundary is used in the packaged app.

On first run, open **Gadgets → AI provider**, choose OpenAI, Anthropic, Google, or Ollama Cloud, select a model, and enter your own API key. Before saving it, the app verifies the installed Ledger, Nudge, Mirror, and Shield structured-output contracts. Chat and every intelligence workflow require this connection. If AI is unavailable, the mission stops visibly; Sydekyks do not substitute a manual rules workflow and call it intelligence.

## Test the Ledger workflow

1. Connect an AI provider under **Gadgets**.
2. In a development build, open **Mission Control**, select **New Ledger mission**, and load **Missing vendor + approval**. The synthetic workbench is intentionally absent from customer builds.
3. Review the prefilled bill.
4. Change the invoice number if you already used the example, then select **Send to Ledger**.
5. Review the approval card and choose **Decline**, **Allow once**, or **Allow & remember**.
6. Expand the completed mission to inspect every check and the planned Odoo payload.
7. Use **Existing vendor example** and enable **Create the draft** to create and verify a record in the isolated demo Gadget.
8. Use **Missing tax + approval** to exercise the permission-gated accounting-configuration path.

### Send a bill through Chat

1. Connect an AI provider, then open **Chat**.
2. Select the paperclip or drag a PDF, PNG, or JPEG onto the composer. You may add a short note before sending.
3. Ledger stores the original locally, extracts available PDF text locally, and uses the configured model to decide whether the document is a bill and extract its fields.
4. Review or correct the inline fields. Leave draft creation off for a dry-run, or explicitly enable it.
5. Select **Send verified bill to Ledger**. From this point, Chat and email use the same duplicate checks, accounting intelligence, approvals, Odoo workflow, and read-back verification.

Chat accepts up to five documents per send, with a 15 MB limit per file. Image-only and scanned documents require a model with compatible visual/file input. A known text-only model can still use selectable PDF text or a sufficiently detailed attachment note; otherwise Ledger stops visibly and lets you retry after changing the AI Gadget.

Dry-run is the default. In live mode, a draft is written only when live writes are enabled on the Gadget and the individual workflow confirms the write.

## Test inbound email

1. Connect an AI provider under **Gadgets**.
2. Open **Gadgets → Email inbox** and select **Process sample email**. No mailbox credentials are required for the sample.
3. Open **Mission Control** and review the AI bill classification, confidence, evidence, extracted fields, and local attachment metadata.
4. Select **Send verified bill to Ledger**.
5. When Ledger needs to create a vendor or tax, approve or decline from either Mission Control or the matching card above the Chat composer.
6. Inspect the completed mission. The inbound-email record is reconciled to the same Ledger run.
7. If the run fails or an approval is declined, reopen the email review, correct the normalized fields, and retry the same email through a new idempotent Ledger run.

For a real mailbox, enter its IMAP host, port, username, password or app password, source mailbox, and processed mailbox under **Gadgets → Email inbox**. After **Test & save securely**, Sydekyks polls for new messages while the app is running. **Sync now** retries immediately, even after a temporary connection failure. Successfully completed messages are moved to the processed mailbox when the server supports it. The built-in sample is a multipart email with a local text attachment, so it exercises the same MIME attachment path without mailbox credentials.

Ledger's **Roster** card controls inbound verification independently of other Sydekyks:

- **Always verify** — every extracted bill waits for the user in Mission Control.
- **Only when uncertain** — a complete vendor bill can continue automatically when the document and every required field meet the configured confidence threshold and there are no warnings.
- **Automatic** — a schema-valid vendor bill continues automatically. Missing facts, credit notes, non-bills, invalid totals, protected configuration, and failed writes still stop in Mission Control or at an approval gate.

Automatic handoff sets `confirmWrite` for the draft request, but it does not bypass the Odoo Gadget's live-write switch, missing-vendor/tax approvals, duplicate checks, or read-back verification.

## Test Nudge and automations

1. Connect an AI provider under **Gadgets**. The demo Odoo Gadget includes sample CRM opportunities, activities, and messages.
2. Open **Roster → Nudge** and choose **Set schedule**, or open **Mission Control → Automations**.
3. Choose **Run Nudge now** to exercise the same `nudge-stale-opportunities` workflow used by scheduled and chat-initiated checks.
4. Create a daily, weekday, weekly, or every-N-days automation. The preview shows its local cadence, timezone, and next run.
5. Pause, resume, edit, or run the automation on demand. Every run appears under **Mission Control → Activity**.
6. In Chat, ask Syd to check the pipeline now or propose a recurring Nudge schedule. Conversational schedules are saved as drafts and require activation in Mission Control.
7. Ask Syd to list existing automations or remove one by name. Syd resolves current Nudge, Mirror, and Shield records and shows the exact deletion set; nothing is removed until you approve the Chat card.

Nudge has read-only access to `crm.lead`, `mail.activity`, and `mail.message`. Deterministic code gathers and bounds those facts, partitions larger CRM contexts into bounded batches, and validates that the model assessed every supplied opportunity exactly once. The configured model decides which opportunities genuinely need attention and explains why. If AI is unavailable, the mission stops visibly instead of substituting a date-only rule.

## Test Mirror and Shield

1. Connect an AI provider. The demo Odoo Gadget includes duplicate-like bills, split vendor records, and vendor-master change history.
2. Open **Mission Control → Automations** and select **Mirror** or **Shield** from the specialist control.
3. Use **Run once** to invoke the same named workflow used by Chat and recurring schedules.
4. For Mirror, inspect each screened pair, AI verdict, confidence, evidence, and recommended action.
5. For Shield, follow the visible **Watch**, **Assess**, **Rank**, and **Brief** phases, then inspect the risk-ordered evidence cards.
6. Create a schedule if desired. Editing a paused schedule preserves its paused state; Chat-created schedules remain drafts until activated in Mission Control.

Mirror and Shield can read only the Odoo models declared in their manifests and cannot create or modify bills, vendors, payments, or configuration. Code gathers facts and validates model-selected record IDs; the configured model performs the duplicate and risk judgments. If either intelligence pass fails, the mission stops visibly rather than producing a rules-only result.

### Test the real IMAP path locally

GreenMail provides an isolated SMTP/IMAP server with five preloaded fixtures: three vendor bills, one attachment redelivered under another message ID, and a non-bill. The extra bills exercise both confident and uncertain verification-policy decisions.

```bash
npm run test:imap:up
```

Configure the Email inbox Gadget with host `127.0.0.1`, port `3143`, username `ledger`, password `sydekyks`, TLS off, source mailbox `INBOX`, and processed mailbox `Sydekyks/Processed`. Connect an AI provider, select Ledger's inbound policy in **Roster**, and choose **Sync now**. Stop and remove the disposable server with `npm run test:imap:down`.

## Connect Odoo

1. Open **Gadgets → Odoo → Live Odoo**.
2. Enter the Odoo URL, database, username, and API key or password.
3. Optionally enter a company ID.
4. Leave live writes disabled for the first connection test.
5. Select **Test & save securely**.

Electron encrypts AI, Odoo, and IMAP credential payloads with the operating system's secure storage. The encrypted files live in Electron's user-data directory. Secrets are sent only to the local Mastra process, held in memory there, never returned to the renderer, never placed in model context, and never stored in libSQL.

## Internal Odoo Gateway

Specialized Odoo capabilities reuse the internal generic Gateway, so a new Sydekyk can perform validated integration operations before a bespoke adapter exists. The Gateway remains capability-bound, schema-validated, approval-aware, and audited. It is invoked by agents and workflows, not exposed as a manual product surface, and it never replaces model judgment.

## Feature-first Sydekyk modules

Ledger, Nudge, Mirror, and Shield are each contained under `src/mastra/sydekyks/<id>/`: manifest, conversation agent, internal intelligence agent, delegation tool, service, tools, and workflows. Shared bounded accounts-payable fact collection lives under `src/mastra/sydekyks/shared/`; Odoo, IMAP, storage, documents, and the semantic automation scheduler remain outside individual Sydekyks because they are reusable platform/Gadget infrastructure. The registry supplies Roster metadata, least-privilege grants, required Gadgets, triggers, and declared intelligence moments.

The required [Sydekyk authoring guide](docs/intelligence-first-authoring.md) also covers the cross-surface integration learned from the first installed roster: isolated Chat sessions, typed Odoo record links, domain-type compatibility, progressive Mission Control reports, acknowledgeable notifications, non-blocking Gadget restore, and equivalent-automation detection.

## Local data

The Electron app creates runtime data under its platform-specific `userData/runtime` directory:

- `sydekyks-mastra.db` — Mastra memory and workflow snapshots.
- `sydekyks-app.db` — Mission Control records, automations, Gadget status, and permissions.
- `documents/` — original chat and non-inline email documents, named by content hash.
- `inbound-email/` — original MIME messages retained for reanalysis and audit.

Electron takes a bounded startup backup of existing databases before opening them. `SYDEKYKS_DATA_DIR` is available only for standalone development and automated tests; the desktop app always supplies its per-user path. AI, Odoo, and IMAP credentials are deliberately stored outside these databases through Electron `safeStorage`. Email, notes, and document text are treated as untrusted and bounded before analysis. Originals remain on the local filesystem; extracted text, or required image/PDF bytes for visual analysis, are sent only to the configured provider. Do not enable document analysis when the selected provider's data policy does not meet your requirements.

Owner-only rotating JSONL diagnostics are stored under `userData/logs` as `desktop.jsonl` and `worker.jsonl`. They record lifecycle, authenticated route, mission, updater, and failure events without request bodies or credential fields.

## Build a release candidate

Local audit builds intentionally have no update feed and may be unsigned. External builds use `electron-builder.release.yml`, require an HTTPS `SYDEKYKS_UPDATE_URL`, fail when macOS/Windows signing is absent, and enable macOS notarization. Set credentials only in the environment or CI secret store, then run `npm run release:mac`, `npm run release:win`, or `npm run release:linux`. Upload the generated artifacts and `latest*.yml` metadata together to the configured generic update host.

## Commands

- `npm run dev` — start Mastra and Electron with automatic reload.
- `npm run format` — format project files.
- `npm run lint` — run ESLint.
- `npm run typecheck` — typecheck Electron, renderer, and Mastra.
- `npm run build` — typecheck and build the production Mastra worker and Electron renderer.
- `npm run build:unpack` — build an unpacked desktop application.
- `npm run test:smoke:worker` — verify loopback authentication, empty first run, and clean shutdown.
- `npm run test:logging` — verify rotating owner-only JSONL and credential redaction.
- `npm run test:recovery` — snapshot, mutate, restore, and reopen both durable databases.
- `npm run test:mirror-types` — prove vendor bills and credit notes remain in compatible duplicate-screening pools.
- `npm run test:mission-notifications` — prove clearing an alert does not resolve its mission and reopened attention becomes visible again.
- `npm run test:ai-restore` — prove stored AI credentials restore locally without a provider request.
- `npm run test:automation-dedup` — prove equivalent conversational schedules create nothing until an overlap is explicitly confirmed.
- `npm run test:functional` — run the live-AI chat, document, Ledger, restart, Nudge, Mirror, Shield, and multi-Sydekyk automation matrix.
- `npm run test:functional:greenmail` — add the Docker-backed five-message IMAP matrix.
- `npm run test:live:stored-connections` — securely reuse stored throwaway credentials for a read-only live Odoo Nudge pass.
- `npm run test:package` — audit the unpacked archive for required runtime files and development-data leaks.
- `npm run test:smoke:packaged-worker` — run the worker from inside the packaged `app.asar`.
- `npm run test:smoke:packaged-app` — verify the packaged renderer, preload sandbox, CSP, and private service.
- `npm run test:imap:up` / `npm run test:imap:down` — start or remove the disposable GreenMail fixture server.
- `npm run release:mac` / `release:win` / `release:linux` — validate signing/update inputs and build an external release candidate.

The complete system design and future phases are in [docs/architecture.md](docs/architecture.md). Distribution blockers are tracked in [docs/launch-readiness.md](docs/launch-readiness.md). New Sydekyks and workflows must follow [docs/intelligence-first-authoring.md](docs/intelligence-first-authoring.md).
