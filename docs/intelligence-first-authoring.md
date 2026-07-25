# Sidekick authoring guide

## Choose the smallest extension

Use a **Sidekick skill** when the change is business guidance: how to review records, what evidence
matters, how to explain uncertainty, or which follow-up to recommend.

Use a **friendly helper** when a repeated task benefits from a concise business recipe over generic
Odoo tools. A helper must remain optional and call the metadata-driven layer; it must not become a
hardcoded model boundary.

Use a **sealed workflow** only when the process needs durable, multi-step orchestration that cannot be
safely reconstructed from a prompt—for example, Ledger’s sequential approvals and post-write
verification.

## Skill requirements

Preset skills use the Agent Skills folder format:

```text
skills/
  renewals/
    SKILL.md
```

`SKILL.md` requires:

```yaml
---
name: renewals
description: Review contracts approaching renewal and recommend timely action.
---
```

The body should explain:

- when the skill applies;
- the source facts to inspect;
- the reasoning or review sequence;
- how to distinguish fact from inference;
- actions the skill may recommend;
- actions that remain prohibited or approval-gated.

Do not embed secrets, production record IDs, Odoo credentials, fixed user IDs, or claims of tool
authority. Prefer friendly business terms. Instruct Syd to discover entities and fields rather than
assuming standard technical names.

Run `npm run skills:sync` after editing a preset.

## Dynamic creation

User-created Sidekicks are built through Syd chat with the same fields: name, description, and
Markdown instructions. Creation and updates require native approval. Every instruction change
creates a new immutable version.

Sidekick instructions never include capabilities. Capabilities are separate records approved for an
exact Odoo entity and operation.

## Odoo use

For an Odoo task, a skill should direct Syd to:

1. discover the entity from the user’s language;
2. inspect live fields and relationships;
3. resolve references such as owners, companies, and activity types from Odoo;
4. read only bounded relevant facts;
5. prepare a friendly write preview when asked;
6. obtain an exact capability before write execution.

Create, update, and archive are supported. Delete is not.

## Automation use

An automation stores the Sidekick ID/version, business prompt, trigger, approval policy, and
capability fingerprint. It must not contain arbitrary code. Default new automations to draft and
read-only unless the user explicitly requests activation or an interactive write policy.

Scheduled and email runs stop when the Sidekick version or capability scope drifts.

## Validation checklist

- Skill frontmatter passes `npm run skills:sync`.
- Description clearly distinguishes when this skill should activate.
- The skill uses discovery rather than fixed Odoo model assumptions.
- Facts, inference, and uncertainty remain distinct.
- No capability is implied by instructions.
- Write behavior is compatible with preview, approval, and audit controls.
- A custom-model fixture or test proves the guidance is not standard-module-only.
- `npm run test:sidekicks`, type checks, lint, build, and worker smoke pass.
