# Layout & Spacing

## Spacing Rhythm

Base unit: **8px**. All spacing values should be multiples of 8px.

| Context | Value |
|---|---|
| Section vertical padding | 96px |
| Section header → content | 48px or 64px |
| Heading → paragraph | 16px |
| Container horizontal padding | 24px |
| Flex/grid row gap | 16px |
| Card grid gap | 24px |
| Wide component grid gap | 32px |
| Column layout gap | 48px |

## Container

Standard section container: max-width 1152px, centered, 24px horizontal padding.

Every major section wraps content in this container.

## Content Composition Order

Inside each section, follow this order:
1. Heading (`h1`–`h3`)
2. Leading paragraph
3. Normal paragraph(s)
4. Lists, CTA links, or component grids

## Section Pattern

Each section has:
- 96px vertical padding
- **Background color: dark (`#0E1524`)** — all sections use the same dark background. Do **not** alternate section backgrounds. Use a deeper dark tone only for cards, navs, or inset panels that need extra contrast against the section.
- A centered container (max-width 1152px, 24px horizontal padding)
- A section header area with 48px bottom margin
- Section content below

## Motion & Animation

- Prefer CSS-native: `transition`, `animation`, `@keyframes`. Use Motion library only when CSS cannot achieve the behavior.
- Prioritize high-impact orchestrated moments over scattered micro-interactions. A single well-sequenced page-load animation using staggered `animation-delay` delivers more perceived quality than many isolated effects.
- Reserve scroll-triggered and hover transitions for moments that reinforce hierarchy or reward attention.

## Backgrounds & Visual Depth

- Default to layered, atmospheric dark backgrounds that create a deep, immersive feel.
- Apply contextual treatments — noise/grain textures, dithered overlays, geometric patterns, neon glow effects, layered transparencies, dramatic neon-tinted shadows, hard-edge borders — that align with the dithered neon aesthetic.
- Every decorative element must serve a compositional purpose (depth, separation, or emphasis). No purely ornamental effects competing with content.

## Dithered Image Effect

**Every image** used in landing pages, websites, or apps built with this design system **must have a dithered visual effect applied**. Always use **real photographs** — never generate SVG/canvas placeholder art for people, products, or scenery.

### Dithering method

Use an ordered Bayer-matrix dithering algorithm (8×8 threshold map). The implementation can be an SVG filter, a canvas/WebGL shader, or pre-processed assets — choose whatever fits the stack.

### Image treatment variants

| Variant | When to use | Visual description |
|---|---|---|
| Hero / background | Full-bleed background images | Grayscale, high contrast, reduced brightness, blended into the dark background so it reads as atmospheric texture rather than a standalone photo. Render with pixelated interpolation. |
| Monochrome | Generic content images, mockups | Grayscale, very high contrast, darker exposure. Pixelated rendering. |
| Teal-tinted | Portraits, team photos, avatars | High contrast with a strong teal/cyan color shift applied over the dithered result (via sepia → saturate → hue-rotate or equivalent color mapping). Pixelated rendering. |

### Scanline overlay

Every dithered image container should include a scanline overlay — thin horizontal alternating transparent/dark lines (2px pitch) composited on top with a multiply blend. This adds CRT texture.

### Rules

- The dithered result should be monochrome or limited to 2–3 tones using the brand palette (dark navy `#060A12` and brand teal `#71C7C5`).
- Dithering grain size must be consistent across all images on a page — same dot pitch / matrix size.
- For portraits and avatars, add a semi-transparent brand-color overlay (≈10% opacity) using color blend mode so the teal tint intensifies on hover.
- Images should fill their container and cover the available space while maintaining aspect ratio.
- Do **not** apply the dithered effect to icons, logos, or UI chrome — only to photographic / illustrative imagery.

## Section Background Patterns

Every section should include one or more subtle pattern overlays layered behind content to add visual texture and depth. Patterns are absolutely positioned, full-bleed, and sit behind the section content.

### Available patterns

| Pattern | Description | Recommended opacity |
|---|---|---|
| Dot grid | Radial dot grid, 16px spacing, brand color | 5–20% |
| Ruled grid | Thin 40px ruled lines (horizontal + vertical) in brand color | 30–50% |
| Cross dots | Radial dots at 24px spacing | 5–15% |
| Scanlines | 2px horizontal scanlines, very subtle | 20–40% |
| Diagonal hairlines | –45° lines, 9px pitch | 30–50% |
| Dither tile (light) | 4×4 tiled dot pattern, low density | 10–30% |
| Dither tile (heavy) | 4×4 tiled dot pattern, higher density | 15–30% |

### Usage rules

- Layer 1–2 patterns per section; never stack more than 3.
- Patterns must sit behind content (lowest z-order) with content above.
- Clip patterns to the section bounds so they don't bleed into adjacent sections.
- On hover states for cards, reveal a light dither tile pattern at 20–30% opacity for interactive texture.

### Section dividers

Place a full-width hatched divider (10px tall, –55° repeating linear gradient in brand color) between major sections to visually separate them.

## Must

- All sections: consistent 96px vertical padding
- **All sections: same dark background color** — do not alternate light/dark backgrounds between sections. Use a slightly deeper dark only for cards, navs, or inset panels that need extra contrast.
- All containers: max-width 1152px, centered, 24px horizontal padding
- Section headers: 48px or 64px bottom margin
- Consistent vertical rhythm, no crowded sections
- Layouts readable and properly spaced on both desktop and mobile
- All photographic images: use real photos with the dithered effect applied — never SVG/canvas-generated placeholder art
