# Shadows

## Intent
Depth should feel atmospheric, not heavy.

## Tokens
- `shadow-xs`: 0 2px 10px rgba(0, 0, 0, 0.22)
- `shadow-sm`: 0 10px 24px rgba(4, 8, 15, 0.30)
- `shadow-md`: 0 18px 40px rgba(2, 6, 14, 0.42)
- `glow-accent`: 0 0 0 1px rgba(143, 180, 255, 0.25), 0 0 24px rgba(143, 180, 255, 0.16)

## Rules
- Combine one depth shadow with one soft highlight, never stack 3+ heavy shadows.
- Hover elevation must remain under 10px vertical offset to avoid floating artifacts.

