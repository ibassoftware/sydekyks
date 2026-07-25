# Colors

## Intent
A premium, ultra-dark palette built on pure black bases, high-clarity white text, and selective accent warmth for call-to-action emphasis.

## Core Tokens
- `bg.base`: #0a0a0a
- `bg.elevated`: #0a0a0a
- `bg.panel`: #0a0a0a
- `bg.panel-soft`: rgba(10, 10, 10, 0.78)
- `text.primary`: #ffffff
- `text.secondary`: #a1a1aa
- `text.muted`: #71717a
- `border.default`: rgba(255, 255, 255, 0.10)
- `border.strong`: rgba(255, 255, 255, 0.20)
- `primary`: #F9A474
- `accent.primary`: #F9A474
- `accent.secondary`: #c3a3ff
- `accent.success`: #59d9a6
- `accent.warning`: #f4bf63
- `accent.danger`: #ff7d8b

## Usage Rules
- Large surfaces and cards must use the flat `#0a0a0a` background to create a seamless, premium look.
- Primary text must keep maximum contrast against all panel backgrounds.
- Accent colors should highlight interaction, stats, and key claims only.
- The primary website and brand CTA color must always resolve to `primary` (`#F9A474`).
- Avoid using more than two accent families in one viewport section.

## Gradients
- Hero ambient: radial accent bloom over `bg.base`.
- Card glow: cards share the exact same background as the canvas (`#0a0a0a`), relying entirely on crisp borders (`border.default`) and subtle hover glows for definition.

