import type { Pattern } from '../document/index.ts'

/** Each tile takes its colour and size in px; `TILE_SIZE` is the size when the pattern gives none. The SVG tiles also take the look's hex colour and the strength (0 to 1), which they bake in. */
export const TILE: Record<
  string,
  (c: string, s: number, hex: string, a: number) => string
> = {
  dots: (c, s) =>
    `radial-gradient(${c} 1.5px, transparent 1.6px) 0 0/${s}px ${s}px`,
  grid: (c, s) =>
    `linear-gradient(${c} 1px, transparent 1px) 0 0/${s}px ${s}px, linear-gradient(90deg, ${c} 1px, transparent 1px) 0 0/${s}px ${s}px`,
  lines: (c, s) =>
    `repeating-linear-gradient(0deg, ${c} 0 1px, transparent 1px ${s}px)`,
  diagonal: (c, s) =>
    `repeating-linear-gradient(45deg, ${c} 0 1px, transparent 1px ${s}px)`,
  cross: (c, s) =>
    `linear-gradient(${c} 1px, transparent 1px) ${s / 2}px 0/${s}px ${s}px, linear-gradient(90deg, ${c} 1px, transparent 1px) 0 ${s / 2}px/${s}px ${s}px`,
  rings: (c, s) =>
    `repeating-radial-gradient(circle at 50% 120%, ${c} 0 1px, transparent 1px ${s}px)`,
  checks: (c, s) =>
    `conic-gradient(${c} 25%, transparent 0 50%, ${c} 0 75%, transparent 0) 0 0/${s}px ${s}px`,
}

// The ten SVG tiles, `%C` is where the colour goes; the tile's width is its native size.
export const rnd = (v: number) => Math.round(v * 100) / 100
export const r1 = (v: number) => Math.round(v * 10) / 10
export const sine = (
  w: number,
  y: number,
  amp: number,
  cycles: number,
  phase = 0,
  steps = 20,
) =>
  'M' +
  Array.from(
    { length: steps + 1 },
    (_, i) =>
      `${r1((w * i) / steps)} ${r1(y + amp * Math.sin((i / steps) * 2 * Math.PI * cycles + phase))}`,
  ).join('L')
export const HEX = 'M14 0v8L0 16v16l14 8 14-8V16L14 8M14 48v-8'
export const dot = (cx: number, cy: number, r: number) =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="%C" stroke="none"/>`
export const spark = (x: number, y: number, s: number) =>
  `<path fill="%C" stroke="none" d="M${x} ${y - s}L${rnd(x + s * 0.22)} ${rnd(y - s * 0.22)}L${x + s} ${y}L${rnd(x + s * 0.22)} ${rnd(y + s * 0.22)}L${x} ${y + s}L${rnd(x - s * 0.22)} ${rnd(y + s * 0.22)}L${x - s} ${y}L${rnd(x - s * 0.22)} ${rnd(y - s * 0.22)}Z"/>`
export const SVG_TILES: Record<string, { w: number; h: number; body: string }> =
  {
    waves: { w: 48, h: 16, body: '<path d="M0 8c6-6 18-6 24 0s18 6 24 0"/>' },
    hexagons: { w: 28, h: 48, body: `<path d="${HEX}"/>` },
    triangles: { w: 32, h: 28, body: '<path d="M0 27.5 16 .5l16 27Z"/>' },
    zigzag: { w: 24, h: 12, body: '<path d="M0 9 6 3l6 6 6-6 6 6"/>' },
    scales: {
      w: 24,
      h: 24,
      body: '<path d="M0 12a12 12 0 0 1 24 0M-12 24a12 12 0 0 1 24 0M12 24a12 12 0 0 1 24 0"/>',
    },
    topography: {
      w: 160,
      h: 80,
      body: `<path d="${sine(160, 10, 6, 1)}${sine(160, 30, 8, 2, 1.2)}${sine(160, 50, 7, 1, 2.4)}${sine(160, 70, 5, 2, 3.6)}"/>`,
    },
    circuit: {
      w: 48,
      h: 48,
      body:
        '<path d="M0 12h14l6 6h10l6-6h12M8 0v26l6 6v10l-6 6M30 18v12M24 48v-8l8-8h8M24 0v4"/><circle cx="30" cy="32.5" r="2.5"/><circle cx="42.5" cy="32" r="2.5"/><circle cx="24" cy="6.5" r="2.5"/>' +
        dot(14, 12, 1.6),
    },
    molecules: {
      w: 28,
      h: 48,
      body: `<path d="${HEX}"/>${dot(14, 8, 1.8)}${dot(0, 16, 1.8)}${dot(0, 32, 1.8)}${dot(14, 40, 1.8)}${dot(28, 32, 1.8)}${dot(28, 16, 1.8)}`,
    },
    cubes: {
      w: 28,
      h: 48,
      body: `<path d="${HEX}M14 24 0 16M14 24l14-8M14 24v16"/>`,
    },
    sparkles: {
      w: 48,
      h: 48,
      body: `${spark(12, 14, 5)}${spark(36, 34, 3.5)}${dot(36, 10, 0.9)}${dot(10, 38, 0.9)}`,
    },
  }
export const TILE_SIZE: Record<string, number> = {
  dots: 18,
  grid: 24,
  lines: 12,
  diagonal: 12,
  cross: 18,
  rings: 16,
  checks: 24,
}
for (const [name, t] of Object.entries(SVG_TILES)) {
  TILE_SIZE[name] = t.w
  TILE[name] = (_c, s, hex, a) => {
    const k = s / t.w
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${t.w}" height="${t.h}"><g fill="none" stroke="${hex}" stroke-opacity="${a}" fill-opacity="${a}" stroke-width="1">${t.body.replaceAll('%C', hex)}</g></svg>`.replaceAll(
        '"',
        "'",
      )
    // Only what a quoted CSS url() cannot hold is escaped; spaces stay as they are.
    return `url("data:image/svg+xml,${svg.replace(/[%#<>"\n]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'))}") 0 0/${rnd(t.w * k)}px ${rnd(t.h * k)}px`
  }
}

export const FADE: Record<string, string | undefined> = {
  left: 'linear-gradient(to right, transparent, #000 45%)',
  right: 'linear-gradient(to left, transparent, #000 45%)',
  bottom: 'linear-gradient(to bottom, #000 40%, transparent)',
}

/** The tile layers of a pattern, as one CSS list. `brand` and `ink` are the look's own hex values: an SVG tile cannot read `var(--s-brand)`, so the colour is baked in (it does not follow dark mode). */
export function tileLayers(
  { tile, color, strength, size }: Pattern,
  brand: string,
  ink: string,
): { css: string; s: number; t: string } {
  const inkVar = color === 'ink' ? 'var(--s-ink)' : 'var(--s-brand)'
  const t = tile !== undefined && Object.hasOwn(TILE, tile) ? tile : 'dots'
  const s =
    typeof size === 'number' ? Math.min(96, Math.max(4, size)) : TILE_SIZE[t]
  const pct = Math.min(100, Math.max(5, Number(strength) || 0))
  const want = color === 'ink' ? ink : brand,
    hex = /^#[0-9a-f]{3,8}$/i.test(want) ? want : '#000000'
  return {
    css: TILE[t](
      `color-mix(in srgb, ${inkVar} ${pct}%, transparent)`,
      s,
      hex,
      pct / 100,
    ),
    s,
    t,
  }
}
export const withGradient = (css: string, color: Pattern['color']) =>
  color === 'gradient'
    ? `${css}, linear-gradient(120deg, color-mix(in srgb, var(--s-brand) 14%, transparent), transparent)`
    : css
export function patternBackground(
  p: Pattern,
  brand: string,
  ink: string,
): string {
  return withGradient(tileLayers(p, brand, ink).css, p.color)
}

/** Which way the mask runs for a density: the dense side is opaque. */
export const DENSITY: Record<string, string> = {
  top: 'to top',
  bottom: 'to bottom',
  left: 'to left',
  right: 'to right',
}
