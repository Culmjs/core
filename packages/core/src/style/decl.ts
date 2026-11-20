import {
  kindSpec,
  type AssetId,
  type Decl,
  type Ease,
  type Edge,
  type FontRef,
  type Kind,
  type KindSpec,
  type SiteStyles,
  type Style,
  type When,
} from '../document/index.ts'
import { isObj } from '../document/rules.ts'

export type StyleCtx = {
  fileUrl(id: AssetId): string | undefined
  fontFamily(ref: FontRef): string | undefined
}

type Prop = {
  check(v: unknown): unknown | undefined
  css(v: never, ctx: StyleCtx): string
}

const num = (v: unknown, lo: number, hi: number): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi
    ? v
    : undefined
const int = (
  v: unknown,
  lo: number,
  hi: number,
  step = 1,
): number | undefined =>
  num(v, lo, hi) !== undefined &&
  Math.abs((v as number) / step - Math.round((v as number) / step)) < 1e-9
    ? (v as number)
    : undefined
const oneOf =
  <T extends string>(...xs: T[]) =>
  (v: unknown): T | undefined =>
    xs.includes(v as T) ? (v as T) : undefined
const bool = (v: unknown) => (typeof v === 'boolean' ? v : undefined)

// --- Look-token hooks (Task 4.0b): variables lookVars sets only when the look has the token, so each has a fallback.
const LOOK_COLORS: Record<string, string> = {
  accent: 'var(--s-accent,var(--s-brand))',
  'on-accent': 'var(--s-on-accent,var(--s-bg))',
  deep: 'var(--s-deep,var(--s-ink))',
  'on-deep': 'var(--s-on-deep,var(--s-bg))',
  accentSoft:
    'color-mix(in srgb,var(--s-accent,var(--s-brand)) 12%,var(--s-bg))',
}
const EDGE =
  'border:var(--s-edge-w,1px) solid var(--s-edge-c,var(--s-line));box-shadow:var(--s-shadow,none)'
const SURFACES = {
  card: `${EDGE};border-radius:var(--s-radius)`,
  button: `${EDGE};border-radius:var(--s-btn-radius,var(--s-radius))`,
}
// --- end look-token hooks

const COLOR_NAMES = [
  'brand',
  'ink',
  'bg',
  'muted',
  'line',
  ...Object.keys(LOOK_COLORS),
]
/** Site style ids: nothing but these characters can reach a CSS identifier. */
export const STYLE_ID_RE = /^[a-z0-9-]{1,32}$/
const ref = (v: unknown): { style: string } | undefined =>
  isObj(v) &&
  Object.keys(v).length === 1 &&
  typeof v.style === 'string' &&
  STYLE_ID_RE.test(v.style)
    ? { style: v.style }
    : undefined
type C = string | { style: string }
const color = (v: unknown): C | undefined =>
  typeof v === 'string'
    ? COLOR_NAMES.includes(v) || /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(v)
      ? v
      : undefined
    : ref(v)
/** A colour as a style holds it: a token, a #rrggbb, or a site colour style (fx.ts checks the colour of a letter hover with it). */
export const checkColor = color
export const colorCss = (c: C) =>
  typeof c === 'object'
    ? `var(--s-c-${c.style})`
    : c.startsWith('#')
      ? c
      : (LOOK_COLORS[c] ?? `var(--s-${c})`)
/** A colour at a share of its strength (0 to 1), the rest transparent; absent or 1 is the colour itself, so nothing written before changes. */
const alphaCss = (c: C, a?: number) =>
  a === undefined || a === 1
    ? colorCss(c)
    : `color-mix(in srgb,${colorCss(c)} ${Math.round(a * 1e4) / 100}%,transparent)`

/** Spacing steps are a closed set; the scale itself lives in SiteStyles.space. */
export const SPACE_STEPS = ['xs', 's', 'm', 'l', 'xl', '2xl'] as const
type SpaceV = number | { step: (typeof SPACE_STEPS)[number] }
const space =
  (hi: number, lo = 0) =>
  (v: unknown): SpaceV | undefined =>
    isObj(v)
      ? Object.keys(v).length === 1 && SPACE_STEPS.includes(v.step as never)
        ? { step: v.step as (typeof SPACE_STEPS)[number] }
        : undefined
      : num(v, lo, hi)
const spaceCss = (v: SpaceV) =>
  typeof v === 'number' ? `${v}px` : `var(--s-space-${v.step})`

const SIZE_RANGE = {
  px: [0, 2000],
  '%': [0, 100],
  ch: [1, 200],
  vh: [0, 100],
  vw: [0, 100],
} as const
type SizeV = 'fit' | 'fill' | { n: number; unit: keyof typeof SIZE_RANGE }
const size = (v: unknown): SizeV | undefined => {
  if (v === 'fit' || v === 'fill') return v
  if (
    !isObj(v) ||
    typeof v.unit !== 'string' ||
    !Object.hasOwn(SIZE_RANGE, v.unit)
  )
    return undefined
  const [lo, hi] = SIZE_RANGE[v.unit as keyof typeof SIZE_RANGE]
  const n = num(v.n, lo, hi)
  return n === undefined
    ? undefined
    : { n, unit: v.unit as keyof typeof SIZE_RANGE }
}
/** Whether a width, height or slot basis is one the compiler can write: the one size rule, used by validation too. */
export const checkSize = size
const sizeCss = (v: SizeV) =>
  v === 'fit' ? 'fit-content' : v === 'fill' ? '100%' : `${v.n}${v.unit}`

const box4 =
  (hi: number, lo = 0) =>
  (v: unknown): number | [number, number, number, number] | undefined => {
    if (Array.isArray(v))
      return v.length === 4 && v.every(x => num(x, lo, hi) !== undefined)
        ? (v as [number, number, number, number])
        : undefined
    return num(v, lo, hi)
  }
const box4Css = (v: number | number[]) =>
  typeof v === 'number' ? `${v}px` : v.map(x => `${x}px`).join(' ')
/** Like box4, but each side may be a spacing step. */
const spaceBox =
  (hi: number, lo = 0) =>
  (v: unknown): SpaceV | SpaceV[] | undefined => {
    if (Array.isArray(v)) {
      const out = v.map(space(hi, lo))
      return v.length === 4 && out.every(x => x !== undefined)
        ? (out as SpaceV[])
        : undefined
    }
    return space(hi, lo)(v)
  }
const spaceBoxCss = (v: SpaceV | SpaceV[]) =>
  Array.isArray(v) ? v.map(spaceCss).join(' ') : spaceCss(v)

const px = (name: string, lo: number, hi: number) => ({
  check: (v: unknown) => num(v, lo, hi),
  css: (v: number) => `${name}:${v}px`,
})
const sz = (name: string) => ({
  check: size,
  css: (v: SizeV) => `${name}:${sizeCss(v)}`,
})
const flag = (css: string) => ({
  check: bool,
  css: (v: boolean) => (v ? css : ''),
})
const map = <T extends string>(name: string, values: Record<T, string>) => ({
  check: oneOf(...(Object.keys(values) as T[])),
  css: (v: T) => `${name}:${values[v]}`,
})

const only = (o: Record<string, unknown>, keys: string[]) =>
  Object.keys(o).every(k => keys.includes(k))
/** A px offset or blur written as numbers only; colour goes through colorCss. */
const pxs = (...xs: number[]) => xs.map(x => `${x}px`).join(' ')
const SIDES = ['top', 'right', 'bottom', 'left']
/** A signed length for an offset: px, %, ch, vh or vw, never fit or fill. */
const OFFSET_RANGE = {
  px: [-2000, 2000],
  '%': [-100, 100],
  ch: [-200, 200],
  vh: [-100, 100],
  vw: [-100, 100],
} as const
type OffsetV = { n: number; unit: keyof typeof OFFSET_RANGE }
const offset = (v: unknown): OffsetV | undefined => {
  if (
    !isObj(v) ||
    !only(v, ['n', 'unit']) ||
    typeof v.unit !== 'string' ||
    !Object.hasOwn(OFFSET_RANGE, v.unit)
  )
    return undefined
  const [lo, hi] = OFFSET_RANGE[v.unit as keyof typeof OFFSET_RANGE]
  const n = num(v.n, lo, hi)
  return n === undefined
    ? undefined
    : { n, unit: v.unit as keyof typeof OFFSET_RANGE }
}
const offsetCss = (v: OffsetV) => `${v.n}${v.unit}`

const POINTS = {
  'top-left': '0% 0%',
  top: '50% 0%',
  'top-right': '100% 0%',
  left: '0% 50%',
  center: '50% 50%',
  right: '100% 50%',
  'bottom-left': '0% 100%',
  bottom: '50% 100%',
  'bottom-right': '100% 100%',
}
/** Easing names are the only way an author reaches a timing function. */
export const EASES: Record<Ease, string> = {
  smooth: 'cubic-bezier(0.4,0,0.2,1)',
  out: 'cubic-bezier(0,0,0.2,1)',
  'in-out': 'cubic-bezier(0.65,0,0.35,1)',
  spring: 'cubic-bezier(0.34,1.56,0.64,1)',
  linear: 'linear',
}
const TRANSITIONS = {
  colour: 'color,background-color,border-color',
  transform: 'transform',
  opacity: 'opacity',
  size: 'width,height',
  all: 'all',
}
const NAME_RE = /^[a-z][a-z0-9-]{0,15}$/
const FILTERS = {
  brightness: [0, 2, 'brightness({})'],
  contrast: [0, 2, 'contrast({})'],
  saturate: [0, 3, 'saturate({})'],
  grayscale: [0, 1, 'grayscale({})'],
  hue: [-180, 180, 'hue-rotate({}deg)'],
} as const
const CORNERS = ['tl', 'tr', 'br', 'bl']
const FADES = {
  top: 'to bottom',
  bottom: 'to top',
  left: 'to right',
  right: 'to left',
}
const CLIPS = {
  circle: 'clip-path:circle(50%)',
  pill: 'border-radius:9999px;overflow:hidden',
  arch: 'border-radius:9999px 9999px 0 0;overflow:hidden',
  blob: 'clip-path:ellipse(50% 42% at 50% 50%)',
}

/** Tracks and their sizes in a grid template. A minmax side takes a length or fit (min-/max-content). */
type TrackV =
  | 'fit'
  | { fr: number }
  | { n: number; unit: 'px' | '%' }
  | { min: SizeV; max: SizeV }
const trackSide = (v: unknown): SizeV | undefined => {
  const r = size(v)
  return r === 'fill' ? undefined : r
}
const track = (v: unknown): TrackV | undefined => {
  if (v === 'fit') return v
  if (!isObj(v)) return undefined
  if ('fr' in v) {
    const fr = num(v.fr, 0.1, 12)
    return only(v, ['fr']) && fr !== undefined ? { fr } : undefined
  }
  if ('min' in v) {
    const [min, max] = [trackSide(v.min), trackSide(v.max)]
    return only(v, ['min', 'max']) && min !== undefined && max !== undefined
      ? { min, max }
      : undefined
  }
  const r = size(v)
  return isObj(r) &&
    only(v, ['n', 'unit']) &&
    (r.unit === 'px' || r.unit === '%')
    ? { n: r.n, unit: r.unit }
    : undefined
}
const sideCss = (v: SizeV, fit: string) => (v === 'fit' ? fit : sizeCss(v))
const trackCss = (v: TrackV): string =>
  v === 'fit'
    ? 'max-content'
    : 'fr' in v
      ? `${v.fr}fr`
      : 'min' in v
        ? `minmax(${sideCss(v.min, 'min-content')},${sideCss(v.max, 'max-content')})`
        : `${v.n}${v.unit}`
const tracks = (max: number) => (v: unknown) => {
  if (!Array.isArray(v) || v.length < 1 || v.length > max) return undefined
  const out = v.map(track)
  return out.every(x => x !== undefined) ? out : undefined
}

export const SHADOWS = {
  soft: '0 2px 8px rgb(0 0 0 / 0.12)',
  strong: '0 8px 24px rgb(0 0 0 / 0.28)',
}
type ShadowV =
  string | { x: number; y: number; blur: number; spread: number; color: C }
/** The box-shadow value of a named or custom shadow; site shadows are written as variables holding this. */
export const shadowText = (v: ShadowV) =>
  typeof v === 'string'
    ? SHADOWS[v as keyof typeof SHADOWS]
    : `${pxs(v.x, v.y, v.blur, v.spread)} ${colorCss(v.color)}`
const FONT_RE = /^(sys:(sans|serif|mono)|(cat|up):[A-Za-z0-9_-]{1,64})$/
const ASSET_RE = /^[A-Za-z0-9_-]{1,64}$/

// Key order here is the order declarations are written in.
export const PROPS = {
  width: sz('width'),
  minWidth: sz('min-width'),
  maxWidth: sz('max-width'),
  height: sz('height'),
  minHeight: sz('min-height'),
  aspect: {
    check: (v: unknown) => num(v, 0.25, 4),
    css: (v: number) => `aspect-ratio:${v}`,
  },
  padding: {
    check: spaceBox(400),
    css: (v: SpaceV | SpaceV[]) => `padding:${spaceBoxCss(v)}`,
  },
  margin: {
    check: spaceBox(400, -400),
    css: (v: SpaceV | SpaceV[]) => `margin:${spaceBoxCss(v)}`,
  },
  // After margin, so it wins over the inline sides of a margin value.
  place: {
    check: oneOf('start', 'center', 'end'),
    css: (v: 'start' | 'center' | 'end') =>
      v === 'start'
        ? 'margin-inline-end:auto'
        : v === 'end'
          ? 'margin-inline-start:auto'
          : 'margin-inline:auto',
  },
  gap: { check: space(200), css: (v: SpaceV) => `gap:${spaceCss(v)}` },
  direction: map('flex-direction', { row: 'row', column: 'column' }),
  wrap: flag('flex-wrap:wrap'),
  justify: map('justify-content', {
    start: 'start',
    center: 'center',
    end: 'end',
    between: 'space-between',
    around: 'space-around',
  }),
  align: map('align-items', {
    start: 'start',
    center: 'center',
    end: 'end',
    stretch: 'stretch',
    baseline: 'baseline',
  }),
  bg: { check: color, css: (v: C) => `background-color:${colorCss(v)}` },
  bgImage: {
    check: (v: unknown) =>
      typeof v === 'string' && ASSET_RE.test(v) ? v : undefined,
    css: (v: string, ctx: StyleCtx) => {
      const u = ctx.fileUrl(v)
      return u
        ? `background-image:url("${encodeURI(u).replace(/"/g, '%22')}");background-size:cover`
        : ''
    },
  },
  color: { check: color, css: (v: C) => `color:${colorCss(v)}` },
  // Look-token hook (Task 4.0b). Before border, radius and shadow, so those keys on the same widget win.
  surface: {
    check: oneOf('card', 'button'),
    css: (v: keyof typeof SURFACES) => SURFACES[v],
  },
  border: {
    check: (v: unknown) => {
      if (!isObj(v) || !only(v, ['width', 'style', 'color', 'sides']))
        return undefined
      const width = num(v.width, 0, 20)
      const c = color(v.color)
      if (
        width === undefined ||
        c === undefined ||
        !oneOf('solid', 'dashed', 'dotted', 'double')(v.style)
      )
        return undefined
      if (v.sides === undefined)
        return { width, style: v.style as string, color: c }
      const sides = v.sides
      if (
        !Array.isArray(sides) ||
        sides.length < 1 ||
        sides.length > 4 ||
        new Set(sides).size !== sides.length ||
        !sides.every(x => oneOf(...SIDES)(x))
      )
        return undefined
      return {
        width,
        style: v.style as string,
        color: c,
        sides: SIDES.filter(x => sides.includes(x)),
      }
    },
    css: (v: { width: number; style: string; color: C; sides?: string[] }) => {
      const b = `${v.width}px ${v.style} ${colorCss(v.color)}`
      return v.sides
        ? v.sides.map(x => `border-${x}:${b}`).join(';')
        : `border:${b}`
    },
  },
  radius: {
    check: (v: unknown) => {
      if (isObj(v)) {
        const n = num(v.n, 0, 100)
        return only(v, ['n', 'unit']) && v.unit === '%' && n !== undefined
          ? { n, unit: '%' }
          : undefined
      }
      return box4(999)(v)
    },
    css: (v: number | number[] | { n: number; unit: '%' }) =>
      `border-radius:${typeof v === 'object' && !Array.isArray(v) ? `${v.n}%` : box4Css(v as number | number[])}`,
  },
  gradient: {
    check: (v: unknown) => {
      if (!isObj(v) || !only(v, ['angle', 'stops', 'shape', 'at']))
        return undefined
      const angle = num(v.angle, 0, 360)
      if (
        angle === undefined ||
        !Array.isArray(v.stops) ||
        v.stops.length < 2 ||
        v.stops.length > 4
      )
        return undefined
      if (v.shape !== undefined && !oneOf('linear', 'radial')(v.shape))
        return undefined
      // The centre belongs to a radial gradient only.
      if (
        v.at !== undefined &&
        (v.shape !== 'radial' ||
          !oneOf(...(Object.keys(POINTS) as (keyof typeof POINTS)[]))(v.at))
      )
        return undefined
      const stops = []
      for (const x of v.stops) {
        const c =
          isObj(x) && only(x, ['color', 'at', 'alpha'])
            ? color(x.color)
            : undefined
        const at = isObj(x) ? num(x.at, 0, 100) : undefined
        const alpha =
          isObj(x) && x.alpha !== undefined ? num(x.alpha, 0, 1) : undefined
        if (
          c === undefined ||
          at === undefined ||
          (isObj(x) && x.alpha !== undefined && alpha === undefined)
        )
          return undefined
        stops.push({ color: c, at, ...(alpha === undefined ? {} : { alpha }) })
      }
      return {
        angle,
        stops,
        ...(v.shape === undefined ? {} : { shape: v.shape }),
        ...(v.at === undefined ? {} : { at: v.at }),
      }
    },
    css: (v: {
      angle: number
      stops: { color: C; at: number; alpha?: number }[]
      shape?: 'linear' | 'radial'
      at?: keyof typeof POINTS
    }) =>
      `background-image:${v.shape === 'radial' ? `radial-gradient(circle at ${POINTS[v.at ?? 'center']}` : `linear-gradient(${v.angle}deg`},${v.stops.map(x => `${alphaCss(x.color, x.alpha)} ${x.at}%`).join(',')})`,
  },
  blur: {
    check: (v: unknown) => num(v, 0, 40),
    css: (v: number) =>
      `backdrop-filter:blur(${v}px);-webkit-backdrop-filter:blur(${v}px)`,
  },
  shadow: {
    check: (v: unknown) => {
      if (typeof v === 'string')
        return Object.hasOwn(SHADOWS, v) ? v : undefined
      if (isObj(v) && 'style' in v) return ref(v)
      if (!isObj(v) || !only(v, ['x', 'y', 'blur', 'spread', 'color']))
        return undefined
      const [x, y, blur, spread, c] = [
        num(v.x, -100, 100),
        num(v.y, -100, 100),
        num(v.blur, 0, 200),
        num(v.spread, -100, 100),
        color(v.color),
      ]
      return x === undefined ||
        y === undefined ||
        blur === undefined ||
        spread === undefined ||
        c === undefined
        ? undefined
        : { x, y, blur, spread, color: c }
    },
    css: (v: ShadowV | { style: string }) =>
      `box-shadow:${typeof v === 'object' && 'style' in v ? `var(--s-sh-${(v as { style: string }).style})` : shadowText(v as ShadowV)}`,
  },
  opacity: {
    check: (v: unknown) => int(v, 0, 1, 0.05),
    css: (v: number) => `opacity:${v}`,
  },
  // Look-token hook (Task 4.0b). Before font, letterSpacing and upper, so those keys on the same widget win.
  label: {
    check: (v: unknown) => (v === true ? v : undefined),
    css: () =>
      'font-family:var(--s-label,inherit);text-transform:var(--s-label-case,none);letter-spacing:var(--s-label-track,normal)',
  },
  font: {
    check: (v: unknown) =>
      typeof v === 'string' && FONT_RE.test(v) ? v : undefined,
    css: (v: FontRef, ctx: StyleCtx) => {
      const f = ctx.fontFamily(v)
      return f ? `font-family:${f}` : ''
    },
  },
  size: px('font-size', 8, 240),
  weight: {
    check: (v: unknown) => int(v, 100, 900, 100),
    css: (v: number) => `font-weight:${v}`,
  },
  lineHeight: {
    check: (v: unknown) => num(v, 0.8, 4),
    css: (v: number) => `line-height:${v}`,
  },
  letterSpacing: {
    check: (v: unknown) => num(v, -0.1, 0.5),
    css: (v: number) => `letter-spacing:${v}em`,
  },
  italic: flag('font-style:italic'),
  underline: {
    check: bool,
    css: (v: boolean) => `text-decoration:${v ? 'underline' : 'none'}`,
  },
  // strike relies on underline coming earlier in PROPS: declCss merges the two line lists when both are on.
  strike: flag('text-decoration-line:line-through'),
  underlineColor: {
    check: color,
    css: (v: C) => `text-decoration-color:${colorCss(v)}`,
  },
  underlineOffset: px('text-underline-offset', 0, 20),
  baseline: map('vertical-align', { super: 'super', sub: 'sub' }),
  smallCaps: flag('font-variant-caps:small-caps'),
  // Keeps a chip, a date or a figure on one line.
  nowrap: flag('white-space:nowrap'),
  textShadow: {
    check: (v: unknown) => {
      if (!isObj(v) || !only(v, ['x', 'y', 'blur', 'color'])) return undefined
      const [x, y, blur, c] = [
        num(v.x, -50, 50),
        num(v.y, -50, 50),
        num(v.blur, 0, 100),
        color(v.color),
      ]
      return x === undefined ||
        y === undefined ||
        blur === undefined ||
        c === undefined
        ? undefined
        : { x, y, blur, color: c }
    },
    css: (v: { x: number; y: number; blur: number; color: C }) =>
      `text-shadow:${pxs(v.x, v.y, v.blur)} ${colorCss(v.color)}`,
  },
  // Outlined lettering. Not hollow: the stroke is painted under the fill, so it does not eat into the letters.
  textStroke: {
    check: (v: unknown) => {
      if (!isObj(v) || !only(v, ['width', 'color', 'hollow'])) return undefined
      const [width, c] = [int(v.width, 0.5, 4, 0.5), color(v.color)]
      if (
        width === undefined ||
        c === undefined ||
        (v.hollow !== undefined && bool(v.hollow) === undefined)
      )
        return undefined
      return {
        width,
        color: c,
        ...(v.hollow === undefined ? {} : { hollow: v.hollow as boolean }),
      }
    },
    css: (v: { width: number; color: C; hollow?: boolean }) =>
      `-webkit-text-stroke:${v.width}px ${colorCss(v.color)};${v.hollow === false ? 'paint-order:stroke fill' : '-webkit-text-fill-color:transparent'}`,
  },
  // Only the gradient is written here (as --s-tf, so a hover or phone layer can change it). compile.ts paints it into the letters in one shared rule
  // that holds only where the browser can clip a background to text and forced colours are off, so everywhere else the plain `color` shows.
  textFill: {
    check: (v: unknown) => {
      if (
        !isObj(v) ||
        !only(v, ['from', 'to', 'angle', 'fromAlpha', 'toAlpha'])
      )
        return undefined
      const [from, to, angle] = [
        color(v.from),
        color(v.to),
        num(v.angle, 0, 360),
      ]
      const fromAlpha =
        v.fromAlpha === undefined ? undefined : num(v.fromAlpha, 0, 1)
      const toAlpha = v.toAlpha === undefined ? undefined : num(v.toAlpha, 0, 1)
      if (
        from === undefined ||
        to === undefined ||
        angle === undefined ||
        (v.fromAlpha !== undefined && fromAlpha === undefined) ||
        (v.toAlpha !== undefined && toAlpha === undefined)
      )
        return undefined
      return {
        from,
        to,
        angle,
        ...(fromAlpha === undefined ? {} : { fromAlpha }),
        ...(toAlpha === undefined ? {} : { toAlpha }),
      }
    },
    css: (v: {
      from: C
      to: C
      angle: number
      fromAlpha?: number
      toAlpha?: number
    }) =>
      `--s-tf:linear-gradient(${v.angle}deg,${alphaCss(v.from, v.fromAlpha)},${alphaCss(v.to, v.toAlpha)})`,
  },
  // The size itself (a share of the parent's width, from the number of characters) is written by compile.ts, which knows the words.
  fitWidth: flag('white-space:nowrap'),
  upper: flag('text-transform:uppercase'),
  textAlign: map('text-align', {
    start: 'start',
    center: 'center',
    end: 'end',
    justify: 'justify',
  }),
  order: {
    check: (v: unknown) => int(v, -50, 50),
    css: (v: number) => `order:${v}`,
  },
  // Float works in a Box (block flow): text after it wraps around it, as on many homepages.
  float: {
    check: oneOf('start', 'end'),
    css: (v: 'start' | 'end') => `float:inline-${v}`,
  },
  sticky: { check: oneOf('top'), css: () => 'position:sticky;top:0' },
  // inset/margin/width reset the browser's popover centring, so a pinned layer sits on the edge.
  pin: {
    check: oneOf('top', 'bottom'),
    css: (v: 'top' | 'bottom') =>
      `position:fixed;inset:auto;${v}:0;left:0;right:0;margin:0;width:auto;max-width:none;z-index:50`,
  },
  overflow: {
    check: oneOf('visible', 'clip', 'scroll-x', 'scroll-y'),
    css: (v: string) =>
      v === 'scroll-x'
        ? 'overflow-x:auto'
        : v === 'scroll-y'
          ? 'overflow-y:auto;overscroll-behavior:contain'
          : `overflow:${v}`,
  },
  snap: flag('scroll-snap-type:x mandatory'),
  hidden: flag('display:none'),
  position: map('position', {
    relative: 'relative',
    absolute: 'absolute',
    fixed: 'fixed',
    sticky: 'sticky',
  }),
  inset: {
    check: (v: unknown) => {
      if (!isObj(v) || !Object.keys(v).length || !only(v, SIDES))
        return undefined
      const out: Record<string, OffsetV> = {}
      for (const k of SIDES) {
        if (v[k] === undefined) continue
        const o = offset(v[k])
        if (o === undefined) return undefined
        out[k] = o
      }
      return out
    },
    css: (v: Record<string, OffsetV>) =>
      SIDES.filter(k => v[k])
        .map(k => `${k}:${offsetCss(v[k])}`)
        .join(';'),
  },
  // compile.ts adds this to the z-index it already writes for Free slots and front/behind blocks.
  z: {
    check: (v: unknown) => int(v, -10, 100),
    css: (v: number) => `z-index:${v}`,
  },
  // The four transform parts are written together as one `transform` by declCss.
  move: {
    check: (v: unknown) => {
      if (!isObj(v) || !only(v, ['x', 'y'])) return undefined
      const [x, y] = [offset(v.x), offset(v.y)]
      return x === undefined || y === undefined ? undefined : { x, y }
    },
    css: (v: { x: OffsetV; y: OffsetV }) =>
      `transform:translate(${offsetCss(v.x)},${offsetCss(v.y)})`,
  },
  rotate: {
    check: (v: unknown) => num(v, -360, 360),
    css: (v: number) => `transform:rotate(${v}deg)`,
  },
  scale: {
    check: (v: unknown) => num(v, 0.1, 3),
    css: (v: number) => `transform:scale(${v})`,
  },
  skew: {
    check: (v: unknown) => {
      if (!isObj(v) || !only(v, ['x', 'y'])) return undefined
      const [x, y] = [num(v.x, -45, 45), num(v.y, -45, 45)]
      return x === undefined || y === undefined ? undefined : { x, y }
    },
    css: (v: { x: number; y: number }) => `transform:skew(${v.x}deg,${v.y}deg)`,
  },
  // Written as part of the one `transform` (transformCss); its blur joins the `filter`.
  flip: {
    check: (v: unknown) => {
      if (
        !isObj(v) ||
        !only(v, ['x', 'y', 'blur']) ||
        (v.x !== undefined && bool(v.x) === undefined) ||
        (v.y !== undefined && bool(v.y) === undefined)
      )
        return undefined
      const blur = v.blur === undefined ? undefined : num(v.blur, 0, 20)
      if (
        (v.blur !== undefined && blur === undefined) ||
        (v.x !== true && v.y !== true)
      )
        return undefined
      return {
        ...(v.x === true ? { x: true } : {}),
        ...(v.y === true ? { y: true } : {}),
        ...(blur ? { blur } : {}),
      }
    },
    css: (v: { x?: boolean; y?: boolean }) =>
      `transform:scale(${v.x ? -1 : 1},${v.y ? -1 : 1})`,
  },
  origin: {
    check: oneOf(...(Object.keys(POINTS) as (keyof typeof POINTS)[])),
    css: (v: keyof typeof POINTS) => `transform-origin:${POINTS[v]}`,
  },
  columns: {
    check: tracks(12),
    css: (v: TrackV[]) => `grid-template-columns:${v.map(trackCss).join(' ')}`,
  },
  rows: {
    check: tracks(24),
    css: (v: TrackV[]) => `grid-template-rows:${v.map(trackCss).join(' ')}`,
  },
  areas: {
    check: (v: unknown) => {
      if (!Array.isArray(v) || v.length < 1 || v.length > 12) return undefined
      const w = Array.isArray(v[0]) ? v[0].length : 0
      const ok =
        w >= 1 &&
        w <= 12 &&
        v.every(
          r =>
            Array.isArray(r) &&
            r.length === w &&
            r.every(
              c => typeof c === 'string' && (c === '.' || NAME_RE.test(c)),
            ),
        )
      return ok ? v : undefined
    },
    css: (v: string[][]) =>
      `grid-template-areas:${v.map(r => `"${r.join(' ')}"`).join(' ')}`,
  },
  filter: {
    check: (v: unknown) => {
      if (!isObj(v) || !Object.keys(v).length || !only(v, Object.keys(FILTERS)))
        return undefined
      const out: Record<string, number> = {}
      for (const [k, [lo, hi]] of Object.entries(FILTERS)) {
        if (v[k] === undefined) continue
        const n = num(v[k], lo, hi)
        if (n === undefined) return undefined
        out[k] = n
      }
      return out
    },
    css: (v: Record<string, number>) =>
      `filter:${Object.entries(FILTERS)
        .filter(([k]) => v[k] !== undefined)
        .map(([k, [, , f]]) => f.replace('{}', String(v[k])))
        .join(' ')}`,
  },
  backdropBlur: {
    check: (v: unknown) => num(v, 0, 40),
    css: (v: number) =>
      `backdrop-filter:blur(${v}px);-webkit-backdrop-filter:blur(${v}px)`,
  },
  blend: map('mix-blend-mode', {
    multiply: 'multiply',
    screen: 'screen',
    overlay: 'overlay',
    darken: 'darken',
    lighten: 'lighten',
    'color-dodge': 'color-dodge',
    'color-burn': 'color-burn',
    difference: 'difference',
  }),
  clip: {
    check: oneOf('circle', 'pill', 'arch', 'blob'),
    css: (v: keyof typeof CLIPS) => CLIPS[v],
  },
  fade: {
    check: oneOf('top', 'right', 'bottom', 'left'),
    css: (v: keyof typeof FADES) => {
      const g = `linear-gradient(${FADES[v]}, transparent, #000 45%)`
      return `-webkit-mask-image:${g};mask-image:${g}`
    },
  },
  mask: {
    check: (v: unknown) => {
      if (!isObj(v) || !only(v, ['edge', 'strength'])) return undefined
      const strength = int(v.strength, 5, 100)
      return oneOf('top', 'right', 'bottom', 'left', 'radial')(v.edge) &&
        strength !== undefined
        ? { edge: v.edge as Edge | 'radial', strength }
        : undefined
    },
    css: (v: { edge: Edge | 'radial'; strength: number }) => {
      const g =
        v.edge === 'radial'
          ? `radial-gradient(closest-side,#000 ${100 - v.strength}%,transparent 100%)`
          : `linear-gradient(${FADES[v.edge]}, transparent, #000 ${v.strength}%)`
      return `-webkit-mask-image:${g};mask-image:${g}`
    },
  },
  cut: {
    check: (v: unknown) => {
      if (!isObj(v) || !only(v, ['shape', 'size', 'corners'])) return undefined
      const size = num(v.size, 2, 200)
      if (!oneOf('chamfer', 'notch')(v.shape) || size === undefined)
        return undefined
      if (v.corners === undefined)
        return { shape: v.shape as 'chamfer' | 'notch', size }
      const c = v.corners
      if (
        !Array.isArray(c) ||
        c.length < 1 ||
        c.length > 4 ||
        new Set(c).size !== c.length ||
        !c.every(x => oneOf(...CORNERS)(x))
      )
        return undefined
      return {
        shape: v.shape as 'chamfer' | 'notch',
        size,
        corners: CORNERS.filter(x => c.includes(x)),
      }
    },
    css: (v: {
      shape: 'chamfer' | 'notch'
      size: number
      corners?: string[]
    }) => {
      const s = `${v.size}px`,
        e = (a: string) => `calc(100% - ${s}) ${a}`,
        f = (a: string) => `${a} calc(100% - ${s})`
      const on = (c: string) => !v.corners || v.corners.includes(c)
      const n = v.shape === 'notch'
      // clockwise from the top left; each corner is one point when square, two (a slant) or three (a bite) when cut
      const pts = [
        on('tl')
          ? n
            ? [`0 ${s}`, `${s} ${s}`, `${s} 0`]
            : [`0 ${s}`, `${s} 0`]
          : ['0 0'],
        on('tr')
          ? n
            ? [e('0'), e(s), `100% ${s}`]
            : [e('0'), `100% ${s}`]
          : ['100% 0'],
        on('br')
          ? n
            ? [f('100%'), `calc(100% - ${s}) calc(100% - ${s})`, e('100%')]
            : [f('100%'), e('100%')]
          : ['100% 100%'],
        on('bl')
          ? n
            ? [`${s} 100%`, f(s), f('0')]
            : [`${s} 100%`, f('0')]
          : ['0 100%'],
      ].flat()
      return `clip-path:polygon(${pts.join(',')})`
    },
  },
  // Only a marker is written here; the shared rule that shows the block after scrolling is written by compile.ts.
  appearAfter: {
    check: (v: unknown) => num(v, 10, 400),
    css: (v: number) => `--s-ap:${v}`,
  },
  fluidSize: {
    check: (v: unknown) => {
      if (!isObj(v) || !only(v, ['min', 'max'])) return undefined
      const [min, max] = [num(v.min, 8, 240), num(v.max, 8, 240)]
      return min === undefined || max === undefined || max < min
        ? undefined
        : { min, max }
    },
    // Scales from the phone width (390px) to the desktop width (1280px); 890 is the difference.
    css: (v: { min: number; max: number }) =>
      `font-size:clamp(${v.min}px, calc(${v.min}px + (${v.max} - ${v.min}) * ((100vw - 390px) / 890)), ${v.max}px)`,
  },
  textColumns: {
    check: (v: unknown) => int(v, 1, 4),
    css: (v: number) => `column-count:${v}`,
  },
  clampLines: {
    check: (v: unknown) => int(v, 1, 10),
    css: (v: number) =>
      `display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:${v};overflow:hidden`,
  },
  balance: flag('text-wrap:balance'),
  // Only the strength is written here; compile.ts draws the noise in one shared rule per page (a ::before under the content).
  grain: {
    check: (v: unknown) => int(v, 0, 1, 0.05),
    css: (v: number) => `--s-grain:${v}`,
  },
  // Only the glow is written here (as --s-sp, which reads --px and --py from the nearest container with `track`); compile.ts draws it in one shared ::after rule under the content, centred in the box until the pointer script moves it.
  spotlight: {
    check: (v: unknown) => {
      if (!isObj(v) || !only(v, ['size', 'color', 'strength'])) return undefined
      const [size, c, strength] = [
        int(v.size, 40, 1600),
        color(v.color),
        int(v.strength, 0.05, 1, 0.05),
      ]
      return size === undefined || c === undefined || strength === undefined
        ? undefined
        : { size, color: c, strength }
    },
    css: (v: { size: number; color: C; strength: number }) =>
      `--s-sp:radial-gradient(circle ${v.size}px at calc(var(--px,.5)*100%) calc(var(--py,.5)*100%),${alphaCss(v.color, v.strength)},transparent)`,
  },
  // Only a marker is written here (so the block has a class); compile.ts pins the footer in one shared rule (live pages, wide windows) because the rule reaches the footer's wrapper, not the block.
  reveal: { check: bool, css: (v: boolean) => (v ? '--s-rv:1' : '') },
  transition: {
    check: (v: unknown) => {
      if (!isObj(v) || !only(v, ['what', 'ms', 'ease', 'delay']))
        return undefined
      const [ms, delay] = [
        int(v.ms, 0, 2000),
        v.delay === undefined ? 0 : int(v.delay, 0, 2000),
      ]
      if (
        !oneOf(...(Object.keys(TRANSITIONS) as (keyof typeof TRANSITIONS)[]))(
          v.what,
        ) ||
        !oneOf(...(Object.keys(EASES) as Ease[]))(v.ease) ||
        ms === undefined ||
        delay === undefined
      )
        return undefined
      return {
        what: v.what as string,
        ms,
        ease: v.ease as string,
        ...(v.delay === undefined ? {} : { delay }),
      }
    },
    css: (v: {
      what: keyof typeof TRANSITIONS
      ms: number
      ease: Ease
      delay?: number
    }) =>
      `transition-property:${TRANSITIONS[v.what]};transition-duration:${v.ms}ms;transition-timing-function:${EASES[v.ease]};transition-delay:${v.delay ?? 0}ms`,
  },
  fit: map('object-fit', { cover: 'cover', contain: 'contain' }),
  focus: {
    check: (v: unknown) => {
      if (!isObj(v) || !only(v, ['x', 'y'])) return undefined
      const [x, y] = [num(v.x, 0, 100), num(v.y, 0, 100)]
      return x === undefined || y === undefined ? undefined : { x, y }
    },
    css: (v: { x: number; y: number }) => `object-position:${v.x}% ${v.y}%`,
  },
  // Only custom properties are written here; compile.ts turns them into the links' rules (a menu has no per-link style of its own).
  linkHover: {
    check: (v: unknown) => {
      if (
        !isObj(v) ||
        !Object.keys(v).length ||
        !only(v, ['bg', 'color', 'radius', 'underline', 'pill', 'lift', 'ms'])
      )
        return undefined
      const out: Record<string, unknown> = {}
      for (const k of ['bg', 'color'])
        if (v[k] !== undefined) {
          const c = color(v[k])
          if (c === undefined) return undefined
          out[k] = c
        }
      for (const k of ['underline', 'pill'])
        if (v[k] !== undefined) {
          if (bool(v[k]) === undefined) return undefined
          out[k] = v[k]
        }
      for (const [k, lo, hi] of [
        ['radius', 0, 999],
        ['lift', -12, 12],
        ['ms', 0, 1000],
      ] as const)
        if (v[k] !== undefined) {
          const n = num(v[k], lo, hi)
          if (n === undefined) return undefined
          out[k] = n
        }
      return out
    },
    css: (v: {
      bg?: C
      color?: C
      radius?: number
      underline?: boolean
      pill?: boolean
      lift?: number
      ms?: number
    }) =>
      [
        v.bg && `--s-lh-bg:${colorCss(v.bg)}`,
        v.color && `--s-lh-c:${colorCss(v.color)}`,
        v.underline !== undefined &&
          `--s-lh-u:${v.underline ? 'underline' : 'none'}`,
        v.pill
          ? '--s-lh-r:999px;--s-lh-p:.3em .8em'
          : v.radius !== undefined && `--s-lh-r:${v.radius}px`,
        v.lift !== undefined && `--s-lh-y:${v.lift}px`,
        v.ms !== undefined && `--s-lh-ms:${v.ms}ms`,
      ]
        .filter(Boolean)
        .join(';'),
  },
  cursor: map('cursor', {
    default: 'default',
    pointer: 'pointer',
    text: 'text',
    grab: 'grab',
    move: 'move',
    'not-allowed': 'not-allowed',
    'zoom-in': 'zoom-in',
    help: 'help',
    crosshair: 'crosshair',
  }),
} satisfies Record<keyof Decl, Prop>

const KEYS = Object.keys(PROPS) as (keyof Decl)[]

const TRANSFORMS: (keyof Decl)[] = ['move', 'rotate', 'scale', 'skew', 'flip']
/** One `transform` from whichever of move, rotate, scale and skew are set, in that order. */
function transformCss(d: Decl): string {
  const f: string[] = []
  if (d.move) f.push(PROPS.move.css(d.move as never).slice('transform:'.length))
  if (d.rotate !== undefined) f.push(`rotate(${d.rotate}deg)`)
  if (d.scale !== undefined) f.push(`scale(${d.scale})`)
  if (d.skew) f.push(`skew(${d.skew.x}deg,${d.skew.y}deg)`)
  if (d.flip) f.push(`scale(${d.flip.x ? -1 : 1},${d.flip.y ? -1 : 1})`)
  // a flip's blur is a filter: written here unless the block has a filter of its own, which takes it on (declCss)
  return `transform:${f.join(' ')}${d.flip?.blur && !d.filter ? `;filter:blur(${d.flip.blur}px)` : ''}`
}

export function declCss(d: Decl, ctx: StyleCtx): string {
  const out: string[] = []
  let moved = false
  for (const k of KEYS) {
    if (d[k] === undefined) continue
    if (TRANSFORMS.includes(k)) {
      if (!moved) out.push(transformCss(d))
      moved = true
      continue
    }
    let s = (PROPS[k].css as (v: unknown, c: StyleCtx) => string)(d[k], ctx)
    if (k === 'strike' && d.underline && s)
      s = 'text-decoration-line:underline line-through'
    if (k === 'filter' && d.flip?.blur) s += ` blur(${d.flip.blur}px)`
    if (s) out.push(s)
  }
  return out.join(';')
}

/** Writes `<` as a CSS escape so a value can never close a style element. */
export function escapeCss(s: string): string {
  return s.replace(/</g, '\\3c ')
}

/** Every style layer. `UNIVERSAL` layers apply to every kind; the rest need the kind to list them in `states`. */
export const STATES: readonly Exclude<keyof Style, 'when'>[] = [
  'base',
  'tablet',
  'phone',
  'hover',
  'pressed',
  'focus',
  'current',
  'open',
  'checked',
  'invalid',
  'dark',
]
const UNIVERSAL: readonly Exclude<keyof Style, 'when'>[] = [
  'base',
  'tablet',
  'phone',
  'hover',
  'dark',
]

/** Names every site style a clean declaration points at that `styles` does not have. */
export function missingRefs(
  d: Decl,
  styles: Pick<SiteStyles, 'colors' | 'shadows'>,
): string[] {
  const out: string[] = []
  const walk = (v: unknown, top?: string) => {
    if (Array.isArray(v)) return v.forEach(x => walk(x))
    if (!isObj(v)) return
    if (typeof v.style === 'string' && Object.keys(v).length === 1) {
      const list = top === 'shadow' ? styles.shadows : styles.colors
      if (!list.some(x => x.id === v.style))
        out.push(`${top === 'shadow' ? 'shadow' : 'colour'} style "${v.style}"`)
      return
    }
    for (const x of Object.values(v)) walk(x)
  }
  for (const [k, v] of Object.entries(d)) walk(v, k)
  return out
}

/** Every declaration a style holds: its layers, then the layers that react to a state. */
export const declsOf = (s: Style | undefined): Decl[] =>
  s
    ? [
        ...STATES.flatMap(k => s[k] ?? []),
        ...(Array.isArray(s.when) ? s.when : []).map(x => x.decl),
      ]
    : []

/** A state's name or value: lower case, digits and dashes, so nothing typed can reach an attribute or selector. */
export const STATE_NAME = /^[a-z0-9-]{1,32}$/
export const MAX_WHEN = 16
/** Words the renderer already uses as `data-s-<word>` attributes; a state can't take them. */
export const RESERVED = new Set([
  'on',
  'enter',
  'in',
  'open',
  'theme',
  'scope',
  'pattern',
])
/** A state's name: the grammar, and not a reserved word. */
export const stateNameOk = (v: unknown): v is string =>
  typeof v === 'string' && STATE_NAME.test(v) && !RESERVED.has(v)
/** With `styles`, a reference to a site colour or shadow it does not hold is a problem; without, only the shape is checked. `extraKinds` are the kinds a registry's plug-ins add. */
export function checkStyle(
  kind: Kind,
  s: unknown,
  styles?: Pick<SiteStyles, 'colors' | 'shadows'>,
  extraKinds?: ReadonlyMap<string, KindSpec>,
): { style?: Style; problems: string[] } {
  const problems: string[] = []
  const style: Style = {}
  if (!isObj(s)) return { problems: ['style must be an object'] }
  const spec = kindSpec(kind, extraKinds)
  if (!spec) return { problems: [`${kind} is not a known kind`] }
  const allowed = new Set<string>(spec.styles)
  for (const key of Object.keys(s))
    if (key !== 'when' && !(STATES as readonly string[]).includes(key))
      problems.push(`style.${key} is not a style state`)
  /** One layer's declarations: only properties the kind has, each held to its own check. */
  const layer = (label: string, d: Record<string, unknown>): Decl => {
    const clean: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(d)) {
      // An undefined value is no value (JSON drops it), as a tree built in memory may hold one.
      if (v === undefined) continue
      if (!Object.hasOwn(PROPS, k))
        problems.push(`${label}.${k} is not a style property`)
      else if (!allowed.has(k))
        problems.push(`${label}.${k} does not apply to ${kind}`)
      else {
        const ok = PROPS[k as keyof Decl].check(v)
        if (ok === undefined)
          problems.push(`${label}.${k} has a value that is not allowed`)
        else clean[k] = ok
      }
    }
    if (styles)
      for (const m of missingRefs(clean as Decl, styles))
        problems.push(`${label} uses a ${m} the site does not have`)
    return clean as Decl
  }
  for (const st of STATES) {
    const d = s[st]
    if (d === undefined) continue
    if (!UNIVERSAL.includes(st) && !spec.states.includes(st)) {
      problems.push(`style.${st} does not apply to ${kind}`)
      continue
    }
    if (!isObj(d)) {
      problems.push(`style.${st} must be an object`)
      continue
    }
    style[st] = layer(`style.${st}`, d)
  }
  if (s.when !== undefined) {
    if (!Array.isArray(s.when) || s.when.length > MAX_WHEN)
      problems.push('style.when must be a list of at most 16 layers')
    else {
      const when: When[] = []
      s.when.forEach((w, i) => {
        const label = `style.when[${i}]`
        if (
          !isObj(w) ||
          Object.keys(w).some(
            k => k !== 'state' && k !== 'is' && k !== 'decl',
          ) ||
          !isObj(w.decl)
        )
          return void problems.push(
            `${label} is not a state, a value and a style`,
          )
        if (
          !stateNameOk(w.state) ||
          typeof w.is !== 'string' ||
          !STATE_NAME.test(w.is)
        )
          return void problems.push(
            `${label} has a state name or value that is not allowed`,
          )
        when.push({
          state: w.state,
          is: w.is,
          decl: layer(`${label}.decl`, w.decl),
        })
      })
      style.when = when
    }
  }
  return problems.length ? { problems } : { style, problems }
}
