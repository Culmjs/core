// CSS-style values -> Culm's forms. A write is never refused for a value that can be mapped: width "100%", padding "1.5rem 2rem", a CSS
// box-shadow, rgba(), a font-family stack, letter-spacing in px, a setting a kind does not have. What is exact is changed silently;
// what is approximate, clamped, moved to another setting or dropped has a warning (path, line:column, what was done). Pure: it edits the wants.
import {
  FONTS,
  fontSlug,
  KINDS,
  kindSpec,
  textRangeFor,
  type KindSpec,
  type Registry,
  type SiteDocument,
} from '@culmjs/core'
import { isObj } from '../shared.ts'
import type { Want } from './tree.ts'
import { linkOf } from './parse.ts'

type Obj = Record<string, unknown>
export type Warning = {
  message: string
  jsx: { path: string; line: number; column: number }
}
/** A Google family the style names that the site does not have yet: the write adds it to the site's fonts (the server fetches it). */
export type FontNeed = {
  family: string
  slug: string
  weights: Set<number>
  italic?: boolean
}
export type Cx = {
  doc: SiteDocument
  registry?: Registry
  /** Font refs the write's <Site fonts> will add. */
  siteRefs: Set<string>
  warns: Warning[]
  /** Fonts to add: `cat:slug` of the built-in catalogue, or a Google family. */
  needs: Map<string, FontNeed | 'cat'>
}
const kindDef = (kind: string, registry?: Registry): KindSpec | undefined =>
  kindSpec(kind, registry?.kinds()) ?? KINDS[kind as keyof typeof KINDS]

const HEX = (r: number, g: number, b: number, a = 1) =>
  '#' +
  [r, g, b]
    .map(x =>
      Math.max(0, Math.min(255, Math.round(x)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('') +
  (a >= 1
    ? ''
    : Math.round(Math.max(0, a) * 255)
        .toString(16)
        .padStart(2, '0'))

// the CSS colour names an author writes; any other name is dropped with a warning
const NAMED = Object.fromEntries(
  `black 000000|white ffffff|red ff0000|green 008000|blue 0000ff|yellow ffff00|orange ffa500|purple 800080|pink ffc0cb|gray 808080|grey 808080|silver c0c0c0|maroon 800000|navy 000080|teal 008080|olive 808000|lime 00ff00|aqua 00ffff|cyan 00ffff|magenta ff00ff|fuchsia ff00ff|brown a52a2a|gold ffd700|beige f5f5dc|ivory fffff0|khaki f0e68c|coral ff7f50|salmon fa8072|tomato ff6347|crimson dc143c|indigo 4b0082|violet ee82ee|lavender e6e6fa|turquoise 40e0d0|tan d2b48c|orchid da70d6|plum dda0dd|chocolate d2691e|firebrick b22222|darkgray a9a9a9|darkgrey a9a9a9|lightgray d3d3d3|lightgrey d3d3d3|dimgray 696969|dimgrey 696969|gainsboro dcdcdc|whitesmoke f5f5f5|snow fffafa|linen faf0e6|azure f0ffff|aliceblue f0f8ff|skyblue 87ceeb|steelblue 4682b4|royalblue 4169e1|darkblue 00008b|lightblue add8e6|midnightblue 191970|slategray 708090|darkslategray 2f4f4f|darkgreen 006400|forestgreen 228b22|seagreen 2e8b57|lightgreen 90ee90|darkred 8b0000|hotpink ff69b4|deeppink ff1493|darkorange ff8c00|orangered ff4500|goldenrod daa520|darkviolet 9400d3|mintcream f5fffa|ghostwhite f8f8ff|lightyellow ffffe0|lightpink ffb6c1|peachpuff ffdab9|wheat f5deb3|sienna a0522d|peru cd853f|rosybrown bc8f8f|cornflowerblue 6495ed|dodgerblue 1e90ff|deepskyblue 00bfff|limegreen 32cd32|springgreen 00ff7f|mediumseagreen 3cb371|slateblue 6a5acd|darkorchid 9932cc|mediumpurple 9370db|thistle d8bfd8|lemonchiffon fffacd|cornsilk fff8dc|bisque ffe4c4|mistyrose ffe4e1|seashell fff5ee|oldlace fdf5e6`
    .split('|')
    .map(s => s.split(' ') as [string, string])
    .map(([n, h]) => [n, `#${h}`]),
) as Record<string, string>
const TOKENS = new Set([
  'brand',
  'ink',
  'bg',
  'muted',
  'line',
  'accent',
  'on-accent',
  'deep',
  'on-deep',
  'accentSoft',
])

const rnd = (x: number) => Math.round(x * 1000) / 1000
const clampN = (x: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, x))

/** A CSS colour as a token, `#rrggbb` or `#rrggbbaa`; undefined when it is not one. */
export function colour(v: unknown): string | undefined {
  if (isObj(v)) return typeof v.style === 'string' ? (v as never) : undefined
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  if (TOKENS.has(t)) return t
  let m = /^#([0-9a-f]{3,4})$/i.exec(t)
  if (m) return `#${[...m[1]!].map(c => c + c).join('')}`.toLowerCase()
  if (/^#([0-9a-f]{6}|[0-9a-f]{8})$/i.test(t)) return t.toLowerCase()
  const l = t.toLowerCase()
  if (l === 'transparent') return '#00000000'
  if (NAMED[l]) return NAMED[l]
  m = /^(rgba?|hsla?)\(\s*([^)]*)\)$/i.exec(t)
  if (!m) return undefined
  const parts = m[2]!.split(/[\s,/]+/).filter(Boolean)
  if (parts.length < 3 || parts.length > 4) return undefined
  const num = (s: string, scale: number) =>
    s.endsWith('%') ? (parseFloat(s) / 100) * scale : parseFloat(s)
  const a = parts[3] === undefined ? 1 : num(parts[3], 1)
  const n = parts.slice(0, 3).map(s => parseFloat(s))
  if (n.some(Number.isNaN) || Number.isNaN(a)) return undefined
  if (/^rgb/i.test(m[1]!))
    return HEX(num(parts[0]!, 255), num(parts[1]!, 255), num(parts[2]!, 255), a)
  const [h, s, li] = [
    ((n[0]! % 360) + 360) % 360,
    clampN(n[1]!, 0, 100) / 100,
    clampN(n[2]!, 0, 100) / 100,
  ]
  const k = (x: number) => (x + h / 30) % 12
  const f = (x: number) =>
    li -
    s * Math.min(li, 1 - li) * Math.max(-1, Math.min(k(x) - 3, 9 - k(x), 1))
  return HEX(f(0) * 255, f(8) * 255, f(4) * 255, a)
}

/** `12px`, `1.5rem`, `2em`, `50%`, `10vh`, `12` -> {n, unit}; rem and em are 16 px, pt is 4/3 px. */
function len(s: string): { n: number; unit: string } | undefined {
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+))\s*(px|rem|em|pt|%|vh|vw|ch)?$/i.exec(
    s.trim(),
  )
  if (!m) return undefined
  const n = parseFloat(m[1]!)
  const u = (m[2] ?? 'px').toLowerCase()
  if (u === 'rem' || u === 'em') return { n: n * 16, unit: 'px' }
  if (u === 'pt') return { n: rnd((n * 4) / 3), unit: 'px' }
  return { n, unit: u }
}
/** A px number from a number or a CSS length in px, rem, em or pt; undefined for anything else. */
export const pxOf = (v: unknown): number | undefined => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v !== 'string') return undefined
  const l = len(v)
  return l && l.unit === 'px' ? rnd(l.n) : undefined
}

const RANGE: Record<string, [number, number]> = {
  px: [0, 2000],
  '%': [0, 100],
  ch: [1, 200],
  vh: [0, 100],
  vw: [0, 100],
}
const OFFSET: Record<string, [number, number]> = {
  px: [-2000, 2000],
  '%': [-100, 100],
  ch: [-200, 200],
  vh: [-100, 100],
  vw: [-100, 100],
}
const SIZE_KEYS = new Set([
  'width',
  'height',
  'minWidth',
  'maxWidth',
  'minHeight',
])

/** The aliases of CSS and React-style names. */
const ALIAS: Record<string, string> = {
  backgroundColor: 'bg',
  background: 'bg',
  fontSize: 'size',
  fontWeight: 'weight',
  fontFamily: 'font',
  fontStyle: 'italic',
  borderRadius: 'radius',
  boxShadow: 'shadow',
  justifyContent: 'justify',
  alignItems: 'align',
  flexDirection: 'direction',
  flexWrap: 'wrap',
  textDecoration: 'underline',
  borderColor: 'borderColor',
  flex: 'flex',
  flexGrow: 'flex',
  'background-color': 'bg',
  'font-size': 'size',
  'font-weight': 'weight',
  'font-family': 'font',
  'line-height': 'lineHeight',
  'letter-spacing': 'letterSpacing',
  'text-align': 'textAlign',
  'border-radius': 'radius',
  'box-shadow': 'shadow',
  'max-width': 'maxWidth',
  'min-width': 'minWidth',
  'min-height': 'minHeight',
  'justify-content': 'justify',
  'align-items': 'align',
  'flex-direction': 'direction',
  'flex-wrap': 'wrap',
  'border-color': 'borderColor',
}
const POS: Record<string, string> = {
  'flex-start': 'start',
  left: 'start',
  top: 'start',
  'self-start': 'start',
  'flex-end': 'end',
  right: 'end',
  bottom: 'end',
  'self-end': 'end',
  'space-between': 'between',
  'space-around': 'around',
  'space-evenly': 'around',
  normal: 'stretch',
}
const GENERIC: [RegExp, string][] = [
  [
    /^(sans-serif|system-ui|ui-sans-serif|-apple-system|blinkmacsystemfont|arial|helvetica( neue)?|segoe ui|verdana|tahoma)$/,
    'sys:sans',
  ],
  [
    /^(serif|ui-serif|georgia|times( new roman)?|palatino|garamond|cambria)$/,
    'sys:serif',
  ],
  [
    /^(monospace|ui-monospace|courier( new)?|menlo|consolas|monaco|sfmono-regular)$/,
    'sys:mono',
  ],
]
/** Resolve a CSS family in exactly the same order for site and node styles. */
export function firstFamily(s: string) {
  const first = s
    .replace(/^google:/i, '')
    .split(',')[0]!
    .trim()
    .replace(/^["']|["']$/g, '')
  return GENERIC.find(([re]) => re.test(first.toLowerCase()))?.[1] ?? first
}
const RENAMED: Record<string, string> = { 'source sans pro': 'Source Sans 3' }
const SHADOW_NAMES: Record<string, string | null> = {
  xs: 'soft',
  sm: 'soft',
  md: 'soft',
  soft: 'soft',
  card: 'soft',
  base: 'soft',
  default: 'soft',
  lg: 'strong',
  xl: 'strong',
  '2xl': 'strong',
  strong: 'strong',
  none: null,
}

const DROP = Symbol('drop')
type Out = unknown | typeof DROP

/** The rules of one layer's declaration; `c.note` collects what was done. */
type Ctx = {
  c: Cx
  w: Want
  layer: string
  decl: Obj
  out: Obj
  note(m: string): void
}

const sizeValue = (x: Ctx, k: string, v: unknown): Out => {
  const clamp = (n: number, unit: string, set: boolean) => {
    const [lo, hi] = RANGE[unit]!
    const r = clampN(n, lo, hi)
    if (r !== n && set)
      x.note(
        `${k} ${n}${unit} is outside ${lo} to ${hi}${unit}; set to ${r}${unit}`,
      )
    return rnd(r)
  }
  if (v === 'fit' || v === 'fill') return v
  if (typeof v === 'number') return { n: clamp(v, 'px', true), unit: 'px' }
  let l: { n: number; unit: string } | undefined
  if (isObj(v)) {
    if (typeof v.n !== 'number' || typeof v.unit !== 'string') return undefined
    l = len(`${v.n}${v.unit}`)
    if (l && l.unit === v.unit && Object.hasOwn(RANGE, v.unit)) {
      const n = clamp(l.n, l.unit, true)
      return n === v.n ? undefined : { n, unit: l.unit }
    }
  } else if (typeof v === 'string') {
    const t = v.trim().toLowerCase()
    if (t === 'auto' || /^(fit|min|max)-content$/.test(t))
      return k === 'width' || k === 'height' ? 'fit' : DROP
    if (t === 'none' || t === 'initial' || t === 'inherit' || t === 'unset')
      return DROP
    l = len(t)
  } else return undefined
  if (!l || !Object.hasOwn(RANGE, l.unit)) {
    x.note(`${k} ${JSON.stringify(v)} is not a length Culm has; dropped`)
    return DROP
  }
  if (l.unit === '%' && l.n === 100 && (k === 'width' || k === 'height'))
    return 'fill'
  if (l.unit === '%' && k.startsWith('min') && l.n === 100)
    return { n: 100, unit: '%' }
  return { n: clamp(l.n, l.unit, true), unit: l.unit }
}

const SIDES = ['top', 'right', 'bottom', 'left']
/** One to four CSS values -> top, right, bottom, left. */
const four = <T>(a: T[]): T[] | undefined =>
  a.length === 1
    ? [a[0]!, a[0]!, a[0]!, a[0]!]
    : a.length === 2
      ? [a[0]!, a[1]!, a[0]!, a[1]!]
      : a.length === 3
        ? [a[0]!, a[1]!, a[2]!, a[1]!]
        : a.length === 4
          ? a
          : undefined

function spaceValue(
  x: Ctx,
  k: string,
  v: unknown,
  lo: number,
  hi: number,
): Out {
  const one = (t: unknown): number | 'auto' | undefined | object => {
    if (isObj(t)) return t
    if (typeof t === 'string' && t.trim() === 'auto') return 'auto'
    const rel = typeof t === 'string' && len(t)
    if (rel && rel.unit === '%' && rel.n >= (lo < 0 ? -100 : 0) && rel.n <= 100)
      return { n: rel.n, unit: '%' }
    const p = pxOf(t)
    if (p === undefined) return undefined
    const r = clampN(rnd(p), lo, hi)
    if (r !== p) x.note(`${k} ${p} is outside ${lo} to ${hi}; set to ${r}`)
    return r
  }
  const toks: unknown[] | undefined = Array.isArray(v)
    ? v
    : typeof v === 'string'
      ? v.trim().split(/\s+/)
      : undefined
  if (!toks) {
    if (typeof v === 'number') return one(v)
    return undefined // an object ({step}) or something core will judge
  }
  const vals = toks.map(one)
  if (vals.some(t => t === undefined)) {
    x.note(
      `${k} ${JSON.stringify(v)} has a value that is not a length; dropped`,
    )
    return DROP
  }
  const f = four(vals as (number | 'auto' | object)[])
  if (!f) {
    x.note(`${k} takes one to four values; dropped`)
    return DROP
  }
  if (f.includes('auto')) {
    if (k !== 'margin') return DROP
    if (f[1] === 'auto' && f[3] === 'auto') x.out.place = 'center'
    else x.note('margin auto on one side only is not available; set to 0')
  }
  const nums = f.map(t => (t === 'auto' ? 0 : t)) as (number | object)[]
  return nums.every(t => t === nums[0]) && typeof nums[0] === 'number'
    ? nums[0]
    : nums
}

function shadowParse(s: string, x: Ctx): unknown {
  const raw = s.trim()
  const named = SHADOW_NAMES[raw.toLowerCase()]
  if (named !== undefined) return named ?? DROP
  // split on commas outside brackets
  const items: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of raw) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      items.push(cur)
      cur = ''
    } else cur += ch
  }
  items.push(cur)
  if (items.length > 1)
    x.note(`${items.length} shadows; Culm takes one, the first was kept`)
  const first = items[0]!.trim()
  const toks = first.match(/(?:rgba?|hsla?)\([^)]*\)|\S+/gi) ?? []
  let inset = false
  const nums: number[] = []
  let c: string | undefined
  for (const t of toks) {
    if (t.toLowerCase() === 'inset') inset = true
    else if (/^[+-]?(\d|\.\d)/.test(t)) {
      const p = pxOf(t)
      if (p === undefined) return DROP
      nums.push(p)
    } else {
      c = colour(t)
      if (c === undefined) return DROP
    }
  }
  if (nums.length < 2 || nums.length > 4) return DROP
  if (inset)
    x.note('an inset shadow is not available; written as an outer shadow')
  const [sx, sy, blur = 0, spread = 0] = nums
  return {
    x: clampN(sx!, -100, 100),
    y: clampN(sy!, -100, 100),
    blur: clampN(blur, 0, 200),
    spread: clampN(spread, -100, 100),
    color: c ?? 'ink',
  }
}

const sizeOfDecl = (d: Obj): number => pxOf(d.size) ?? 16

function fontValue(x: Ctx, v: unknown): Out {
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  if (/^sys:(sans|serif|mono)$/.test(t)) return undefined
  let family: string | undefined
  let slug: string | undefined
  const m = /^(up|cat):([a-z0-9-]+)$/.exec(t)
  const c = x.c
  if (m) {
    const ref = `${m[1]}:${m[2]}`
    if ((c.doc.fonts as string[]).includes(ref) || c.siteRefs.has(ref))
      return undefined
    if (m[1] === 'cat' && Object.hasOwn(FONTS, m[2]!)) {
      c.needs.set(ref, 'cat')
      return undefined
    }
    family = m[2]!
      .split('-')
      .map(s => s[0]!.toUpperCase() + s.slice(1))
      .join(' ')
    slug = m[2]
  } else {
    // google:Name, or a CSS stack: the first family names the font
    const first = firstFamily(t)
    if (first.startsWith('sys:')) {
      x.note(`font "${t}" is a system font; set to ${first}`)
      return first
    }
    family = first
  }
  const renamed = RENAMED[family.toLowerCase()]
  if (renamed) {
    x.note(`font "${family}" was renamed; using "${renamed}"`)
    family = renamed
  }
  if (!/^[A-Za-z0-9 ]{1,64}$/.test(family) || !fontSlug(family)) {
    x.note(`font ${JSON.stringify(v)} is not a family name; dropped`)
    return DROP
  }
  slug = fontSlug(family)
  if (Object.hasOwn(FONTS, slug)) {
    const ref = `cat:${slug}`
    if (
      !(c.doc.fonts as string[]).includes(ref) &&
      !c.siteRefs.has(ref) &&
      !(c.doc.fonts as string[]).includes(`up:${slug}`) &&
      !c.siteRefs.has(`up:${slug}`)
    ) {
      c.needs.set(ref, 'cat')
      x.note(`font "${family}" was added to the site (built-in)`)
      return ref
    }
    return (c.doc.fonts as string[]).includes(`up:${slug}`) ||
      c.siteRefs.has(`up:${slug}`)
      ? `up:${slug}`
      : ref
  }
  const ref = `up:${slug}`
  if (!(c.doc.fonts as string[]).includes(ref) && !c.siteRefs.has(ref)) {
    const have = c.needs.get(ref)
    const need: FontNeed =
      have && have !== 'cat'
        ? have
        : { family, slug, weights: new Set([400, 700]) }
    const w = x.decl.weight
    if (typeof w === 'number' && w % 100 === 0 && w >= 100 && w <= 900)
      need.weights.add(w)
    if (x.decl.italic === true || x.decl.italic === 'italic') need.italic = true
    c.needs.set(ref, need)
    x.note(`font "${family}" was added to the site (Google Fonts)`)
  }
  return ref
}

/** The value of one style key in Culm's form: a new value, DROP, or undefined for "leave it". */
function fix(x: Ctx, k: string, v: unknown): Out {
  if (SIZE_KEYS.has(k)) return sizeValue(x, k, v)
  switch (k) {
    case 'padding':
      return spaceValue(x, k, v, 0, 400)
    case 'margin':
      return spaceValue(x, k, v, -400, 400)
    case 'gap': {
      if (typeof v === 'string') {
        const l = len(v)
        if (l?.unit === '%' && l.n >= 0 && l.n <= 100)
          return { n: l.n, unit: '%' }
        const p = pxOf(v.trim().split(/\s+/)[0])
        if (p === undefined) {
          x.note(`gap ${JSON.stringify(v)} is not a length; dropped`)
          return DROP
        }
        if (v.trim().split(/\s+/).length > 1)
          x.note('two gap values; the first was kept')
        return clampN(p, 0, 200)
      }
      return typeof v === 'number' && (v < 0 || v > 200)
        ? (x.note(`gap ${v} is outside 0 to 200; clamped`), clampN(v, 0, 200))
        : undefined
    }
    case 'radius': {
      if (typeof v === 'string') {
        const toks = v.trim().split(/\s+/)
        if (toks.every(t => t.endsWith('%'))) {
          const values = toks.map(t => len(t))
          const corners =
            values.every(Boolean) && four(values.map(l => clampN(l!.n, 0, 100)))
          return corners
            ? {
                n: corners.every(v => v === corners[0]) ? corners[0] : corners,
                unit: '%',
              }
            : DROP
        }
        const px = toks.map(pxOf)
        const f = px.every(p => p !== undefined)
          ? four(px as number[])
          : undefined
        if (!f) {
          x.note(`radius ${JSON.stringify(v)} is not lengths; dropped`)
          return DROP
        }
        const c = f.map(p => clampN(p, 0, 999))
        return c.every(p => p === c[0]) ? c[0] : c
      }
      return typeof v === 'number' && v > 999 ? 999 : undefined
    }
    case 'inset': {
      const side = (t: unknown) => {
        if (isObj(t)) return t
        const l =
          typeof t === 'number'
            ? { n: t, unit: 'px' }
            : typeof t === 'string'
              ? len(t)
              : undefined
        if (!l || !Object.hasOwn(OFFSET, l.unit)) return undefined
        const [lo, hi] = OFFSET[l.unit]!
        return { n: rnd(clampN(l.n, lo, hi)), unit: l.unit }
      }
      let list: unknown[] | undefined
      if (Array.isArray(v)) list = v
      else if (typeof v === 'string') list = v.trim().split(/\s+/)
      else if (typeof v === 'number') list = [v]
      else if (isObj(v)) {
        const o: Obj = {}
        for (const [s, t] of Object.entries(v))
          o[s] = SIDES.includes(s) ? (side(t) ?? t) : t
        return o
      }
      const f = list && four(list.map(side))
      if (!f || f.some(t => t === undefined)) {
        x.note(`inset ${JSON.stringify(v)} is not one to four lengths; dropped`)
        return DROP
      }
      return Object.fromEntries(SIDES.map((s, i) => [s, f[i]]))
    }
    case 'size': {
      const vw = typeof v === 'string' && /^([\d.]+)vw$/i.exec(v.trim())
      const fluid =
        typeof v === 'string' &&
        (vw
          ? ['', '8', vw[1], '240']
          : /^clamp\(\s*([\d.]+)px\s*,\s*([\d.]+)vw\s*,\s*([\d.]+)px\s*\)$/i.exec(
              v,
            ))
      if (
        fluid &&
        +fluid[1]! >= 0 &&
        +fluid[3]! >= +fluid[1]! &&
        +fluid[2]! > 0 &&
        +fluid[2]! <= 100 &&
        kindDef(x.w.kind, x.c.registry)?.styles.includes('fluidSize' as never)
      ) {
        const range = textRangeFor(x.c.doc.styles, x.w.kind, x.w.props.level)
        const bound = (s: string) =>
          clampN(
            +s,
            Math.max(8, range?.min ?? 8),
            Math.min(240, range?.max ?? 240),
          )
        x.out.fluidSize = {
          min: bound(fluid[1]!),
          max: bound(fluid[3]!),
          vw: +fluid[2]!,
        }
        if (bound(fluid[1]!) !== +fluid[1]! || bound(fluid[3]!) !== +fluid[3]!)
          x.note(`font-size ${v} limited to the site's text range`)
        return DROP
      }
      const p = pxOf(v)
      if (p === undefined) {
        x.note(`size ${JSON.stringify(v)} is not a length; dropped`)
        return DROP
      }
      const r = textRangeFor(x.c.doc.styles, x.w.kind, x.w.props.level)
      const [lo, hi] = r ? [r.min, r.max] : [8, 240]
      const n = clampN(Math.round(p * 100) / 100, lo, hi)
      if (n !== p)
        x.note(
          `text size ${p} is outside the site's range of ${lo} to ${hi}; set to ${n}`,
        )
      return n === v ? undefined : n
    }
    case 'lineHeight': {
      let n: number | undefined
      if (typeof v === 'number') n = v > 4 ? v / sizeOfDecl(x.decl) : v
      else if (typeof v === 'string') {
        const t = v.trim()
        if (t === 'normal') return DROP
        if (/^[\d.]+%$/.test(t)) n = parseFloat(t) / 100
        else if (/^[\d.]+$/.test(t)) n = parseFloat(t)
        else {
          const p = pxOf(t)
          n = p === undefined ? undefined : p / sizeOfDecl(x.decl)
        }
      }
      if (n === undefined || Number.isNaN(n)) return DROP
      const r = rnd(clampN(n, 0.8, 4))
      if (typeof v === 'number' && r === v) return undefined
      if (r !== rnd(n))
        x.note(`line height ${rnd(n)} is outside 0.8 to 4; set to ${r}`)
      return r
    }
    case 'letterSpacing': {
      let n: number | undefined
      if (typeof v === 'number')
        n = v >= -0.1 && v <= 0.5 ? v : v / sizeOfDecl(x.decl)
      else if (typeof v === 'string') {
        const t = v.trim().toLowerCase()
        if (t === 'normal') return 0
        const m = /^([+-]?[\d.]+)em$/.exec(t)
        if (m) n = parseFloat(m[1]!)
        else {
          const p = pxOf(t)
          n = p === undefined ? undefined : p / sizeOfDecl(x.decl)
        }
      }
      if (n === undefined || Number.isNaN(n)) return DROP
      const r = rnd(clampN(n, -0.1, 0.5))
      if (typeof v === 'number' && v >= -0.1 && v <= 0.5) return undefined
      if (r !== rnd(n))
        x.note(`letter spacing ${rnd(n)}em is outside -0.1 to 0.5; set to ${r}`)
      return r
    }
    case 'weight': {
      let n: number | undefined
      if (typeof v === 'number') n = v
      else if (typeof v === 'string')
        n =
          { normal: 400, bold: 700, bolder: 800, lighter: 300 }[
            v.trim().toLowerCase()
          ] ?? parseFloat(v)
      if (n === undefined || Number.isNaN(n)) return DROP
      const r = clampN(Math.round(n / 100) * 100, 100, 900)
      if (r !== n && typeof v === 'number') x.note(`weight ${n} set to ${r}`)
      return r === v ? undefined : r
    }
    case 'opacity': {
      let n = v
      if (typeof v === 'string')
        n = /%$/.test(v.trim()) ? parseFloat(v) / 100 : parseFloat(v)
      if (typeof n !== 'number' || Number.isNaN(n)) return DROP
      const r = Math.round(clampN(n, 0, 1) * 20) / 20
      return r === v ? undefined : r
    }
    case 'bg':
    case 'color':
    case 'borderColor':
    case 'underlineColor': {
      if (
        typeof v === 'string' &&
        /^(url|linear-gradient|radial-gradient)/i.test(v.trim())
      ) {
        x.note(
          `${k} ${v.trim().slice(0, 20)}... is an image or gradient; use the gradient style or an Image. Dropped`,
        )
        return DROP
      }
      const c = colour(v)
      if (c === undefined) {
        x.note(
          `${k} ${JSON.stringify(v)} is not a colour Culm can read; dropped`,
        )
        return DROP
      }
      return c === v ? undefined : c
    }
    case 'border':
    case 'borderTop':
    case 'borderRight':
    case 'borderBottom':
    case 'borderLeft': {
      let o: Obj | undefined
      if (typeof v === 'string') {
        const t = v.trim()
        if (t === 'none' || t === '0') return DROP
        const parts = t.match(/(?:rgba?|hsla?)\([^)]*\)|\S+/gi) ?? []
        o = { width: 1 }
        for (const p of parts) {
          if (/^(solid|dashed|dotted|double)$/.test(p)) o.style = p
          else if (/^[+-]?(\d|\.\d)/.test(p)) o.width = pxOf(p) ?? 1
          else {
            const c = colour(p)
            if (c) o.color = c
          }
        }
        o.color ??= 'line'
      } else if (isObj(v)) {
        o = { ...v }
        if (o.width !== undefined) {
          const p = pxOf(o.width)
          if (p !== undefined) o.width = clampN(p, 0, 64)
        }
        if (o.color === undefined) o.color = 'line'
        else {
          const c = colour(o.color)
          if (c !== undefined) o.color = c
        }
      } else return undefined
      return o
    }
    case 'borderWidth': {
      const p = pxOf(v)
      return p === undefined ? undefined : clampN(p, 0, 64)
    }
    case 'shadow':
    case 'textShadow': {
      if (typeof v === 'string') {
        const r = shadowParse(v, x)
        if (r === DROP) {
          if (SHADOW_NAMES[v.trim().toLowerCase()] !== null)
            x.note(
              `${k} ${JSON.stringify(v)} is not a CSS shadow Culm can read; dropped`,
            )
          return DROP
        }
        if (k === 'shadow' || typeof r === 'string') return r
        const o = r as Obj
        return { x: o.x, y: o.y, blur: o.blur, color: o.color }
      }
      if (isObj(v) && 'color' in v) {
        const c = colour(v.color)
        return c !== undefined && c !== v.color ? { ...v, color: c } : undefined
      }
      return undefined
    }
    case 'gradient': {
      if (isObj(v) && Array.isArray(v.stops))
        return {
          ...v,
          stops: v.stops.map(s => {
            if (!isObj(s)) return s
            const c = colour(s.color)
            return c !== undefined ? { ...s, color: c } : s
          }),
        }
      return undefined
    }
    case 'font':
      return fontValue(x, v)
    case 'bgImage':
      return isObj(v) && v.generate !== undefined ? v : undefined
    case 'justify':
    case 'align': {
      if (typeof v !== 'string') return undefined
      const t = v.trim().toLowerCase()
      return POS[t] ?? (t === v ? undefined : t)
    }
    case 'wrap':
      return v === 'wrap' ? true : v === 'nowrap' ? false : undefined
    case 'overflow':
      return v === 'hidden' ? 'clip' : undefined
    case 'direction':
      return v === 'row-reverse'
        ? 'row'
        : v === 'column-reverse'
          ? 'column'
          : undefined
    case 'underline':
      return typeof v === 'string' ? v.includes('underline') : undefined
    case 'italic':
      return typeof v === 'string' ? v === 'italic' : undefined
    default:
      return undefined
  }
}

const layerOf = (l: string) => (l === 'base' ? 'style' : l)

/** One declaration of one layer of `w`, in Culm's forms. */
function layer(
  w: Want,
  c: Cx,
  name: string,
  decl: Obj,
  say: (m: string) => void,
): Obj {
  const preDecl: Obj = { ...decl }
  if (
    preDecl.size === undefined &&
    (decl['font-size'] ?? decl.fontSize) !== undefined
  )
    preDecl.size = decl['font-size'] ?? decl.fontSize
  if (
    preDecl.weight === undefined &&
    (decl['font-weight'] ?? decl.fontWeight) !== undefined
  )
    preDecl.weight = decl['font-weight'] ?? decl.fontWeight
  if (
    preDecl.italic === undefined &&
    (decl['font-style'] ?? decl.fontStyle) !== undefined
  )
    preDecl.italic = decl['font-style'] ?? decl.fontStyle
  const out: Obj = {}
  const x: Ctx = {
    c,
    w,
    layer: name,
    decl: preDecl,
    out,
    note: m => say(`${layerOf(name)}: ${m}`),
  }
  let dividerColor: unknown
  const here = kindDef(w.kind, c.registry)
  for (const [k0, v0] of Object.entries(decl)) {
    const camel = k0.replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase())
    const k = ALIAS[k0] ?? ALIAS[camel] ?? camel
    let v = v0
    if (v === null) {
      if (here && (here.styles as string[]).includes(k)) out[k] = null
      continue
    }
    if (
      k === 'bg' &&
      k0 === 'background' &&
      typeof v === 'string' &&
      colour(v) === undefined
    ) {
      x.note(
        `background ${JSON.stringify(v).slice(0, 30)} is not a colour; dropped`,
      )
      continue
    }
    if (k === 'flex') {
      const g = typeof v === 'number' ? v : parseFloat(String(v))
      if (
        Number.isFinite(g) &&
        g > 0 &&
        !(w.extras.slot as Obj | undefined)?.grow
      ) {
        w.extras.slot = { ...(w.extras.slot as Obj), grow: Math.min(g, 12) }
        x.note(
          `${k0} ${JSON.stringify(v0)} set as slot={{grow:${Math.min(g, 12)}}}`,
        )
      }
      continue
    }
    if (k !== k0) x.note(`${k0} is written ${k}`)
    if (!here || !(here.styles as string[]).includes(k)) {
      if (k === 'bg' && w.kind === 'shape' && name === 'base') {
        const r = fix(x, 'bg', v)
        if (r !== DROP && w.props.fill === undefined) {
          w.props.fill = r ?? v
          x.note('bg on a Shape is its fill; set fill')
        } else
          x.note('bg on a Shape is its fill, which it already has; dropped')
      } else if (k === 'color' && w.kind === 'divider') {
        dividerColor = v
        x.note('color on a Divider is the colour of its line; set border color')
      } else if (
        here &&
        Object.hasOwn(here.props, k) &&
        w.props[k] === undefined &&
        name === 'base'
      ) {
        const r = fix(x, k, v)
        if (r !== DROP) w.props[k] = r ?? v
        x.note(
          `${k} is a setting of <${w.kind}>, not a style; set as the ${k} setting`,
        )
      } else if (
        (k === 'span' || k === 'colSpan' || k === 'rowSpan') &&
        typeof v === 'number' &&
        name === 'base'
      ) {
        const to = k === 'rowSpan' ? 'rows' : 'cols'
        w.extras.slot = {
          ...(w.extras.slot as Obj | undefined),
          [to]: clampN(Math.round(v), 1, 12),
        }
        x.note(`${k} is a cell's span; set as slot={{${to}:${v}}}`)
      } else if (k === 'justify' || k === 'align')
        x.note(`${k} does not apply to a ${w.kind}; dropped`)
      else x.note(`${k} is not a style of a ${w.kind}; dropped`)
      continue
    }
    const r = fix(x, k, v)
    if (r === DROP) continue
    v = r === undefined ? v : r
    if (k === 'bg' && typeof v === 'string' && k0 === 'background')
      v = colour(v) ?? v
    out[k] = v
  }
  if (dividerColor !== undefined) {
    const col = colour(dividerColor)
    if (col !== undefined)
      out.border = {
        width: 1,
        ...(isObj(out.border) ? out.border : {}),
        color: col,
      }
  }
  return out
}

/** Every setting of a Culm element that is really a style, as the CSS name an author writes it, goes to `base`. */
export const STYLE_ALIASES = ALIAS

export function linkValue(v: unknown) {
  if (typeof v === 'string') return linkOf(v)
  if (isObj(v) && Object.keys(v).length === 1 && typeof v.href === 'string')
    return linkOf(v.href)
  return v
}

const BASE_KEYS = [
  'base',
  'tablet',
  'phone',
  'hover',
  'dark',
  'pressed',
  'focus',
  'current',
  'open',
  'checked',
  'invalid',
]

const SHAPE_SHORT_TYPES = [
  'scene',
  'curve',
  'arc',
  'wave',
  'chart',
  'diagram',
  'contours',
  'stamp',
] as const

function strokeValue(v: unknown): unknown {
  if (typeof v === 'string') {
    const m = /^(\S+?)\/(\d+(?:\.\d+)?)(?:\s+(dashed|dotted))?$/i.exec(v.trim())
    if (m) {
      const c = colour(m[1]) ?? m[1]
      const width = parseFloat(m[2]!)
      const dash =
        m[3]?.toLowerCase() === 'dashed'
          ? [6, 4]
          : m[3]?.toLowerCase() === 'dotted'
            ? [2, 3]
            : undefined
      return { color: c, width, ...(dash ? { dash } : {}) }
    }
  }
  if (isObj(v) && 'color' in v) {
    const sc = colour(v.color)
    return sc !== undefined ? { ...v, color: sc } : v
  }
  return v
}

function paintValue(v: unknown): unknown {
  if (typeof v === 'string') return colour(v) ?? v
  if (!isObj(v)) return v
  return {
    ...v,
    ...(colour(v.from) ? { from: colour(v.from) } : {}),
    ...(colour(v.to) ? { to: colour(v.to) } : {}),
    ...(Array.isArray(v.stops)
      ? {
          stops: v.stops.map(s =>
            isObj(s) && colour(s.color) ? { ...s, color: colour(s.color) } : s,
          ),
        }
      : {}),
  }
}

/** Edits the wants in place so every CSS-style value is in Culm's form; fills `c.warns` and `c.needs`. */
export function normalise(wants: Want[], c: Cx): void {
  const walk = (w: Want) => {
    const say = (m: string) =>
      c.warns.push({
        message: `${w.path}: ${m}`,
        jsx: { path: w.path, line: w.at.line, column: w.at.col },
      })
    // a Box does not lay out its children: with justify or align it is a Column
    if (w.kind === 'box') {
      const keys = Object.values(w.layers).flatMap(l =>
        isObj(l) ? Object.keys(l).map(k => ALIAS[k] ?? k) : [],
      )
      if (keys.some(k => k === 'justify' || k === 'align')) {
        w.kind = 'column'
        say(
          'a Box does not align its children; made it a Column (justify and align apply)',
        )
      }
    }
    for (const L of BASE_KEYS) {
      const d = w.layers[L]
      if (isObj(d)) w.layers[L] = layer(w, c, L, d, say)
    }
    if (Array.isArray(w.layers.when))
      w.layers.when = (w.layers.when as Obj[]).map(e =>
        isObj(e.decl) ? { ...e, decl: layer(w, c, 'when', e.decl, say) } : e,
      )
    // marks inside a Text
    const spec = kindDef(w.kind, c.registry)
    if (spec)
      for (const [key, setting] of Object.entries(spec.props))
        if (setting.type === 'link' && w.props[key] !== undefined)
          w.props[key] = linkValue(w.props[key])
    if (Array.isArray(w.props.runs)) {
      const t: Want = {
        ...w,
        kind: 'text',
        props: { level: w.props.level },
        extras: {},
        layers: {},
        children: [],
      }
      w.props.runs = (w.props.runs as Obj[]).map(r =>
        isObj(r)
          ? {
              ...r,
              ...(r.link !== undefined ? { link: linkValue(r.link) } : {}),
              ...(isObj(r.style)
                ? { style: layer(t, c, 'base', r.style, say) }
                : {}),
            }
          : r,
      )
    }
    // a Shape's geometry shorthands, paint, stroke and marks
    if (w.kind === 'shape') {
      for (const st of SHAPE_SHORT_TYPES) {
        if (w.props[st] !== undefined) {
          const val = w.props[st]
          delete w.props[st]
          if (w.props.geometry === undefined) {
            w.props.geometry = isObj(val) ? { ...val, type: st } : { type: st }
          }
        }
      }
      if (w.props.geometry === undefined && Array.isArray(w.props.marks))
        w.props.geometry = { type: 'scene' }
      const g = w.props.geometry
      const shape = typeof g === 'string' ? g : isObj(g) ? g.type : undefined
      if (typeof shape === 'string') {
        const type =
          (
            { rectangle: 'rect', circle: 'ellipse', oval: 'ellipse' } as Record<
              string,
              string
            >
          )[shape] ?? shape
        const geom: Obj = { ...(isObj(g) ? g : {}), type }
        if (type === 'contours') {
          if (typeof geom.rows === 'number' && geom.bands === undefined)
            geom.bands = geom.rows
          if (typeof geom.count === 'number' && geom.bands === undefined)
            geom.bands = geom.count
          delete geom.rows
          delete geom.count
          if (typeof geom.seed !== 'number') geom.seed = 1
        } else if (type === 'wave') {
          if (typeof geom.cycles === 'number' && geom.freq === undefined)
            geom.freq = geom.cycles
          delete geom.cycles
          if (typeof geom.amp !== 'number') geom.amp = 16
          if (typeof geom.freq !== 'number') geom.freq = 2
        } else if (type === 'stamp') {
          if (typeof geom.text !== 'string' || !geom.text) geom.text = 'SEAL'
        }
        w.props.geometry = geom
      }
      if (w.props.fill !== undefined) w.props.fill = paintValue(w.props.fill)
      if (w.props.stroke !== undefined)
        w.props.stroke = strokeValue(w.props.stroke)
      if (Array.isArray(w.props.marks)) {
        const fx: Ctx = {
          c,
          w,
          layer: 'base',
          decl: {},
          out: {},
          note: say,
        }
        w.props.marks = (w.props.marks as unknown[]).map(m => {
          if (!isObj(m)) return m
          const next: Obj = { ...m }
          if (isObj(next.wave)) {
            const wv: Obj = { ...next.wave }
            if (typeof wv.cycles === 'number' && wv.freq === undefined)
              wv.freq = wv.cycles
            delete wv.cycles
            if (typeof wv.amp !== 'number') wv.amp = 16
            if (typeof wv.freq !== 'number') wv.freq = 2
            next.wave = wv
          }
          if (next.fill !== undefined) next.fill = paintValue(next.fill)
          if (next.stroke !== undefined) next.stroke = strokeValue(next.stroke)
          if (typeof next.font === 'string') {
            const fv = fontValue(fx, next.font)
            if (fv !== DROP && fv !== undefined) next.font = fv
          }
          return next
        })
      }
    }
    w.children.forEach(walk)
  }
  wants.forEach(walk)
}
