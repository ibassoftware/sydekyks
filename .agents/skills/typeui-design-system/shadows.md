# Shadows

| Token | CSS value |
|---|---|
| shadow-2xs | `0 1px rgb(113 199 197 / 0.05)` |
| shadow-xs | `0 1px 2px 0 rgb(113 199 197 / 0.08)` |
| shadow-sm | `0 1px 3px 0 rgb(113 199 197 / 0.12), 0 1px 2px -1px rgb(113 199 197 / 0.08)` |
| shadow-md | `0 4px 6px -1px rgb(113 199 197 / 0.15), 0 2px 4px -2px rgb(113 199 197 / 0.1)` |
| shadow-lg | `0 10px 15px -3px rgb(113 199 197 / 0.15), 0 4px 6px -4px rgb(113 199 197 / 0.1)` |
| shadow-xl | `0 20px 25px -5px rgb(113 199 197 / 0.15), 0 8px 10px -6px rgb(113 199 197 / 0.1)` |
| shadow-2xl | `0 25px 50px -12px rgb(113 199 197 / 0.3)` |

## Component Mapping

| Component type | Token |
|---|---|
| Subtle separators, tiny UI details | shadow-2xs or shadow-xs |
| Inputs, buttons, small controls, lightweight cards | shadow-xs or shadow-sm |
| Standard cards, popovers, dropdowns | shadow-md |
| Prominent cards, sticky surfaces | shadow-lg |
| Modals, high-priority overlays | shadow-xl |
| Hero overlays, top-level emphasis (sparingly) | shadow-2xl |

## Rules

- Use only these tokens — no custom box-shadow values
- Keep elevation steps intentional; avoid jumping multiple levels
- Components in the same family share the same baseline elevation
- Hover/focus on interactive elevated elements: step up by one level
- Never stack multiple shadow tokens on one element
- Never use shadow-xl/shadow-2xl for dense list items or body containers
