# Modals

## Intent
Modals isolate high-priority tasks without breaking the bento visual language.

## Frame
- Max width: 560px standard, 760px wide
- Radius: `radius-xl`
- Background: layered panel with soft highlight
- Backdrop: dark blur at 60-72% opacity

## Behavior
- Trap focus while open.
- Close on Escape unless task is destructive-critical.
- Animate scale/opacity subtly, then stop.

## Rules
- Keep one primary action and at most one secondary action.
- Avoid long-form content that exceeds viewport height without internal scroll.

