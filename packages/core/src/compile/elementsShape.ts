import {
  type Color,
  type FontRef,
  type Node,
  type ShapeGeometry,
  type ShapePaint,
  type ShapeStroke,
} from '../document/index.ts'
import { lowerSceneGeometry, type LoweredPrimitive } from '../document/scene.ts'
import { checkColor, colorCss } from '../style/decl.ts'
import { fontFamily, type SiteFonts } from '../style/fonts.ts'
import { geometryBad } from '../validate/tree.ts'
import {
  SAFE_ID,
  domId,
  el,
  stateAttrs,
  type Attrs,
  type Build,
  type ElementCtx,
} from './elementsBase.ts'
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
  defItems?: HtmlNode[]
  colors: string[]
}

/** The paint of a shape as inline style (a site colour is a CSS variable, which an attribute can't read), and the gradient/filter it needs. */
function paint(
  id: string,
  p: Record<string, unknown>,
  line: boolean,
  defaultFill: ShapePaint = 'brand',
): Paint {
  const out: string[] = [],
    colors: string[] = [],
    defItems: HtmlNode[] = []
  const css = (c: Color) => {
    const v = colorCss(c)
    colors.push(v)
    return v
  }
  const f = p.fill === undefined ? defaultFill : p.fill
  if (line || f === 'none') out.push('fill:none')
  else if (
    typeof f === 'object' &&
    f !== null &&
    ('from' in f || 'stops' in f) &&
    !('style' in f)
  ) {
    const gr = f as {
      from?: unknown
      to?: unknown
      stops?: { color: unknown; at: number; alpha?: number }[]
      angle?: unknown
      radial?: [number, number, number]
    }
    const gid = safeId(id, 'g')
    const pc = (x: number) => `${r2(x * 100)}%`
    const stops =
      Array.isArray(gr.stops) && gr.stops.length >= 2
        ? gr.stops.map(s =>
            el('stop', {
              offset: `${r2(s.at)}%`,
              style: `stop-color:${css(asColor(s.color) ?? 'brand')}${s.alpha !== undefined && s.alpha < 1 ? `;stop-opacity:${r2(s.alpha)}` : ''}`,
            }),
          )
        : [
            el('stop', {
              offset: 0,
              style: `stop-color:${css(asColor(gr.from) ?? 'brand')}`,
            }),
            el('stop', {
              offset: 1,
              style: `stop-color:${css(asColor(gr.to) ?? 'brand')}`,
            }),
          ]
    out.push(`fill:url(#${gid})`)
    if (Array.isArray(gr.radial) && gr.radial.length === 3) {
      const [rx, ry, rr] = gr.radial
      const pct = (v: number) => `${r2(v <= 2 ? v * 100 : v)}%`
      defItems.push(
        el(
          'radialgradient',
          { id: gid, cx: pct(rx), cy: pct(ry), r: pct(rr) },
          stops,
        ),
      )
    } else {
      const angle = typeof gr.angle === 'number' ? gr.angle : 180
      const s = Math.sin((angle * Math.PI) / 180),
        c = Math.cos((angle * Math.PI) / 180)
      defItems.push(
        el(
          'lineargradient',
          {
            id: gid,
            x1: pc(0.5 - s / 2),
            y1: pc(0.5 + c / 2),
            x2: pc(0.5 + s / 2),
            y2: pc(0.5 - c / 2),
          },
          stops,
        ),
      )
    }
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
  const filters: string[] = []
  // `--s-shd-<id>` is the site shadow without its spread (written by the look's variables), as drop-shadow() takes
  if (typeof p.shadow === 'string' && /^[a-z0-9-]{1,32}$/.test(p.shadow)) {
    colors.push(`var(--s-shd-${p.shadow})`)
    filters.push(`drop-shadow(var(--s-shd-${p.shadow}))`)
  }
  const hasBlur = typeof p.blur === 'number' && p.blur > 0
  const hasGrain = typeof p.grain === 'number' && p.grain > 0
  if (hasBlur || hasGrain) {
    const fid = safeId(id, 'f')
    const fKids: HtmlNode[] = []
    if (hasBlur)
      fKids.push(
        el('fegaussianblur', {
          in: 'SourceGraphic',
          stddeviation: r2(p.blur as number),
          result: 'blurred',
        }),
      )
    if (hasGrain) {
      const alpha = r2(Math.min(1, Math.max(0, p.grain as number)) * 0.45)
      fKids.push(
        el('feturbulence', {
          type: 'fractalNoise',
          basefrequency: '0.85',
          numoctaves: '3',
          seed: '7',
          result: 'noise',
        }),
        el('fecolormatrix', {
          type: 'matrix',
          in: 'noise',
          values: `0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 ${alpha} 0`,
          result: 'grain',
        }),
        el('fecomposite', {
          in: 'grain',
          in2: hasBlur ? 'blurred' : 'SourceGraphic',
          operator: 'atop',
          result: 'clipped',
        }),
        el('feblend', {
          mode: 'multiply',
          in: hasBlur ? 'blurred' : 'SourceGraphic',
          in2: 'clipped',
        }),
      )
    }
    defItems.push(el('filter', { id: fid }, fKids))
    filters.push(`url(#${fid})`)
  }
  if (filters.length) out.push(`filter:${filters.join(' ')}`)
  return {
    style: out.join(';'),
    fill: out[0]!,
    defs: defItems.length ? el('defs', {}, defItems) : undefined,
    defItems,
    colors,
  }
}

/** The CSS a shape's paint points at, as text: the style compiler reads it to write the site colours and shadows the page uses. */
export function shapeRefs(p: Record<string, unknown>): string {
  const colors = [...paint('x', p, false).colors]
  const g = p.geometry as ShapeGeometry | undefined
  if (g && typeof g === 'object') {
    const scene = lowerSceneGeometry(g, p.marks, 'x')
    if (scene)
      for (const m of scene.primitives) {
        if ('fill' in m && m.fill !== undefined)
          colors.push(...paint('x', { fill: m.fill }, false).colors)
        if ('stroke' in m && m.stroke !== undefined)
          colors.push(
            ...paint('x', { fill: 'none', stroke: m.stroke }, false).colors,
          )
      }
  }
  return colors.join(' ')
}

/** The immediate geometry of this shape, never a path inside its defs or a nested SVG. */
export const directPath = (shape?: HtmlNode) =>
  shape?.children?.find(
    (e): e is HtmlNode => typeof e !== 'string' && e.tag === 'path',
  )

type Part = { attr: Attrs; style: string[]; kids: HtmlNode[]; defs: HtmlNode[] }

function renderScenePrimitives(
  shapeId: string,
  primitives: LoweredPrimitive[],
  parentPaint: { fill?: unknown; stroke?: unknown },
  fonts?: SiteFonts,
): { kids: HtmlNode[]; defs: HtmlNode[] } {
  const kids: HtmlNode[] = []
  const defs: HtmlNode[] = []
  let needArrow = false
  const arrowId = safeId(shapeId, 'arr')
  const arrowStroke =
    (
      primitives.find(p => 'markerEnd' in p && p.markerEnd && 'stroke' in p) as
        { stroke?: ShapeStroke } | undefined
    )?.stroke?.color ?? 'muted'

  primitives.forEach((m, i) => {
    const pid = `${shapeId}-m${i}`
    if (m.kind === 'text') {
      const tp = paint(
        pid,
        { fill: m.fill ?? 'ink', opacity: m.opacity, blur: m.blur },
        false,
      )
      if (tp.defItems?.length) defs.push(...tp.defItems)
      const fam = m.font ? fontFamily(m.font as FontRef, fonts) : undefined
      const style = [
        tp.style,
        `font-size:${m.size ?? 12}px`,
        m.weight ? `font-weight:${m.weight}` : '',
        fam ? `font-family:${fam}` : '',
        m.baseline ? `dominant-baseline:${m.baseline}` : '',
      ]
        .filter(Boolean)
        .join(';')
      if (m.textPath) {
        kids.push(
          el(
            'text',
            {
              'text-anchor': m.anchor ?? 'middle',
              style,
              ...(m.transform ? { transform: m.transform } : {}),
            },
            [
              el(
                'textpath',
                {
                  href: `#${m.textPath}`,
                  startoffset: m.startOffset ?? '50%',
                },
                [m.text],
              ),
            ],
          ),
        )
      } else {
        kids.push(
          el(
            'text',
            {
              x: m.x,
              y: m.y,
              'text-anchor': m.anchor ?? 'start',
              style,
              ...(m.transform ? { transform: m.transform } : {}),
            },
            [m.text],
          ),
        )
      }
      return
    }
    if (m.kind === 'path' && m.pathId) {
      defs.push(el('path', { id: m.pathId, d: m.d }))
      return
    }
    const isLine = m.kind === 'line'
    const fallbackFill =
      'fill' in m && m.fill !== undefined
        ? m.fill
        : parentPaint.fill !== undefined
          ? (parentPaint.fill as ShapePaint)
          : 'brand'
    const mp = paint(
      pid,
      {
        fill: isLine ? 'none' : fallbackFill,
        stroke:
          'stroke' in m ? (m.stroke ?? parentPaint.stroke) : parentPaint.stroke,
        opacity: m.opacity,
        blur: m.blur,
      },
      isLine,
    )
    if (mp.defItems?.length) defs.push(...mp.defItems)
    const common: Attrs = {
      style: mp.style,
      ...(m.transform ? { transform: m.transform } : {}),
    }
    if ('markerEnd' in m && m.markerEnd) {
      needArrow = true
      common['marker-end'] = `url(#${arrowId})`
    }
    switch (m.kind) {
      case 'rect':
        kids.push(
          el('rect', {
            x: m.x,
            y: m.y,
            width: m.w,
            height: m.h,
            ...(m.r ? { rx: m.r } : {}),
            ...common,
          }),
        )
        break
      case 'ellipse':
        kids.push(
          el('ellipse', { cx: m.cx, cy: m.cy, rx: m.rx, ry: m.ry, ...common }),
        )
        break
      case 'line':
        kids.push(
          el('line', { x1: m.x1, y1: m.y1, x2: m.x2, y2: m.y2, ...common }),
        )
        break
      case 'path':
        kids.push(el('path', { d: m.d, ...common }))
        break
    }
  })
  if (needArrow) {
    defs.push(
      el(
        'marker',
        {
          id: arrowId,
          viewBox: '0 0 10 10',
          refX: '9',
          refY: '5',
          markerWidth: '6',
          markerHeight: '6',
          orient: 'auto-start-reverse',
        },
        [
          el('path', {
            d: 'M 0 1.5 L 9 5 L 0 8.5 z',
            style: `fill:${colorCss(arrowStroke)}`,
          }),
        ],
      ),
    )
  }
  return { kids, defs }
}

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
  ctx?: ElementCtx,
): Part {
  const attr: Attrs = {},
    style: string[] = [],
    kids: HtmlNode[] = [],
    defs: HtmlNode[] = []
  const scene = lowerSceneGeometry(g, p.marks, w.id)
  if (['rect', 'ellipse', 'line'].includes(g.type)) {
    if (!size)
      style.push(`--s-ar:${(('view' in g && g.view) || [1, 1]).join('/')}`)
  } else {
    const [vw, vh] = scene
      ? scene.view
      : g.type === 'path' || g.type === 'group'
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
  if (scene) {
    const rendered = renderScenePrimitives(
      w.id,
      scene.primitives,
      {
        fill: p.fill,
        stroke: p.stroke,
      },
      ctx?.fonts,
    )
    kids.push(...rendered.kids)
    defs.push(...rendered.defs)
    return { attr, style, kids, defs }
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
      kids.push(...groupKids(w, g, pt, how, ctx))
      break
  }
  return { attr, style, kids, defs }
}

const validGeometry = (p: Record<string, unknown>) =>
  (geometryBad(p.geometry) ? { type: 'ellipse' } : p.geometry) as ShapeGeometry

/**
 * One part of a group at its slot, a nested svg. `own` keeps its paint, `bare` takes the group's, `cut` is black for a mask.
 * Ids come from the part's own (unrolled) id, so a repeated row or a component copy keeps its own gradient.
 */
function part(c: Node, how: How, ctx?: ElementCtx): HtmlNode {
  const cp = (c.props ?? {}) as Record<string, unknown>
  const g = validGeometry(cp)
  const sl = c.slot as { x?: number; y?: number; w?: number; h?: number }
  const pt = paint(c.id, cp, g.type === 'line')
  const geo = geometry(c, cp, g, pt, [sl.w ?? 0, sl.h ?? 0], how, ctx)
  const own =
    how === 'own' ? pt.style : how === 'cut' ? 'fill:#000;stroke:none' : ''
  const partDefs =
    how === 'own' ? [...(pt.defItems ?? []), ...geo.defs] : geo.defs
  const svg = el(
    'svg',
    {
      x: sl.x,
      y: sl.y,
      width: sl.w,
      height: sl.h,
      class: c.hide ? ctx?.classOf.get(c.id) : undefined,
      'data-id': ctx?.mode === 'edit' ? c.id : undefined,
      id:
        ctx?.targets?.has(c.id) && SAFE_ID.test(c.id) ? domId(c.id) : undefined,
      ...(how === 'cut' ? {} : stateAttrs(c)),
      ...geo.attr,
      style: [...geo.style, own].filter(Boolean).join(';') || undefined,
    },
    [partDefs.length ? el('defs', {}, partDefs) : undefined, ...geo.kids],
  )
  ctx?.rendered?.set(c, svg)
  return svg
}

/** The parts of a group: each its own (layer), in one `g` with the group's fill (union), or the first under a mask the others cut (subtract). */
function groupKids(
  w: Node,
  g: Extract<ShapeGeometry, { type: 'group' }>,
  pt: Paint,
  how: How = 'own',
  ctx?: ElementCtx,
): HtmlNode[] {
  const kids = w.children ?? []
  const child = (c: Node, i: number) =>
    part(c, partPaint(g.combine, i, how), ctx)
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
  const scene = lowerSceneGeometry(g, p.marks, w.id)
  const pt = paint(
    w.id,
    scene ? { ...p, fill: p.fill ?? 'none' } : p,
    g.type === 'line',
  )
  const geo = geometry(w, p, g, pt, undefined, 'own', b.ctx)
  const label = typeof p.label === 'string' && p.label ? p.label : undefined
  const allDefs = [...(pt.defItems ?? []), ...geo.defs]
  return el(
    'svg',
    {
      ...attrs,
      ...geo.attr,
      role: label ? 'img' : undefined,
      'aria-label': label,
      'aria-hidden': label ? undefined : 'true',
      style:
        [
          ...geo.style,
          ...(scene &&
          !p.fill &&
          !p.stroke &&
          p.opacity === undefined &&
          !p.blur &&
          !p.grain &&
          !p.shadow
            ? []
            : [pt.style]),
        ]
          .filter(Boolean)
          .join(';') || undefined,
    },
    [allDefs.length ? el('defs', {}, allDefs) : undefined, ...geo.kids],
  )
}
