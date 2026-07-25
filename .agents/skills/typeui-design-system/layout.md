# Layout

## Intent
Compose pages as a bento narrative: alternating dense and open zones with clear visual breathing room.

## Containers
- Max width: 1240px desktop, 100% with 24px gutters on tablet, 16px on mobile.
- Section vertical rhythm: 120px desktop, 88px tablet, 64px mobile.

## Section Pattern
- Alternate between: hero statement, bento feature matrix, proof strip, and CTA band.
- Use asymmetry intentionally: 2:1 and 3:2 visual weight ratios are preferred.

## Surface Layers
- Base canvas uses two low-opacity (3%) radial overlays in opposite corners (e.g., primary and secondary accents) to break up the solid `#0a0a0a` background.
- Section shells may include soft noise texture at <= 3% opacity.

## Motion
- Entrance motion should be subtle (12-20px translate, 220-320ms ease-out).
- Respect `prefers-reduced-motion` by removing translation and long fades.

