# Hero

> Dependencies: `colors.md`, `layout.md`, `typography.md`

## Intent
The hero section must feel premium, technical, and visually striking, setting the tone for the entire landing page. It relies on deep contrast, subtle geometric patterns, and ambient light.

## Background & Ambient Light
- **Base Glow**: A massive, highly blurred radial element (e.g., 800x800px, 180px blur, 10% opacity) centered behind the text using the primary accent color (`#F9A474`).
- **Body Background**: The page body uses a dark `#0a0a0a` canvas with two low-opacity (3%) radial overlays in opposite corners (primary and secondary accents) to break up the solid black.

## Modern Geometric Patterns
The hero must include a complex, layered geometric pattern behind the main typography, masked by a radial gradient (`mask-image: radial-gradient(ellipse_at_center,black_40%,transparent_80%)`) so it fades smoothly into the background edges or other pattern in the same professional way.

**Pattern Elements:**
1. **Subtle Grid**: A 60x60px square grid overlay using a very faint stroke (`rgba(255, 255, 255, 0.02)`).
2. **Concentric Rings**: A series of 5+ perfectly centered circles ranging from 250px to 1400px.
   - Use very subtle white borders (2% to 8% opacity).
   - Introduce varied textures (e.g., one dashed ring) for a technical feel.
3. **Crosshairs**: Two intersecting 1px lines (horizontal and vertical) that run through the center, using a gradient that fades from transparent to `white/[0.08]` back to transparent at the edges.

## Typography & Badges
- **Badge**: A pill-shaped label above the H1. Uses a subtle glow (`shadow-[0_0_20px_rgba(249,164,116,0.1)]`), a 3% background fill, a 20% border, and a backdrop blur.
- **H1 Headline**: Uses `text-display-xl` with tight tracking. The text should have a subtle gradient clip (`from-white via-white to-[#a1a1aa]`) and a drop shadow for depth.
- **Subheadline**: Uses `text-body-l` in a muted secondary color (`#a1a1aa`), constrained to a readable max-width (e.g., `max-w-2xl`).

## Call to Action
- **Primary button**: Solid white background, dark text, with a subtle white glow (`shadow-[0_0_30px_rgba(255,255,255,0.15)]`).
- **Secondary button**: Transparent with a 10% white border, white text, and a backdrop blur (`backdrop-blur-sm`).

