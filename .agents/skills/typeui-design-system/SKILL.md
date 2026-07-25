---
name: "bento"
description: "Sydekyks-Bento design skill for AI coding agents."
metadata:
  author: typeui.sh
  source: workspace-importer
  projectName: "Bento"
  projectLogoUrl: ""
  importSource: "Manual TypeUI setup"
  primaryColorReference: "#18181b"
  surfaceColorReference: "#ffffff"
  textColorReference: "#09090b"
  typographyScale: "Inter-style sans serif, 12/14/16/20/24/32 scale, medium labels, semibold headings."
  spacingScale: "4px base grid with 8px, 12px, 16px, 24px, and 32px layout steps."
  radiusScale: "6px controls, 8px cards, 12px overlays, nested radii reduced by inner padding."
---

# Design System - Bento Pro

This skill defines a premium bento-oriented interface language inspired by the `hen-ry.com` benefits experience: dark-first, editorial typography, asymmetric card mosaics, subtle glow layers, and conversion-focused messaging.

## Before Writing Any Code

1. Read every module that applies. For landing pages, start with `layout.md`, `content.md`, `typography.md`, `colors.md`, `cards.md`, and `buttons.md`.
2. Confirm global tokens exist in `globals.css` before creating components.
3. Use semantic HTML and keyboard-safe interactions by default.

## Critical Rules

- **Brand color precedence:** When `brand.md` is available, color tokens from `brand.md` overwrite same-name tokens in `colors.md`.

- **Tokens are AGNOSTIC, NOT Tailwind classes:** The tokens defined in the `.md` files (like `neutral-primary-soft`, `heading`, `border-default`) are agnostic design system tokens, NOT literal Tailwind classes. Do not blindly use classes like `bg-neutral-primary-soft` unless you have explicitly mapped them in the CSS/Tailwind configuration. You must implement the mapping yourself.

- Bento layout is the baseline pattern, not a decorative add-on.
- Cards must feel tactile: soft borders, layered surfaces, and controlled hover lift.
- Keep copy compact, confident, and outcome-oriented.
- Every interactive element must define default, hover, focus-visible, active, and disabled states.
- Respect reduced-motion preferences for all animated reveals.

## Module Index

### Foundation (read first for any UI work)
- [brand.md](brand.md) — Brand
- [colors.md](colors.md) — Color
- [typography.md](typography.md) — Typography
- [layout.md](layout.md) — Layout
- [radius.md](radius.md) — Radius
- [shadows.md](shadows.md) — Shadow
- [borders.md](borders.md) — Borders

### Components
- [content.md](content.md) — Content
- [buttons.md](buttons.md) — Button
- [button-group.md](button-group.md) — Button Group
- [cards.md](cards.md) — Card
- [inputs.md](inputs.md) — Input
- [alerts.md](alerts.md) — Alert
- [badges.md](badges.md) — Badge
- [lists.md](lists.md) — List
- [avatars.md](avatars.md) — Avatar
- [icon-shapes.md](icon-shapes.md) — Icon Shape
- [accordion.md](accordion.md) — Accordion
- [dropdown.md](dropdown.md) — Dropdown
- [modals.md](modals.md) — Modal
- [tabs.md](tabs.md) — Tabs
- [tables.md](tables.md) — Table
- [pagination.md](pagination.md) — Pagination
- [sidebars.md](sidebars.md) — Sidebar
- [radios-checkboxes-toggle.md](radios-checkboxes-toggle.md) — Radio, Checkbox, Toggle
- [tooltips-popovers.md](tooltips-popovers.md) — Tooltip, Popovers
- [hero.md](hero.md) — Hero
