# Sydekyks UI and Color System

## Source of truth

All new or changed Sydekyks UI follows the TypeUI workspace project **Sydekyks**, using its `dithered` package.

| Field | Value |
|---|---|
| TypeUI project | Sydekyks |
| Workspace | rein's workspace |
| Template/design slug | `dithered` |
| Design-system ID | `60e92ca6-8dc9-4a04-8b0e-15ec38dc49b6` |
| Local fundamentals | `.agents/skills/typeui-fundamentals` |
| Local design package | `.agents/skills/typeui-design-system` |
| Token implementation | `frontend/src/index.css` |
| Shared primitives | `frontend/src/components/ui.tsx` |

The TypeUI fundamentals and design package are binding requirements, not optional inspiration. When they conflict, accessibility and interaction safety win; concrete visual values then come from the active design package.

## Visual character

The interface is a high-contrast, dithered-neon system inspired by early computing:

- deep navy surfaces, not brown or pure black;
- teal/cyan as the sole primary brand family;
- Space Grotesk throughout the application;
- uppercase outlined headings with teal fill and near-white stroke;
- 2px component borders and 4px default radii;
- restrained teal elevation shadows and button glints;
- ordered-dither treatment for atmospheric marketing imagery, with scanline overlays;
- dot grids, ruled grids, and hatched section dividers used for hierarchy;
- one dark section surface across a page, with deeper inset panels rather than alternating light sections.

## Dark palette

| Role | Token | Value | Intended use |
|---|---|---:|---|
| Page | `neutral-primary` / `ink-950` | `#060A12` | Main background |
| Soft surface | `neutral-primary-soft` / `ink-900` | `#080D16` | Cards, navigation, inset surfaces |
| Raised surface | `neutral-secondary-medium` / `ink-800` | `#0E1524` | Controls and hover surfaces |
| Strong surface | `neutral-tertiary-medium` / `ink-700` | `#1A2640` | Selected and emphasized surfaces |
| Heading | `heading` | `#F0F5FA` | Text stroke and high-priority UI text |
| Body | `body` | `#8A9BB5` | Paragraphs, metadata, supporting text |
| Brand | `brand` / `gold-500` | `#71C7C5` | Primary controls and decorative accents |
| Brand foreground | `gold-300` | `#9DDCDB` | Brand links and labels on dark surfaces |
| Brand inset | `brand-softer` | `#0C2424` | Compact brand badges and icon wells |
| Success | `success` | `#00CC88` | Ready/healthy status indicators and borders |
| Success inset | `success-soft` | `#002C22` | Ready/healthy status surfaces |
| Warning | `warning` | `#FF8C42` | Setup and readiness warnings |
| Warning inset | `warning-soft` | `#7C2D12` | Setup-warning status surfaces |
| Accessible boundary | `line` / `ink-600` | `#596B85` | Meaningful component boundaries |

Legacy `gold-*` names remain temporarily mapped to the teal TypeUI family to keep the migration safe for untouched screens. New UI should prefer semantic names (`brand`, `heading`, `body`, `surface`, `line`). No new raw hex/RGB values belong in component JSX.

## Measured contrast

Ratios are calculated from the actual dark tokens, not estimated visually.

| Pair | Ratio | Requirement |
|---|---:|---|
| Heading `#F0F5FA` on page `#060A12` | 18.06:1 | Passes normal text AA/AAA |
| Body `#8A9BB5` on page `#060A12` | 7.02:1 | Passes normal text AAA |
| Body `#8A9BB5` on soft surface `#080D16` | 6.89:1 | Passes normal text AA |
| Brand foreground `#9DDCDB` on page `#060A12` | 12.92:1 | Passes normal text AAA |
| Page text `#060A12` on brand button `#71C7C5` | 10.07:1 | Passes normal text AAA |
| Accessible boundary `#596B85` on page `#060A12` | 3.65:1 | Passes non-text AA |

The original TypeUI dark border token is intentionally raised along the same blue-gray family for meaningful component outlines because the unadjusted value did not meet the 3:1 non-text threshold on the page surface.

## Component rules

- Buttons: 4px radius, 2px border, 44px minimum height, Space Grotesk medium label, full hover/focus/disabled contract.
- Cards: soft navy surface, 2px accessible border, 4px radius, TypeUI shadow token. Static cards do not gain hover behavior.
- Badges: 2px radius (not pills by default), 2px border, 12–14px medium label.
- Tabs: underline treatment with a 3px active brand border, semantic `tablist`/`tab`, and `aria-selected`.
- Images: atmospheric marketing photography may use the TypeUI high-contrast teal dithering and scanline treatment. **Agent/Sydekyk portraits are identity assets and must render in their original colors without grayscale, tint, dithering, blend modes, or scanline overlays.** Icons and logos are also never dithered.
- Layout: mobile-first, 8px rhythm, 24px container gutters, 1152px page container, 96px desktop section padding, and three visible spacing tiers.
- Links: inline prose links are underlined; navigation and button-role links are not.
- Agent identity names (for example Nudge, Quill, and Ledger) use solid, mixed-case Space Grotesk in the heading color. They do not use the outlined uppercase display-heading treatment because recognition and name legibility take priority.
- Operational readiness always combines text with color: `Standing ready` uses the success family, `Mission underway` uses a pulsing brand treatment, and blocked/setup states use the warning family. The readiness strip occupies one fixed location in every dashboard agent card. A blocked agent shows a setup explanation instead of a dead primary action.
- Dashboard commands are agent-specific: upload surfaces for intake agents, run controls for scheduled scanners, and creation controls for document workbenches. Avoid generic `Run agent` or repeated `Open [name]` labels.
- The HQ command-center canvas uses a token-driven atmospheric background: a restrained brand glow, a very low-opacity warning halo, and one 40px ruled-grid pattern. Data cards stay opaque enough to preserve measured contrast; decoration never carries state.
- The roster uses compact business-unit cards with uncropped, unfiltered identity portraits, solid mixed-case names, explicit duty states, and separate navigation/action controls. It does not turn the whole card into a nested interactive target.
- Operational attention is a Missions view, not a separate visual system. Configuration blockers and review Missions share one chronological card stream, with a text badge identifying the record type. Long filenames, vendor names, emails, and action rows must wrap; the attention surface must never require horizontal page scrolling.
- Every active agent detail uses the same two-tab contract: **Actions** contains day-to-day commands and Recent Missions; **Settings** contains AI engine, integrations, reviewer assignment, playbook, and agent configuration. Use-only Heroes never mount Settings, while configure-enabled Heroes and Commanders receive both tabs. The API enforces the same boundary on reads and writes.
- Mission rows use a semantic left status rail plus a written status, readable 16px titles, grouped source/date/duration metadata, and a compact AI footprint (`tokens`, `capacity`, model calls). Expanded outcomes, decisions, failures, and execution steps occupy visually distinct inset regions. Color never carries status alone.
- Repeated operational lists use explicit pagination or a **Load more** control. Review queues prefer Load more over infinite scroll so operators retain position and know how much work remains.
- Roster, Missions, Utility Belt, Team, and Settings share the restrained HQ command background. Cards remain opaque and bordered; the atmospheric canvas is hierarchy, never information.

## Acceptance checklist

Before shipping UI changes:

1. Read the TypeUI fundamentals guardrails and every relevant component module.
2. Fetch the matching TypeUI MCP prompt/specification when available.
3. Use semantic tokens and derive dependent values; do not introduce arbitrary colors, radii, or shadows.
4. Measure every new foreground/background and meaningful boundary combination.
5. Verify keyboard flow, visible focus, target sizing, all control states, 200% text resize, and 320px reflow in rendered output.
6. Verify motion-reduced behavior and confirm no state depends on color alone.
7. Keep the architecture and this document synchronized when the active TypeUI workspace package changes.
