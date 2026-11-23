import type { Color, Decl, Node, SiteDocument } from '../document/index.ts'
import { walk } from '../document/tree.ts'
import { isAsInserted } from '../registry/block.ts'
import type { Registry } from '../registry/index.ts'
import { THRESHOLDS } from './checks.ts'

export type DocCheck =
  | 'no-accent'
  | 'starter-chrome'
  | 'side-stripe'
  | 'gradient-text'
  | 'glow'
  | 'emoji-icon'
export type DocHit = {
  check: DocCheck
  nodes: string[]
  observed: number | string
  expected: string
  message: string
}

const rgb = (hex: string): [number, number, number] | null => {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(hex)
  if (!m) return null
  let h = m[1]!
  if (h.length === 3) h = [...h].map(c => c + c).join('')
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)) as [
    number,
    number,
    number,
  ]
}
const range = (c: [number, number, number]) => Math.max(...c) - Math.min(...c)
/** Hue in HSL degrees. */
const hue = ([r, g, b]: [number, number, number]) => {
  const d = Math.max(r, g, b) - Math.min(r, g, b)
  if (!d) return 0
  const m = Math.max(r, g, b)
  const h =
    m === r ? ((g - b) / d) % 6 : m === g ? (b - r) / d + 2 : (r - g) / d + 4
  return (h * 60 + 360) % 360
}
/** Distance between two hues on the circle. */
const apart = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360
  return Math.min(d, 360 - d)
}

/** A colour as hex: as written, from the look, or from the site's colours. Neutral colours (muted, line, deep, on-deep, on-accent) and unknown styles are null. */
export function resolveColour(
  c: Color,
  doc: SiteDocument,
): `#${string}` | null {
  const { look } = doc
  if (typeof c === 'object')
    return doc.styles?.colors.find(x => x.id === c.style)?.value ?? null
  switch (c) {
    case 'brand':
      return look.brand as `#${string}`
    case 'ink':
      return look.ink as `#${string}`
    case 'bg':
      return look.bg as `#${string}`
    case 'accent':
    case 'accentSoft':
      return (look.accent ?? look.brand) as `#${string}`
    case 'muted':
    case 'line':
    case 'deep':
    case 'on-deep':
    case 'on-accent':
      return null
    default:
      return c
  }
}

/** A colour that reads as a chromatic one: its RGB range is at least `chroma`. */
const chromatic = (c: Color, doc: SiteDocument) => {
  const v = rgb(resolveColour(c, doc) ?? '')
  return !!v && range(v) >= THRESHOLDS.chroma
}

/** The brand, the accent, or a colour of the brand's hue (within `accentHue` degrees) that is not grey. */
export function isAccent(c: Color, doc: SiteDocument): boolean {
  if (c === 'brand' || c === 'accent' || c === 'accentSoft') return true
  const v = rgb(resolveColour(c, doc) ?? '')
  const brand = rgb(doc.look.brand)
  if (!v || !brand || range(v) < THRESHOLDS.chroma) return false
  return apart(hue(v), hue(brand)) <= THRESHOLDS.accentHue
}

const layers = (n: Node): Decl[] =>
  [n.style?.base, n.style?.tablet, n.style?.phone].filter((d): d is Decl => !!d)
const kindName = (n: Node) => `${n.kind[0]!.toUpperCase()}${n.kind.slice(1)}`
const label = (n: Node) => `${kindName(n)} "${n.name}"`
const wordsOf = (n: Node): string => {
  const runs = Array.isArray(n.props?.runs)
    ? (n.props.runs as { text?: string }[])
    : []
  return n.kind === 'button'
    ? String(n.props?.label ?? '')
    : runs.map(r => r.text ?? '').join('')
}
const EMOJI = /\p{Extended_Pictographic}/gu
const EMOJI_WORD = /^[\p{Extended_Pictographic}‍️\u{1f3fb}-\u{1f3ff}]+$/u

function noAccent(
  doc: SiteDocument,
  page: Node,
  footer: Node | undefined,
): DocHit | null {
  const { look } = doc
  if (
    (look.accent ?? '').toLowerCase() === look.ink.toLowerCase() ||
    (page.children?.length ?? 0) < 2
  )
    return null
  const accent = (c: Color | undefined) => !!c && isAccent(c, doc)
  const painted = (n: Node): boolean => {
    if (n.kind === 'menu') return false
    const style = doc.styles?.text.find(t => t.id === n.props?.textStyle)?.decl
    const big =
      /^h[1-4]$/.test(String(n.props?.level)) ||
      Math.max(
        ...layers(n).map(d => d.size ?? 0),
        typeof style?.size === 'number' ? style.size : 0,
      ) >= THRESHOLDS.accentText
    if (n.kind === 'text' && big && accent(style?.color)) return true
    if (n.kind === 'shape') {
      const { fill, stroke } = (n.props ?? {}) as {
        fill?: unknown
        stroke?: { color?: Color }
      }
      if (fill === undefined) return true
      if (typeof fill === 'object' && fill && 'style' in fill) {
        if (accent(fill as Color)) return true
      } else if (typeof fill === 'object' && fill) {
        const g = fill as { from?: Color; to?: Color }
        if (accent(g.from) || accent(g.to)) return true
      } else if (fill !== 'none' && accent(fill as Color)) return true
      if (accent(stroke?.color)) return true
    }
    return layers(n).some(
      d =>
        accent(d.bg) ||
        d.gradient?.stops.some(s => accent(s.color)) ||
        (d.border &&
          (d.border.width >= 2 || n.kind === 'divider') &&
          accent(d.border.color)) ||
        SIDE_KEYS.some(k => {
          const s = d[k]
          return !!s && s.width >= 2 && accent(s.color)
        }) ||
        (d.borderColor !== undefined &&
          accent(d.borderColor) &&
          Math.max(...[d.borderWidth ?? d.border?.width ?? 0].flat()) >= 2) ||
        (n.kind === 'text' && big && accent(d.color)),
    )
  }
  let found = false
  for (const t of [...(page.children?.slice(1) ?? []), footer])
    if (t) walk(t, n => void (found ||= painted(n)))
  if (found) return null
  return {
    check: 'no-accent',
    nodes: [page.id],
    observed: 'none',
    expected: 'the brand colour once below the hero',
    message: `Nothing below the hero of this page uses the brand colour: no brand background, border, divider, shape or large heading.`,
  }
}

const SIDE_KEYS = [
  'borderTop',
  'borderRight',
  'borderBottom',
  'borderLeft',
] as const
/** The one border a layer draws on a single side: a `border` with one side, or exactly one side property. */
function oneSide(
  d: Decl,
): { width: number; color: Color; side: string } | undefined {
  if (d.border?.sides?.length === 1)
    return { ...d.border, side: d.border.sides[0]! }
  const keys = SIDE_KEYS.filter(k => d[k])
  if (keys.length !== 1 || (d.border && !d.border.sides)) return undefined
  const k = keys[0]!
  return { ...d[k]!, side: k.slice(6).toLowerCase() }
}

const radiusOf = (d: Decl): boolean =>
  typeof d.radius === 'number'
    ? d.radius > 0
    : Array.isArray(d.radius)
      ? d.radius.some(r => r > 0)
      : !!d.radius &&
        (Array.isArray(d.radius.n)
          ? d.radius.n.some(n => n > 0)
          : d.radius.n > 0)

function tells(
  doc: SiteDocument,
  roots: Node[],
  sections: Set<string>,
): DocHit[] {
  const out: DocHit[] = []
  const T = THRESHOLDS
  const rootIds = new Set(roots.map(r => r.id))
  const shadowOf = (s: unknown) =>
    s && typeof s === 'object' && 'style' in s
      ? doc.styles?.shadows.find(x => x.id === (s as { style: string }).style)
          ?.value
      : s
  const seen = new Set<string>()
  const hit = (h: DocHit) => {
    const k = `${h.check}|${h.nodes.join()}`
    if (!seen.has(k)) {
      seen.add(k)
      out.push(h)
    }
  }
  if (doc.look.shadow === 'glow')
    hit({
      check: 'glow',
      nodes: [],
      observed: 'glow',
      expected: 'a shadow with an offset, or none',
      message: 'The look sets its shadow to glow.',
    })
  const emoji: Node[] = []
  let emojiCount = 0
  for (const root of roots)
    walk(root, n => {
      const ds = layers(n)
      for (const d of ds) {
        // side-stripe
        const b = oneSide(d)
        if (
          b &&
          !rootIds.has(n.id) &&
          !sections.has(n.id) &&
          !['button', 'menu', 'divider'].includes(n.kind) &&
          chromatic(b.color, doc)
        ) {
          const side = b.side
          const base = n.style?.base ?? {}
          const round = radiusOf(d) || radiusOf(base)
          const [lo, hi] = T.stripeEdge
          if (
            side === 'left' || side === 'right'
              ? b.width >= (round ? T.stripeSide : T.stripeFlat)
              : b.width >= lo && b.width <= hi && (d.bg || base.bg || round)
          )
            hit({
              check: 'side-stripe',
              nodes: [n.id],
              observed: `${b.width} px ${side}`,
              expected: 'no one-sided coloured border',
              message: `${label(n)} has a ${b.width} px coloured border on its ${side} side only.`,
            })
        }
        // glow
        for (const s of [shadowOf(d.shadow), d.textShadow] as (
          | { x: number; y: number; blur: number; color?: Color }
          | string
          | undefined
        )[])
          if (
            s &&
            typeof s === 'object' &&
            s.x === 0 &&
            s.y === 0 &&
            s.blur > 0 &&
            s.color !== undefined &&
            chromatic(s.color, doc)
          )
            hit({
              check: 'glow',
              nodes: [n.id],
              observed: `${s.blur} px blur`,
              expected: 'a shadow with an offset, or none',
              message: `${label(n)} has a coloured shadow with no offset and ${s.blur} px of blur, a glow.`,
            })
        // gradient-text
        if (d.textFill && ['text', 'button'].includes(n.kind))
          hit({
            check: 'gradient-text',
            nodes: [n.id],
            observed: 'textFill',
            expected: 'text in one colour',
            message: `${label(n)} is set in a gradient.`,
          })
      }
      if (n.kind === 'text' || n.kind === 'button') {
        const said = wordsOf(n)
        const words = said.split(/\s+/).filter(Boolean)
        if (words.length && words.every(w => EMOJI_WORD.test(w)))
          hit({
            check: 'emoji-icon',
            nodes: [n.id],
            observed: said.trim(),
            expected: 'an icon or a shape, not an emoji',
            message: `${label(n)} holds only emoji (${said.trim()}).`,
          })
        const c = said.match(EMOJI)?.length ?? 0
        if (c) {
          emojiCount += c
          emoji.push(n)
        }
      }
    })
  if (emojiCount >= T.emojiCount)
    for (const n of emoji)
      hit({
        check: 'emoji-icon',
        nodes: [n.id],
        observed: emojiCount,
        expected: `fewer than ${T.emojiCount} emoji on a page`,
        message: `${label(n)} holds emoji, one of ${emojiCount} on this page.`,
      })
  return out
}

/**
 * The document-only design findings of one page: the page root, then the header and footer, each with its component instances unrolled
 * (`trees` as `unrolledTrees` returns them; a tree is told apart by its id). Nothing here reads a layout.
 */
export function docDesign(
  doc: SiteDocument,
  page: string,
  trees: Node[],
  registry: Registry,
): DocHit[] {
  const pageRoot = doc.pages.find(p => p.id === page)?.root.id
  const root = trees.find(t => t.id === pageRoot)
  const footer = trees.find(t => t.id === doc.footer?.id && t !== root)
  const out: DocHit[] = []
  const na = root && noAccent(doc, root, footer)
  if (na) out.push(na)
  const sections = new Set(trees.flatMap(t => t.children?.map(c => c.id) ?? []))
  out.push(...tells(doc, trees, sections))
  // The starter's header and footer, still as inserted, on a site where the person has added nothing of their own.
  const pristine = doc.pages.every(p => {
    let ok = true
    const go = (n: Node, top: boolean) => {
      if (n.origin || n.kind === 'instance') return
      if (!top) ok = false
      for (const c of n.children ?? []) go(c, false)
    }
    go(p.root, true)
    return ok
  })
  if (!pristine)
    for (const t of trees)
      if (
        [doc.header?.id, doc.footer?.id].includes(t.id) &&
        t.origin &&
        isAsInserted(registry, t)
      )
        out.push({
          check: 'starter-chrome',
          nodes: [t.id],
          observed: t.origin.block,
          expected: 'a header and footer made the site’s own',
          message: `${label(t)} is still the starter's ${t.origin.block} as inserted, on a site with its own content.`,
        })
  return out
}
