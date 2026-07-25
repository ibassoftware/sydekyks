# Cards

> Dependencies: `colors.md`, `radius.md`, `shadows.md`, `typography.md`

## Core Specs
- Background: exact same shade as the base canvas (`bg.panel` which is `#0a0a0a`)
- Border: 1px `border.default` (crisp, subtle line)
- Radius: 32px desktop, 20px mobile
- Shadow: none by default, rely on borders for a flat, premium look
- Padding: 28px desktop, 22px tablet, 18px mobile

## Bento Tiers
- Primary card: large headline, supporting proof, optional media.
- Secondary card: concise claim + icon/metric.
- Utility card: metadata, tags, mini CTA.

## Interactive State
- Hover: lift 4px, border to `border.strong`, glow increases slightly.
- Focus-visible: 2px accent outline with 3px offset.
- Disabled: no lift, reduced contrast, muted text.

## Rules
- Do not flatten all cards to identical visual weight.
- Keep card content vertically balanced with clear top and bottom anchors.

