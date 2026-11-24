import { type Color, type Node, type ShapeGeometry } from '../document/index.ts'
import { checkColor, colorCss } from '../style/decl.ts'
import { geometryBad } from '../validate/tree.ts'
import { domId, el, type Attrs, type Build } from './elementsBase.ts'
import { type HtmlNode } from './html.ts'
import { partPaint, type PartPaint as How } from '../document/shapePaint.ts'

const r2 = (x: number) => Math.round(x * 100) / 100
const clamp = (x: number) => Math.min(100, Math.max(0, x))
const nums = (...xs: number[]) => xs.map(r2).join(' ')

/** The same seed always draws the same blob, in every version: these two functions are part of the file format. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A closed blob in a 100 x 100 box: `points` radii of 30 to 50 round (50, 50), joined by a Catmull-Rom curve (`smooth` 0 is the straight-sided polygon). */
export function blobPath(seed: number, smooth: number, points: number): string {
  const rnd = mulberry32(seed)
  const p = Array.from({ length: points }, (_, i) => {
    const r = 50 * (1 - 0.4 * rnd()),
      a = (2 * Math.PI * i) / points
    return [50 + r * Math.cos(a), 50 + r * Math.sin(a)] as const
  })
  const at = (i: number) => p[(i + points) % points]!
  let d = `M${nums(...at(0))}`
  for (let i = 0; i < points; i++) {
    const [x1, y1] = at(i),
      [x2, y2] = at(i + 1)
    if (smooth === 0) {
      d += `L${nums(x2, y2)}`
      continue
    }
    const k = smooth / 6,
      [px, py] = at(i - 1),
      [nx, ny] = at(i + 2)
    // control points are held inside the box; the curve itself stays inside the circle of radius 50
    d += `C${nums(clamp(x1 + (x2 - px) * k), clamp(y1 + (y2 - py) * k), clamp(x2 - (nx - x1) * k), clamp(y2 - (ny - y1) * k), x2, y2)}`
  }
  return `${d}Z`
}

/** Corner points of a regular polygon or a star in the 100 x 100 box, the first at the top before `rotate`. */
function ring(n: number, inner: number | undefined, rotate = 0): string {
  const count = inner === undefined ? n : 2 * n
  return Array.from({ length: count }, (_, i) => {
    const a = ((-90 + rotate + (360 * i) / count) * Math.PI) / 180,
      r = inner !== undefined && i % 2 ? 50 * inner : 50
    return `${r2(50 + r * Math.cos(a))},${r2(50 + r * Math.sin(a))}`
  }).join(' ')
}

const asColor = (v: unknown): Color | undefined =>
  checkColor(v) as Color | undefined

/** An id made safe like a class name (`.` to `_`, `~` to `-`), so a repeated row or a component copy keeps its own. */
const safeId = (id: string, end: string) =>
  `${domId(id).replace(/\./g, '_').replace(/~/g, '-')}-${end}`

type Paint = {
  style: string
  fill: string
  defs?: HtmlNode
  colors: string[]
}

/** The paint of a shape as inline style (a site colour is a CSS variable, which an attribute can't read), and the gradient it needs. */
function paint(id: string, p: Record<string, unknown>, line: boolean): Paint {
  const out: string[] = [],
    colors: string[] = []
  const css = (c: Color) => {
    const v = colorCss(c)
    colors.push(v)
    return v
  }
  let defs: HtmlNode | undefined
  const f = p.fill
  if (line || f === 'none') out.push('fill:none')
  else if (typeof f === 'object' && f !== null && 'from' in f) {
    const gr = f as { from: unknown; to: unknown; angle?: unknown }
    const from = asColor(gr.from),
      to = asColor(gr.to)
    const angle = typeof gr.angle === 'number' ? gr.angle : 180
    const s = Math.sin((angle * Math.PI) / 180),
      c = Math.cos((angle * Math.PI) / 180)
    const gid = safeId(id, 'g'),
      pc = (x: number) => `${r2(x * 100)}%`
    out.push(`fill:url(#${gid})`)
    defs = el('defs', {}, [
      el(
        'lineargradient',
        {
          id: gid,
          x1: pc(0.5 - s / 2),
          y1: pc(0.5 + c / 2),
          x2: pc(0.5 + s / 2),
          y2: pc(0.5 - c / 2),
        },
        [
          el('stop', {
            offset: 0,
            style: `stop-color:${css(from ?? 'brand')}`,
          }),
          el('stop', { offset: 1, style: `stop-color:${css(to ?? 'brand')}` }),
        ],
      ),
    ])
  } else out.push(`fill:${css(asColor(f) ?? 'brand')}`)
  const s = p.stroke as
    { color?: unknown; width?: unknown; dash?: unknown } | undefined
  // a line with no stroke would be invisible
  const stroke = s ?? (line ? { color: 'brand', width: 2 } : undefined)
  if (stroke) {
    out.push(
      `stroke:${css(asColor(stroke.color) ?? 'brand')}`,
      `stroke-width:${typeof stroke.width === 'number' ? stroke.width : 1}`,
    )
    if (Array.isArray(stroke.dash))
      out.push(`stroke-dasharray:${stroke.dash.join(' ')}`)
  }
  if (typeof p.opacity === 'number') out.push(`opacity:${p.opacity}`)
  // `--s-shd-<id>` is the site shadow without its spread (written by the look's variables), as drop-shadow() takes
  if (typeof p.shadow === 'string' && /^[a-z0-9-]{1,32}$/.test(p.shadow)) {
    colors.push(`var(--s-shd-${p.shadow})`)
    out.push(`filter:drop-shadow(var(--s-shd-${p.shadow}))`)
  }
  return { style: out.join(';'), fill: out[0]!, defs, colors }
}

/** The CSS a shape's paint points at, as text: the style compiler reads it to write the site colours and shadows the page uses. */
export function shapeRefs(p: Record<string, unknown>): string {
  return paint('x', p, false).colors.join(' ')
}

/** The immediate geometry of this shape, never a path inside its defs or a nested SVG. */
export const directPath = (shape?: HtmlNode) =>
  shape?.children?.find(
    (e): e is HtmlNode => typeof e !== 'string' && e.tag === 'path',
  )

type Part = { attr: Attrs; style: string[]; kids: HtmlNode[] }

/** A rounded rectangle of a known size as a path, each corner its own radius (held to half the short side). */
function roundRect(w: number, h: number, radius: number | number[]): string {
  const m = Math.min(w, h) / 2
  const [tl, tr, br, bl] = (
    Array.isArray(radius) ? radius : [radius, radius, radius, radius]
  ).map(x => Math.min(x, m))
  const a = (r: number, x: number, y: number) => `A${r} ${r} 0 0 1 ${x} ${y}`
  return `M${tl} 0H${w - tr!}${a(tr!, w, tr!)}V${h - br!}${a(br!, w - br!, h)}H${bl}${a(bl!, 0, h - bl!)}V${tl}${a(tl!, tl!, 0)}Z`
}

/** What one geometry draws: the svg's own attributes and style, and its marks. `size` is the slot of a part in a group. */
function geometry(
  w: Node,
  p: Record<string, unknown>,
  g: ShapeGeometry,
  pt: Paint,
  size?: [number, number],
  how: How = 'own',
  rendered?: Map<Node, HtmlNode>,
): Part {
  const attr: Attrs = {},
    style: string[] = [],
    kids: HtmlNode[] = []
  if (['rect', 'ellipse', 'line'].includes(g.type)) {
    if (!size)
      style.push(`--s-ar:${(('view' in g && g.view) || [1, 1]).join('/')}`)
  } else {
    const [vw, vh] =
      g.type === 'path' || g.type === 'group'
        ? (g.view ?? [100, 100])
        : [100, 100]
    attr.viewBox = `0 0 ${vw} ${vh}`
    attr.preserveAspectRatio =
      p.fit === 'cover'
        ? 'xMidYMid slice'
        : p.fit === 'stretch'
          ? 'none'
          : 'xMidYMid meet'
  }
  switch (g.type) {
    case 'rect': {
      const rs = Array.isArray(g.radius) ? g.radius : [g.radius ?? 0]
      if (size) {
        const [sw, sh] = size
        if (rs.length > 1 && !rs.every(x => x === rs[0]))
          kids.push(el('path', { d: roundRect(sw, sh, rs) }))
        else
          kids.push(
            el('rect', {
              x: 0,
              y: 0,
              width: '100%',
              height: '100%',
              rx: rs[0] ? Math.min(rs[0], sw / 2, sh / 2) : undefined,
            }),
          )
        break
      }
      kids.push(el('rect', { x: 0, y: 0, width: '100%', height: '100%' }))
      // ponytail: the corners are the element's own, so a stroke is cut at them; inside a group a path is drawn
      if (rs.some(x => x > 0))
        style.push(
          `border-radius:${(rs.every(x => x === rs[0]) ? [rs[0]!] : rs).map(x => `${x}px`).join(' ')}`,
        )
      break
    }
    case 'ellipse':
      kids.push(el('ellipse', { cx: '50%', cy: '50%', rx: '50%', ry: '50%' }))
      break
    case 'line':
      kids.push(
        el('line', {
          x1: `${g.from[0]}%`,
          y1: `${g.from[1]}%`,
          x2: `${g.to[0]}%`,
          y2: `${g.to[1]}%`,
        }),
      )
      style.push('overflow:visible')
      break
    case 'polygon':
      kids.push(el('polygon', { points: ring(g.sides, undefined, g.rotate) }))
      break
    case 'star':
      kids.push(el('polygon', { points: ring(g.points, g.inner, g.rotate) }))
      break
    case 'blob':
      kids.push(
        el('path', { d: blobPath(g.seed, g.smooth ?? 0.8, g.points ?? 6) }),
      )
      break
    case 'path':
      kids.push(el('path', { d: g.d }))
      break
    case 'group':
      kids.push(...groupKids(w, g, pt, how, rendered))
      break
  }
  return { attr, style, kids }
}

const validGeometry = (p: Record<string, unknown>) =>
  (geometryBad(p.geometry) ? { type: 'ellipse' } : p.geometry) as ShapeGeometry

/**
 * One part of a group at its slot, a nested svg. `own` keeps its paint, `bare` takes the group's, `cut` is black for a mask.
 * Ids come from the part's own (unrolled) id, so a repeated row or a component copy keeps its own gradient.
 */
function part(c: Node, how: How, rendered?: Map<Node, HtmlNode>): HtmlNode {
  const cp = (c.props ?? {}) as Record<string, unknown>
  const g = validGeometry(cp)
  const sl = c.slot as { x?: number; y?: number; w?: number; h?: number }
  const pt = paint(c.id, cp, g.type === 'line')
  const geo = geometry(c, cp, g, pt, [sl.w ?? 0, sl.h ?? 0], how, rendered)
  const own =
    how === 'own' ? pt.style : how === 'cut' ? 'fill:#000;stroke:none' : ''
  const svg = el(
    'svg',
    {
      x: sl.x,
      y: sl.y,
      width: sl.w,
      height: sl.h,
      ...geo.attr,
      style: [...geo.style, own].filter(Boolean).join(';') || undefined,
    },
    [how === 'own' ? pt.defs : undefined, ...geo.kids],
  )
  rendered?.set(c, svg)
  return svg
}

/** The parts of a group: each its own (layer), in one `g` with the group's fill (union), or the first under a mask the others cut (subtract). */
function groupKids(
  w: Node,
  g: Extract<ShapeGeometry, { type: 'group' }>,
  pt: Paint,
  how: How = 'own',
  rendered?: Map<Node, HtmlNode>,
): HtmlNode[] {
  const kids = w.children ?? []
  const child = (c: Node, i: number) =>
    part(c, partPaint(g.combine, i, how), rendered)
  // inside a union or a subtract the outer paint rules: an inner group writes none of its own, and its parts take the outer mode
  const fill = how === 'own' ? { style: pt.fill } : {}
  // ponytail: a gradient on a union or subtract is per part (objectBoundingBox); one ramp across the group needs userSpaceOnUse bounds in the group's view
  const [vw, vh] = g.view ?? [100, 100]
  if (g.combine === 'union') return [el('g', fill, kids.map(child))]
  if (g.combine === 'subtract' && kids.length) {
    const id = safeId(w.id, 'm')
    return [
      el('defs', {}, [
        el(
          'mask',
          {
            id,
            maskUnits: 'userSpaceOnUse',
            x: 0,
            y: 0,
            width: vw,
            height: vh,
          },
          [
            el('rect', {
              x: 0,
              y: 0,
              width: vw,
              height: vh,
              style: 'fill:#fff',
            }),
            ...kids.slice(1).map((c, i) => child(c, i + 1)),
          ],
        ),
      ]),
      el('g', { mask: `url(#${id})`, ...fill }, [child(kids[0]!, 0)]),
    ]
  }
  return kids.map(child)
}

export function shapeElement(b: Build): HtmlNode {
  const { w, p, attrs } = b
  const g = validGeometry(p)
  const pt = paint(w.id, p, g.type === 'line')
  const geo = geometry(w, p, g, pt, undefined, 'own', b.ctx.rendered)
  const label = typeof p.label === 'string' && p.label ? p.label : undefined
  return el(
    'svg',
    {
      ...attrs,
      ...geo.attr,
      role: label ? 'img' : undefined,
      'aria-label': label,
      'aria-hidden': label ? undefined : 'true',
      style: [...geo.style, pt.style].join(';'),
    },
    [pt.defs, ...geo.kids],
  )
}
