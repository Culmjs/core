import {
  type Box,
  type Decl,
  type Kind,
  type KindSpec,
  type Node,
  type Run,
  type SiteStyles,
} from '../document/index.ts'
import { STYLE_GROUPS } from '../document/kinds.ts'
import { PROPS } from '../style/decl.ts'

/** Defaults for each kind, written once for the classes of that kind. Only kinds the page uses are written. */
export type CompileKind = Kind | 'field-control' | 'pattern' | 'run' | 'code'
export const KIND_CSS: Partial<Record<CompileKind, string>> = {
  free: 'display:grid;grid-auto-rows:minmax(24px,auto);position:relative;isolation:isolate',
  row: 'display:flex',
  column: 'display:flex;flex-direction:column',
  list: 'display:flex;flex-direction:column;margin:0;padding:0;list-style:none',
  grid: 'display:grid',
  form: 'display:flex;flex-direction:column;gap:10px',
  field: 'display:flex;flex-direction:column;gap:4px',
  'field-control':
    'box-sizing:border-box;width:100%;min-width:0;max-width:100%;min-height:44px;padding:.6em .8em;border:1px solid var(--s-line);border-radius:6px;background-color:var(--s-bg);color:inherit;font:inherit;letter-spacing:inherit;text-align:inherit;text-transform:inherit;text-decoration:inherit',
  menu: 'display:flex;flex-wrap:wrap;gap:16px',
  table: 'border-collapse:collapse',
  image: 'display:block',
  video: 'display:block',
  embed:
    'display:block;position:relative;width:100%;aspect-ratio:16/9;overflow:hidden',
  icon: 'display:inline-flex;align-items:center;justify-content:center;color:inherit;text-decoration:none',
  button: 'display:inline-flex;align-items:center;text-decoration:none',
  // a text at level code: the look's own corners, scrolling sideways instead of wrapping
  code: 'font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;overflow-x:auto;padding:16px;border-radius:var(--s-radius);margin:0',
  // the aspect ratio is --s-ar (set from the geometry); a width, height or aspect style on the node wins
  shape: 'display:block;width:100%;height:auto;aspect-ratio:var(--s-ar,auto)',
  divider: 'border:0;border-top:1px solid var(--s-line);margin:0',
}
export const CODE_HEX = /^#[0-9a-f]{6}$/i
export const FLEX = new Set<Kind>(['row', 'column', 'list', 'form'])
export const VARIANTS = [
  'base',
  'tablet',
  'hover',
  'pressed',
  'focus',
  'current',
  'open',
  'checked',
  'invalid',
  'dark',
  'phone',
] as const
export type Variant = (typeof VARIANTS)[number]
export type Rules = Record<Variant, string[]>
export const noRules = (): Rules =>
  Object.fromEntries(VARIANTS.map(v => [v, []])) as unknown as Rules
/** Selector tails for the state layers, in output order. All weigh 0,1,0 like the base. */
export const STATE_SEL: readonly [Variant, string][] = [
  ['hover', ':where(:hover)'],
  ['pressed', ':where(:active)'],
  ['focus', ':where(:focus-visible)'],
  ['current', ':where([aria-current="page"])'],
  ['open', ':where([open], :popover-open)'],
  ['checked', ':where(:checked)'],
  ['invalid', ':where(:user-invalid)'],
]
/** A layer every kind has, or one the kind lists in `states`; checkStyle refuses the rest at save. */
export const OWN = (spec: KindSpec, v: Variant) =>
  v === 'base' ||
  v === 'tablet' ||
  v === 'phone' ||
  v === 'hover' ||
  v === 'dark' ||
  spec.states.includes(v)

/** More rules for a class, besides its own; `key` puts what they depend on in the dedup key. `base` follows the class's base rule, `when` sits after the state layers. */
export type Extra = {
  key: string
  base?: (cls: string) => string
  when?: (cls: string) => string
  show?: (cls: string) => string
}
/** A text style sits under the block's own base: its declarations apply, and the block's own values win. A missing style is ignored. */
export function withTextStyle(
  w: Node,
  styles: SiteStyles['text'],
): NonNullable<Node['style']> {
  const ts =
    w.kind === 'text' && typeof w.props?.textStyle === 'string'
      ? styles.find(x => x.id === w.props!.textStyle)
      : undefined
  return ts
    ? { ...w.style, base: { ...ts.decl, ...w.style?.base } }
    : (w.style ?? {})
}

export const pick = (
  d: Decl | undefined,
  keys: readonly (keyof Decl)[],
): Decl =>
  Object.fromEntries(
    keys.filter(k => d?.[k] !== undefined).map(k => [k, d![k]]),
  )
export const TF = STYLE_GROUPS.TRANSFORM
/** A number that is safe to write: finite, else the fallback. */
export const fin = (v: unknown, d = 0): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : d
/** An integer of at least 1, or undefined. */
export const posInt = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : undefined
export const boxOk = (b: unknown): b is Box =>
  typeof b === 'object' &&
  b !== null &&
  ['x', 'y', 'w', 'h', 'z'].every(k =>
    Number.isFinite((b as Record<string, unknown>)[k]),
  )
/** The grid area of a box; nothing when a number is not finite. */
export const place = (b: unknown) =>
  boxOk(b)
    ? `grid-column:${b.x + 1} / span ${b.w};grid-row:${b.y + 1} / span ${b.h};z-index:${b.z}`
    : ''
/** `whole`: a track is at least as wide as its longest word, so a word is never split. */
export const cols = (n: number, whole = false) =>
  `grid-template-columns:repeat(${n},minmax(${whole ? 'min-content' : '0'},1fr))`
export const n = (v: unknown, d: number) => posInt(v) ?? d
/** The own entry of a table for a key, or undefined (a key such as `constructor` reads nothing). */
export const ownOf = <T>(o: Record<string, T>, k: unknown): T | undefined =>
  typeof k === 'string' && Object.hasOwn(o, k) ? o[k] : undefined
export const FLIP: Record<string, string> = { left: 'right', right: 'left' }
/** A declaration set reduced to the properties and values the style checks accept. */
export const checkedDecl = (d: Decl | undefined): Decl => {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(d ?? {})) {
    if (!Object.hasOwn(PROPS, k)) continue
    const ok = PROPS[k as keyof Decl].check(v)
    if (ok !== undefined) out[k] = ok
  }
  return out as Decl
}
export const SLOT_ALIGN = ['start', 'center', 'end', 'stretch']

/**
 * Items are flex, block or grid boxes, never list items, so a marker is drawn as a counter in `::before`.
 * The counter is named after the class, never after author text.
 */
// Only these reach CSS; any other value, `none` included, writes no counter.
export const MARKERS = new Set<unknown>([
  'disc',
  'circle',
  'square',
  'decimal',
  'decimal-leading-zero',
  'lower-roman',
  'upper-roman',
  'lower-alpha',
])
export const markerRules =
  (
    m: string,
    start: number | undefined,
    reversed: boolean,
    count: number,
    prefix: string,
  ) =>
  (cls: string) => {
    const s = `${prefix}s${cls.slice(prefix.length + 1)}`
    const BULLETS: Record<string, string> = {
      disc: '"\\2022"',
      circle: '"\\25E6"',
      square: '"\\25AA"',
    }
    // a leading-zero number (01) is set apart by a space, not a full stop
    const content =
      BULLETS[m] ??
      (m === 'decimal-leading-zero'
        ? `counter(${s},${m})`
        : `counter(${s},${m}) ". "`)
    // Bullet glyphs draw about 45% smaller than the browser's native disc. The origin keeps them on the first line's middle.
    const grow =
      m in BULLETS ? ';transform:scale(1.45);transform-origin:100% 50%' : ''
    // The default gutter sits in :where(), so a padding the list sets on itself wins.
    // As in HTML, `start` is the first item's number. The counter steps before each item, so it is reset one
    // step back. A reversed list with no `start` begins at the item count.
    const reset = reversed
      ? `${s} ${(start ?? count) + 1}`
      : `${s} ${(start ?? 1) - 1}`
    const step = reversed
      ? `;counter-increment:${s} -1`
      : `;counter-increment:${s}`
    return (
      `.${cls}{counter-reset:${reset}}:where(.${cls}){padding-inline-start:1.5em}.${cls}>*{position:relative${step}}` +
      `.${cls}>*::before{position:absolute;inset-inline-end:100%;padding-inline-end:.4em;white-space:nowrap;content:${content}${grow}}`
    )
  }

/**
 * The open page's entry in a menu (`currentMark`): bold with an arrow before it, or with brackets round it. The marks are generated content,
 * given an empty alternative so a screen reader hears the entry (which has aria-current="page") and not the glyphs. The arrow turns around on a right-to-left page.
 */
export const currentMarkRules =
  (mark: string, rtl: boolean) => (cls: string) => {
    const a = `.${cls} a[aria-current=page]`
    const glyph = (side: 'before' | 'after', c: string) =>
      `${a}::${side}{content:"${c}";content:"${c}" / ""}`
    // The dot hangs in the margin, so the entries keep one left edge.
    const dot = `${a}{position:relative}${a}::before{content:"";position:absolute;inset-inline-start:var(--dot-x,-16px);top:50%;width:6px;height:6px;margin-top:-3px;border-radius:50%;background:currentColor}`
    return (
      `${a}{text-decoration:none;font-weight:700}` +
      (mark === 'arrow'
        ? glyph('before', rtl ? '\\2190\\a0' : '\\2192\\a0')
        : mark === 'dot'
          ? dot
          : glyph('before', '[\\a0') + glyph('after', '\\a0]'))
    )
  }
/** `rows: lines` on a menu: each entry is its own row with a rule under it, the last without one. */
export const rowRules = (cls: string) =>
  `.${cls}{--dot-x:2px}.${cls} a{display:block;padding:13px 0 13px 16px;border-bottom:1px solid var(--s-line)}.${cls} a:last-child{border-bottom:0}`

/** Fine film grain: grey noise from the browser's own turbulence filter, no file. Blended with `overlay` over the box's fill, so it takes the colour of the box. */
export const GRAIN = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`
/** The words a text or button shows, after bound data was filled in (expand), for sizing a line to its parent. */
export const wordsOf = (w: Node) =>
  w.kind === 'button'
    ? String(w.props?.label ?? '')
    : Array.isArray(w.props?.runs)
      ? (w.props.runs as Run[]).map(r => r?.text ?? '').join('')
      : ''
/**
 * `fitWidth`: one line that spans its parent, with CSS only. The parent is a size container (the `:has(>.cls)` rule in compileStyles) and the size is
 * 100cqw over the line's width in em, which is the number of characters times an average advance. ponytail: 0.56em suits mixed-case sans type and 0.68em
 * capitals; a very narrow or very wide face, or wide letter spacing, lands a little under or over, so it is an estimate, not a measurement. Add a measuring
 * script only if that matters; the page script budget has no room. The vw line first is for a browser without container units, which drops the second.
 * The parent must have a width of its own (a block, Fill): a container shrinks to nothing when its width comes from its content.
 */
export const fitSize = (chars: number, caps: boolean) => {
  const k = Math.round((caps ? 0.68 : 0.56) * Math.max(1, chars) * 100) / 100
  return `font-size:clamp(8px,calc(100vw / ${k}),1000px);font-size:clamp(8px,calc(100cqw / ${k}),1000px)`
}

/** A details marker drawn in CSS: a plus that turns to a cross, or a chevron that turns over, at the end of the summary. `foldOn` keeps the content shown (and the summary inert) where the browser can show a closed details' content: from the tablet width up for "phone", everywhere for "never". */
export const detailsRules =
  (
    marker: 'plus' | 'chevron' | undefined,
    ms: number,
    fold: 'phone' | 'never' | undefined,
  ) =>
  (cls: string) => {
    const t = ms
      ? `;transition-property:transform;transition-duration:${ms}ms`
      : ''
    const bare = `.${cls}>summary{list-style:none}.${cls}>summary::-webkit-details-marker{display:none}`
    let css = ''
    if (marker)
      css +=
        `${bare}.${cls}>summary{display:flex;justify-content:space-between;align-items:center;gap:.5em}` +
        (marker === 'plus'
          ? `.${cls}>summary::after{content:"+";flex:none;font-weight:300;font-size:1.4em;line-height:1${t}}.${cls}[open]>summary::after{transform:rotate(45deg)}`
          : `.${cls}>summary::after{content:"";flex:none;width:.5em;height:.5em;margin-inline-end:.2em;border:solid currentColor;border-width:0 2px 2px 0;transform:rotate(45deg)${t}}.${cls}[open]>summary::after{transform:rotate(225deg)}`)
    if (fold) {
      const inert = `.${cls}::details-content{content-visibility:visible;height:auto;overflow:visible}${bare}.${cls}>summary{pointer-events:none;cursor:default}.${cls}>summary::after{display:none}`
      css += `@supports selector(::details-content){${fold === 'phone' ? `@media (min-width:601px){${inert}}` : inert}}`
    }
    return css
  }
/** A menu folded into a native disclosure: the panel hangs under the summary, or above it with data-up. */
export const dropdownRules =
  (fold?: 'phone', fix = false, toggle?: string) =>
  (cls: string) =>
    `.${cls} details{position:relative}.${cls} summary{display:inline-flex;align-items:center;gap:.4em;cursor:pointer;list-style:none}.${cls} summary::-webkit-details-marker{display:none}` +
    `.${cls} summary::after{content:"";width:.45em;height:.45em;border:solid currentColor;border-width:0 1.5px 1.5px 0;transform:translateY(-.1em) rotate(45deg)}.${cls} details[open]>summary::after{transform:translateY(.1em) rotate(225deg)}` +
    `.${cls} details>div{position:absolute;inset-inline-start:0;top:calc(100% + 6px);z-index:30;display:flex;flex-direction:column;align-items:stretch;gap:2px;min-width:max-content;padding:6px;background-color:var(--s-bg);border:1px solid var(--s-line);border-radius:var(--s-radius);box-shadow:0 8px 24px rgb(0 0 0/.12)}` +
    `.${cls} details[data-up]>div{top:auto;bottom:calc(100% + 6px)}${fold ? '' : `.${cls} details>div a{padding:.35em .7em}`}` +
    // `foldOn: phone`: the summary and the links are 44 px tall; from the tablet width up, where a closed details can show its content, the panel is the link row (the menu's own flex, gap and wrap) and the summary is gone. Elsewhere it stays the dropdown.
    (fold
      ? `.${cls} summary{min-height:44px}@media (max-width:600px){.${cls} :where(details>div a){display:inline-flex;align-items:center;min-height:44px;padding:.35em .7em}}@supports not selector(::details-content){.${cls} :where(details>div a){display:inline-flex;align-items:center;min-height:44px;padding:.35em .7em}}@supports selector(::details-content){@media (min-width:601px){.${cls} details,.${cls} details>div{gap:inherit;flex-wrap:inherit}.${cls} details::details-content{content-visibility:visible;height:auto;overflow:visible${fix ? ';gap:inherit' : ''}}.${cls} summary{display:none}.${cls} details>div{position:static;flex-direction:row;align-items:inherit;min-width:0;padding:0;background:none;border:0;border-radius:0;box-shadow:none}}}`
      : '') +
    (toggle
      ? `.${cls} summary{justify-content:center;width:44px;min-height:44px;padding:0;box-sizing:border-box;${toggle === 'box' ? 'background:color-mix(in srgb,currentColor 10%,transparent);border-radius:4px' : toggle === 'outline' ? 'border:1px solid color-mix(in srgb,currentColor 40%,transparent);border-radius:4px' : ''}}.${cls} summary::after{display:none}`
      : '')
/** `divide`: a thin line where the items of a row, a column, a list or a grid touch. `sigs` is the layout of each layer: `x` (side by side), `y` (stacked) or `gN` (a grid of N columns); a layer is written only where it differs from the one before. */
export const divideRules =
  (sigs: [string, string, string]) => (cls: string) => {
    const line = (g: string) =>
      g === 'x'
        ? `.${cls}>*+*{border-inline-start-width:1px}`
        : g === 'y'
          ? `.${cls}>*+*{border-top-width:1px}`
          : `.${cls}>:nth-child(n+${+g.slice(1) + 1}){border-top-width:1px}${g === 'g1' ? '' : `.${cls}>:not(:nth-child(${g.slice(1)}n+1)){border-inline-start-width:1px}`}`
    let css = `.${cls}>*{border:0 solid var(--s-line)}${line(sigs[0])}`
    if (sigs[1] !== sigs[0])
      css += `@media (max-width:1024px){.${cls}>*{border-width:0}${line(sigs[1])}}`
    if (sigs[2] !== sigs[1])
      css += `@media (max-width:600px){.${cls}>*{border-width:0}${line(sigs[2])}}`
    return css
  }
/** The links of a menu answering a pointer or focus (style `linkHover`; the layers write the --s-lh-* values this reads). Radius and room are on every link, so nothing shifts on hover. */
export const linkHoverRules =
  (lh: NonNullable<Decl['linkHover']>[]) => (cls: string) => {
    const any = (f: (x: NonNullable<Decl['linkHover']>) => unknown) =>
      lh.some(f)
    const base = [
      any(x => x.radius !== undefined || x.pill) &&
        'border-radius:var(--s-lh-r,0)',
      any(x => x.pill) && 'padding:var(--s-lh-p,0)',
      `transition-property:color,background-color,text-decoration-color${any(x => x.lift !== undefined) ? ',transform' : ''};transition-duration:${any(x => x.ms !== undefined) ? 'var(--s-lh-ms,150ms)' : '150ms'}`,
    ].filter(Boolean)
    const hover = [
      any(x => x.bg) && 'background-color:var(--s-lh-bg,transparent)',
      any(x => x.color) && 'color:var(--s-lh-c,currentColor)',
      any(x => x.underline !== undefined) &&
        'text-decoration:var(--s-lh-u,none)',
      any(x => x.lift !== undefined) &&
        'transform:translateY(var(--s-lh-y,0px))',
    ].filter(Boolean)
    return `.${cls} a{${base.join(';')}}${hover.length ? `.${cls} a:where(:hover,:focus-visible){${hover.join(';')}}` : ''}`
  }
export const TIP_CSS =
  ':where([data-tip]){position:relative}[data-tip]::after{content:attr(data-tip);position:absolute;left:50%;bottom:calc(100% + 6px);translate:-50% 4px;z-index:60;width:max-content;max-width:min(240px,70vw);padding:4px 8px;border-radius:6px;background:var(--s-ink);color:var(--s-bg);font:500 12px/1.35 var(--s-body,system-ui,sans-serif);text-align:center;text-transform:none;letter-spacing:normal;font-style:normal;text-decoration:none;white-space:normal;opacity:0;visibility:hidden;pointer-events:none}' +
  '[data-tip]:is(:hover,:focus-visible)::after{opacity:1;visibility:visible;translate:-50% 0}@media (prefers-reduced-motion: no-preference){[data-tip]::after{transition-property:opacity,translate,visibility;transition-duration:.15s}}'

export const swap4 = <T>(v: T, order: number[]): T =>
  Array.isArray(v) && v.length === 4 ? (order.map(i => v[i]) as T) : v
export const neg = (x: number) => (x ? -x : 0)
/** A declaration set with its physical sides turned around, for a right-to-left page. */
export function mirror<D extends Decl | undefined>(d: D): D {
  if (!d) return d
  const o: Decl = { ...d }
  if (o.padding !== undefined) o.padding = swap4(o.padding, [0, 3, 2, 1])
  if (o.margin !== undefined) o.margin = swap4(o.margin, [0, 3, 2, 1])
  if (o.radius !== undefined) {
    const r = o.radius
    o.radius =
      typeof r === 'object' && !Array.isArray(r) && 'n' in r
        ? { ...r, n: swap4(r.n, [1, 0, 3, 2]) }
        : swap4(r, [1, 0, 3, 2])
  }
  if (o.border?.sides)
    o.border = {
      ...o.border,
      sides: o.border.sides.map(x =>
        x === 'left' ? 'right' : x === 'right' ? 'left' : x,
      ),
    }
  if (o.borderLeft || o.borderRight) {
    const { borderLeft: l, borderRight: r } = o
    delete o.borderLeft
    delete o.borderRight
    if (r) o.borderLeft = r
    if (l) o.borderRight = l
  }
  if (o.borderWidth !== undefined)
    o.borderWidth = swap4(o.borderWidth, [0, 3, 2, 1])
  if (o.gradient)
    o.gradient = { ...o.gradient, angle: (360 - o.gradient.angle) % 360 }
  // A site shadow ({ style }) is one shared value, so it is left as it is.
  if (typeof o.shadow === 'object' && 'x' in o.shadow)
    o.shadow = { ...o.shadow, x: neg(o.shadow.x) }
  if (o.textShadow) o.textShadow = { ...o.textShadow, x: neg(o.textShadow.x) }
  if (o.gradient?.at)
    o.gradient = {
      ...o.gradient,
      at: o.gradient.at.replace(/left|right/, x =>
        x === 'left' ? 'right' : 'left',
      ) as never,
    }
  if (o.textFill)
    o.textFill = { ...o.textFill, angle: (360 - o.textFill.angle) % 360 }
  if (o.mask && (o.mask.edge === 'left' || o.mask.edge === 'right'))
    o.mask = { ...o.mask, edge: o.mask.edge === 'left' ? 'right' : 'left' }
  if (o.cut?.corners)
    o.cut = {
      ...o.cut,
      corners: o.cut.corners.map(
        x => ({ tl: 'tr', tr: 'tl', bl: 'br', br: 'bl' })[x] as typeof x,
      ),
    }
  return o as D
}
export const mirrorStyle = (s: Node['style']): Node['style'] =>
  s &&
  Object.fromEntries(
    Object.entries(s).map(([k, v]) => [
      k,
      k === 'when' && Array.isArray(v)
        ? v.map(x => ({ ...x, decl: mirror(x.decl) }))
        : typeof v === 'object'
          ? mirror(v as Decl)
          : v,
    ]),
  )
