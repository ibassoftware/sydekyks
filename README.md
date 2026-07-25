# Sydekyks Desktop

Sydekyks is a local-first Electron command desk. **Syd** is the single user-facing Mastra agent.
Business specializations are versioned **Sidekick skills**, not separately coded agents.

## Architecture

- **Syd runtime** — one agent, persistent local chat memory, and a shared tool surface.
- **Sidekick skills** — Markdown instructions loaded dynamically with Mastra `createSkill()`.
- **Ledger** — the one retained sealed workflow for vendor-bill intake, accounting checks,
  suspend/resume approvals, and draft verification.
- **Odoo Gadget** — metadata discovery plus generic read/create/update/archive operations for
  standard and custom models.
- **Capabilities** — exact Sidekick + Odoo entity + operation grants. Skills cannot grant
  themselves access.
- **Automations** — declarative Sidekick + pinned version + prompt + trigger data. Triggers can be
  manual, scheduled, or inbound email. No application source code is generated at runtime.

The effective authority for a write is the intersection of:

1. the connected Odoo user’s ACLs;
2. the Gadget’s live-write setting;
3. an approved Sidekick entity capability;
4. the automation scope, when applicable;
5. the write tool’s explicit user approval.

Generic deletion is intentionally unsupported.

## Preset and user-created Sidekicks

Nudge, Mirror, and Shield are preload skills under `skills/*/SKILL.md`. The build syncs these
Markdown sources into a generated seed module so packaged workers do not depend on development
paths. At first run, the presets are stored in local SQLite and exposed to Syd dynamically.

Users can ask Syd to create or update a Sidekick through chat. Instruction changes create an
immutable new version. Capabilities are stored separately, so changing Markdown never grants more
authority. Automations pin both a Sidekick version and its capability fingerprint; a drift pauses
execution for review and re-pinning.

## Odoo access

Syd first discovers a friendly business entity from `ir.model`, then reads its live `fields_get`
metadata. The same path works for standard entities and unknown custom modules. The demo Gadget
includes `x_rental.contract` as a custom-model regression fixture.

The generic write tool:

- supports create, update, and archive;
- validates the selected entity through discovery;
- rejects missing and read-only fields from live metadata;
- requires an exact Sidekick capability;
- always uses the native chat approval flow;
- records an auditable Mission Control receipt;
- still defers to Odoo ACLs and the live-write switch.

Ledger keeps its specialized vendor-bill workflow because its multi-step accounting and durable
approval semantics are materially stronger than a generic write.

## Automations

Automations are validated records, not generated TypeScript:

```text
Sidekick ID + pinned version
Business instruction
Manual | schedule | email trigger
Read-only | interactive-approval policy
Missed-run policy
Capability fingerprint
```

The Mastra dispatcher workflow checks due schedule triggers every minute. Email triggers are matched
after deduplicated IMAP ingestion. Background read-only runs may inspect Odoo; writes remain subject
to interactive approval and therefore cannot silently mutate records.

Legacy Nudge, Mirror, and Shield schedules are migrated once into generic read-only automation specs.
The legacy table is left untouched for rollback compatibility, but no runtime code depends on it.

## Run locally

```bash
npm install
npm run dev
```

Open **Gadgets** to connect an AI provider and Odoo. Demo Odoo is enabled by default. Open
**Sidekicks** to inspect active skill versions and approved capabilities. Create and manage
Sidekicks or automations by asking Syd in chat.

Examples:

- “Use Nudge to review open opportunities.”
- “Create a Sidekick called Renewals that reviews contracts approaching renewal.”
- “Grant Renewals permission to update Rental Contracts.”
- “Every weekday at 9, use Renewals to summarize contracts due within 60 days.”
- “Check my inbox once a day and have Ledger prepare confident vendor bills as Odoo drafts.”
- “Create follow-up activities for these opportunities and assign them to MW tomorrow.”

For the last example, Syd must discover what “MW” resolves to in the connected Odoo, inspect the
activity entity and required relationships, obtain the exact capability, and show the write preview
for approval.

## Ledger document intake

PDF and image bills can be attached in chat. IMAP can also ingest messages while the app is running.
Ledger classifies and extracts the document, checks duplicates and accounting context, then prepares
a draft. Missing partner and purchase-tax configuration retain durable sequential approvals. Ledger
never posts, pays, reconciles, or deletes.

Email-to-bill intake is configured separately from generic Sidekick automations. Ask Syd to inspect
the Ledger inbox, choose the check interval (`1440` minutes means once per day), and select one of
three review policies: review every bill, automatically prepare only complete/confident drafts, or
automatically prepare every complete item classified as a vendor bill. Changing this policy requires
native chat approval and creates a Mission Control receipt.

## Local data and credentials

Runtime state is stored beneath Electron’s per-user data directory:

- `sydekyks-mastra.db` — Mastra memory and workflow snapshots;
- `sydekyks-app.db` — Sidekicks, versions, capabilities, automations, missions, and Gadget state;
- `documents/` and `inbound-email/` — local source documents retained for review.

AI, Odoo, and IMAP credentials are encrypted separately with Electron `safeStorage`. Secrets are not
returned to the renderer or stored in SQLite. Structured JSONL logs omit request bodies and
credentials.

## Important commands

- `npm run skills:sync` — validate and compile preset Markdown skills.
- `npm run dev` — run Electron and its private local Mastra worker.
- `npm run typecheck` — check Electron, renderer, and Mastra TypeScript.
- `npm run lint` — run ESLint and formatting checks.
- `npm run build` — sync skills and build production Mastra/Electron output.
- `npm run test:sidekicks` — verify the dynamic-skill, capability, CRUD, and trigger architecture.
- `npm run test:syd-odoo-read` — verify metadata-driven Odoo discovery and gated writes.
- `npm run test:recovery` — verify durable database-set backup and restore.
- `npm run test:smoke:worker` — verify private loopback auth and worker lifecycle.
- `npm run test:functional` — run the live-AI document, Ledger, dynamic Sidekick, and automation
  matrix.
- `npm run build:unpack` — create an unpacked desktop audit build.

See [docs/architecture.md](docs/architecture.md) for system boundaries and
[BUILD_REPORT.md](BUILD_REPORT.md) for the current auditor handoff and production readiness.
