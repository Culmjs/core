export const MAX_MARKS = 256
import type {
  Color,
  FontRef,
  SceneMark,
  ShapeGeometry,
  ShapePaint,
  ShapeStroke,
} from './types.ts'

export type LoweredPrimitive =
  | {
      kind: 'rect'
      x: number
      y: number
      w: number
      h: number
      r?: number
      fill?: ShapePaint
      stroke?: ShapeStroke
      opacity?: number
      blur?: number
      transform?: string
    }
  | {
      kind: 'ellipse'
      cx: number
      cy: number
      rx: number
      ry: number
      fill?: ShapePaint
      stroke?: ShapeStroke
      opacity?: number
      blur?: number
      transform?: string
    }
  | {
      kind: 'line'
      x1: number
      y1: number
      x2: number
      y2: number
      stroke?: ShapeStroke
      opacity?: number
      blur?: number
      transform?: string
      markerEnd?: boolean
    }
  | {
      kind: 'path'
      d: string
      fill?: ShapePaint
      stroke?: ShapeStroke
      opacity?: number
      blur?: number
      transform?: string
      markerEnd?: boolean
      pathId?: string
    }
  | {
      kind: 'text'
      text: string
      x: number
      y: number
      anchor?: 'start' | 'middle' | 'end'
      size?: number
      weight?: number
      font?: FontRef
      fill?: ShapePaint
      opacity?: number
      blur?: number
      transform?: string
      textPath?: string
      startOffset?: string
      baseline?: string
    }

const r2 = (n: number) => Math.round(n * 100) / 100
const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n))
const SERIES_COLORS: readonly Color[] = ['brand', 'accent', 'ink', 'muted']

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Smooth Catmull-Rom spline through `points` lowered to cubic Bezier SVG path data. */
export function splinePath(
  points: readonly [number, number][],
  closed = false,
  tension = 0.5,
): string {
  if (points.length < 2) return ''
  const n = points.length
  const at = (i: number) =>
    closed
      ? points[((i % n) + n) % n]!
      : points[Math.max(0, Math.min(n - 1, i))]!
  const k = clamp(tension, 0, 1) / 3
  let d = `M${r2(points[0]![0])} ${r2(points[0]![1])}`
  const count = closed ? n : n - 1
  for (let i = 0; i < count; i++) {
    const p0 = at(i - 1)
    const p1 = at(i)
    const p2 = at(i + 1)
    const p3 = at(i + 2)
    const c1x = p1[0] + (p2[0] - p0[0]) * k
    const c1y = p1[1] + (p2[1] - p0[1]) * k
    const c2x = p2[0] - (p3[0] - p1[0]) * k
    const c2y = p2[1] - (p3[1] - p1[1]) * k
    d += `C${r2(c1x)} ${r2(c1y)},${r2(c2x)} ${r2(c2y)},${r2(p2[0])} ${r2(p2[1])}`
  }
  return closed ? `${d}Z` : d
}

/** Circular sector or ring-arc SVG path from `start` to `end` degrees (0 at top, clockwise). */
export function arcPath(
  cx: number,
  cy: number,
  r: number,
  startDeg: number,
  endDeg: number,
  inner = 0,
): string {
  const span = clamp(endDeg - startDeg, -360, 360)
  if (Math.abs(span) < 0.01) return ''
  const pt = (rad: number, deg: number): [number, number] => {
    const a = ((deg - 90) * Math.PI) / 180
    return [r2(cx + rad * Math.cos(a)), r2(cy + rad * Math.sin(a))]
  }
  if (Math.abs(span) >= 359.99) {
    const mid = startDeg + 180
    const [x1, y1] = pt(r, startDeg)
    const [x2, y2] = pt(r, mid)
    const outer = `M${x1} ${y1}A${r2(r)} ${r2(r)} 0 1 1 ${x2} ${y2}A${r2(r)} ${r2(r)} 0 1 1 ${x1} ${y1}Z`
    if (inner <= 0) return outer
    const [ix1, iy1] = pt(inner, startDeg)
    const [ix2, iy2] = pt(inner, mid)
    return `${outer}M${ix1} ${iy1}A${r2(inner)} ${r2(inner)} 0 1 0 ${ix2} ${iy2}A${r2(inner)} ${r2(inner)} 0 1 0 ${ix1} ${iy1}Z`
  }
  const cw = span > 0
  const large = Math.abs(span) > 180 ? 1 : 0
  const sweep = cw ? 1 : 0
  const [ox1, oy1] = pt(r, startDeg)
  const [ox2, oy2] = pt(r, endDeg)
  if (inner <= 0)
    return `M${r2(cx)} ${r2(cy)}L${ox1} ${oy1}A${r2(r)} ${r2(r)} 0 ${large} ${sweep} ${ox2} ${oy2}Z`
  const [ix1, iy1] = pt(inner, startDeg)
  const [ix2, iy2] = pt(inner, endDeg)
  return `M${ox1} ${oy1}A${r2(r)} ${r2(r)} 0 ${large} ${sweep} ${ox2} ${oy2}L${ix2} ${iy2}A${r2(inner)} ${r2(inner)} 0 ${large} ${cw ? 0 : 1} ${ix1} ${iy1}Z`
}

/** Smooth sampled sine wave path across [0..w] inside [w, h]. */
export function wavePath(
  w: number,
  h: number,
  opts: {
    y?: number
    amp: number
    freq: number
    phase?: number
    closeBottom?: boolean
  },
): string {
  const steps = Math.max(24, Math.min(96, Math.round(opts.freq * 24)))
  const baseY = opts.y ?? h / 2
  const phase = opts.phase ?? 0
  const pts: [number, number][] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    pts.push([
      r2(t * w),
      r2(baseY + opts.amp * Math.sin(t * Math.PI * 2 * opts.freq + phase)),
    ])
  }
  const d = splinePath(pts, false, 0.5)
  return opts.closeBottom ? `${d}L${r2(w)} ${r2(h)}L0 ${r2(h)}Z` : d
}

function markTransform(
  m: SceneMark,
  view: [number, number],
  stepIdx: number,
): { transform?: string; opacity?: number } {
  const rep = m.repeat
  const parts: string[] = []
  let opacity = m.opacity
  if (rep) {
    if (rep.step) {
      const [dx, dy] = rep.step
      if (dx !== 0 || dy !== 0)
        parts.push(`translate(${r2(dx * stepIdx)} ${r2(dy * stepIdx)})`)
    }
    if (rep.rotate !== undefined) {
      const [deg, cx, cy] = Array.isArray(rep.rotate)
        ? rep.rotate
        : [rep.rotate, view[0] / 2, view[1] / 2]
      const a = deg * stepIdx
      if (a !== 0)
        parts.push(
          `rotate(${r2(a)} ${r2(cx ?? view[0] / 2)} ${r2(cy ?? view[1] / 2)})`,
        )
    }
    if (rep.scale !== undefined && rep.scale !== 1) {
      const s = Math.pow(rep.scale, stepIdx)
      const [cx, cy] = [view[0] / 2, view[1] / 2]
      parts.push(
        `translate(${r2(cx)} ${r2(cy)}) scale(${r2(s)}) translate(${r2(-cx)} ${r2(-cy)})`,
      )
    }
    if (rep.opacity) {
      const [from, to] = rep.opacity
      const t = rep.count > 1 ? stepIdx / (rep.count - 1) : 0
      opacity = r2(from + (to - from) * t)
    }
  }
  if (m.rotate !== undefined) {
    const [deg, cx, cy] = Array.isArray(m.rotate)
      ? m.rotate
      : [m.rotate, view[0] / 2, view[1] / 2]
    if (deg !== 0) parts.push(`rotate(${r2(deg)} ${r2(cx)} ${r2(cy)})`)
  }
  return {
    transform: parts.length ? parts.join(' ') : undefined,
    opacity,
  }
}

function lowerOneMark(
  m: SceneMark,
  view: [number, number],
  stepIdx: number,
  out: LoweredPrimitive[],
): void {
  const { transform, opacity } = markTransform(m, view, stepIdx)
  const common = {
    ...(m.fill !== undefined ? { fill: m.fill } : {}),
    ...(m.stroke !== undefined ? { stroke: m.stroke } : {}),
    ...(opacity !== undefined ? { opacity } : {}),
    ...(m.blur !== undefined ? { blur: m.blur } : {}),
    ...(transform ? { transform } : {}),
  }
  if (m.rect) {
    const [x, y, w, h, r] = m.rect
    out.push({ kind: 'rect', x, y, w, h, ...(r ? { r } : {}), ...common })
  } else if (m.circle) {
    const [cx, cy, r] = m.circle
    out.push({ kind: 'ellipse', cx, cy, rx: r, ry: r, ...common })
  } else if (m.ellipse) {
    const [cx, cy, rx, ry] = m.ellipse
    out.push({ kind: 'ellipse', cx, cy, rx, ry, ...common })
  } else if (m.line) {
    const [x1, y1, x2, y2] = m.line
    out.push({
      kind: 'line',
      x1,
      y1,
      x2,
      y2,
      stroke: m.stroke ?? { color: 'ink', width: 1.5 },
      ...(opacity !== undefined ? { opacity } : {}),
      ...(m.blur !== undefined ? { blur: m.blur } : {}),
      ...(transform ? { transform } : {}),
    })
  } else if (m.curve) {
    out.push({
      kind: 'path',
      d: splinePath(m.curve.points, m.curve.closed, m.curve.tension),
      fill: m.fill ?? 'none',
      ...(m.stroke ? { stroke: m.stroke } : {}),
      ...(opacity !== undefined ? { opacity } : {}),
      ...(m.blur !== undefined ? { blur: m.blur } : {}),
      ...(transform ? { transform } : {}),
    })
  } else if (m.arc) {
    out.push({
      kind: 'path',
      d: arcPath(
        m.arc.cx,
        m.arc.cy,
        m.arc.r,
        m.arc.start,
        m.arc.end,
        m.arc.inner,
      ),
      ...common,
    })
  } else if (m.wave) {
    out.push({
      kind: 'path',
      d: wavePath(view[0], view[1], m.wave),
      fill: m.fill ?? (m.wave.closeBottom ? 'brand' : 'none'),
      ...(m.stroke ? { stroke: m.stroke } : {}),
      ...(opacity !== undefined ? { opacity } : {}),
      ...(m.blur !== undefined ? { blur: m.blur } : {}),
      ...(transform ? { transform } : {}),
    })
  } else if (m.grid) {
    const [vw, vh] = view
    const stroke = m.stroke ?? { color: 'line', width: 1 }
    const segs: string[] = []
    for (let i = 1; i < m.grid.cols; i++)
      segs.push(`M${r2((vw * i) / m.grid.cols)} 0V${vh}`)
    for (let j = 1; j < m.grid.rows; j++)
      segs.push(`M0 ${r2((vh * j) / m.grid.rows)}H${vw}`)
    out.push({
      kind: 'path',
      d: segs.join(''),
      fill: 'none',
      stroke,
      ...(opacity !== undefined ? { opacity } : {}),
      ...(transform ? { transform } : {}),
    })
  } else if (m.path) {
    out.push({ kind: 'path', d: m.path, ...common })
  } else if (m.label !== undefined) {
    const [x, y] = m.at ?? [view[0] / 2, view[1] / 2]
    out.push({
      kind: 'text',
      text: m.label,
      x,
      y,
      anchor: m.anchor,
      size: m.size ?? 12,
      weight: m.weight,
      font: m.font,
      fill: m.fill ?? 'ink',
      ...(opacity !== undefined ? { opacity } : {}),
      ...(m.blur !== undefined ? { blur: m.blur } : {}),
      ...(transform ? { transform } : {}),
    })
  }
}

/** Expand compact `marks` (including bounded `repeat`) up to `SHAPE_LIMITS.marks`. */
export function expandMarks(
  marks: readonly SceneMark[],
  view: [number, number],
): { primitives: LoweredPrimitive[]; count: number; over: boolean } {
  const out: LoweredPrimitive[] = []
  let total = 0
  let over = false
  for (const m of marks) {
    const reps = m.repeat ? clamp(Math.floor(m.repeat.count), 1, 64) : 1
    for (let i = 0; i < reps; i++) {
      total++
      if (total > MAX_MARKS) {
        over = true
        break
      }
      lowerOneMark(m, view, i, out)
    }
    if (over) break
  }
  return { primitives: out, count: total, over }
}

function lowerChart(g: Extract<ShapeGeometry, { type: 'chart' }>): {
  view: [number, number]
  primitives: LoweredPrimitive[]
} {
  const view: [number, number] = g.view ?? [480, 260]
  const [vw, vh] = view
  const primitives: LoweredPrimitive[] = []
  const pad =
    g.chart === 'spark'
      ? { l: 8, r: 8, t: 10, b: 10 }
      : { l: 46, r: 20, t: g.legend ? 34 : 20, b: g.labels?.length ? 36 : 20 }

  if (g.chart === 'donut') {
    const vals = g.series[0]?.values ?? []
    const total = vals.reduce((a, b) => a + Math.max(0, b), 0) || 1
    const cx = vw * 0.42
    const cy = vh * 0.5
    const r = Math.min(vw * 0.34, vh * 0.42)
    const inner = r * 0.56
    let angle = 0
    vals.forEach((v, i) => {
      const span = (Math.max(0, v) / total) * 360
      const color = SERIES_COLORS[i % SERIES_COLORS.length]!
      if (span > 0.1)
        primitives.push({
          kind: 'path',
          d: arcPath(cx, cy, r, angle, angle + span - 1.5, inner),
          fill: color,
        })
      if (g.labels?.[i]) {
        const ly = cy - ((vals.length - 1) * 20) / 2 + i * 22
        const lx = cx + r + 26
        primitives.push(
          { kind: 'rect', x: lx, y: ly - 9, w: 10, h: 10, r: 3, fill: color },
          {
            kind: 'text',
            text: `${g.labels[i]} (${r2((v / total) * 100)}%)`,
            x: lx + 16,
            y: ly,
            size: 12,
            fill: 'ink',
          },
        )
      }
      angle += span
    })
    return { view, primitives }
  }

  const allVals = g.series.flatMap(s => s.values)
  const rawMax = Math.max(0, ...allVals)
  const rawMin = Math.min(0, ...allVals)
  const span = rawMax - rawMin || 1
  const pw = Math.max(20, vw - pad.l - pad.r)
  const ph = Math.max(20, vh - pad.t - pad.b)
  const yOf = (val: number) => pad.t + ph - ((val - rawMin) / span) * ph

  if (g.grid !== false && g.chart !== 'spark') {
    for (let i = 0; i <= 4; i++) {
      const v = rawMin + (span * i) / 4
      const y = r2(yOf(v))
      primitives.push({
        kind: 'line',
        x1: pad.l,
        y1: y,
        x2: vw - pad.r,
        y2: y,
        stroke: { color: 'line', width: 1 },
      })
      primitives.push({
        kind: 'text',
        text: String(Math.round(v * 10) / 10),
        x: pad.l - 8,
        y: y + 4,
        anchor: 'end',
        size: 11,
        font: 'sys:mono',
        fill: 'muted',
      })
    }
  }

  const count = Math.max(1, ...g.series.map(s => s.values.length))
  if (g.chart === 'bar') {
    const slotW = pw / count
    const sCount = Math.max(1, g.series.length)
    const barW = Math.max(4, Math.min(36, (slotW * 0.72) / sCount))
    const baseZero = yOf(0)
    g.series.forEach((s, si) => {
      const fill = s.color ?? SERIES_COLORS[si % SERIES_COLORS.length]!
      s.values.forEach((v, idx) => {
        const yv = yOf(v)
        const h = Math.max(1, Math.abs(baseZero - yv))
        const x = pad.l + idx * slotW + (slotW - barW * sCount) / 2 + si * barW
        primitives.push({
          kind: 'rect',
          x: r2(x),
          y: r2(Math.min(yv, baseZero)),
          w: r2(Math.max(2, barW - 2)),
          h: r2(h),
          r: 4,
          fill,
        })
      })
    })
  } else {
    g.series.forEach((s, si) => {
      const color = s.color ?? SERIES_COLORS[si % SERIES_COLORS.length]!
      const pts: [number, number][] = s.values.map((v, idx) => [
        r2(count === 1 ? pad.l + pw / 2 : pad.l + (idx * pw) / (count - 1)),
        r2(yOf(v)),
      ])
      const lineD = splinePath(pts, false, 0.35)
      if (g.chart === 'area' && pts.length) {
        const baseY = r2(yOf(rawMin))
        primitives.push({
          kind: 'path',
          d: `${lineD}L${pts[pts.length - 1]![0]} ${baseY}L${pts[0]![0]} ${baseY}Z`,
          fill: color,
          opacity: 0.18,
        })
      }
      primitives.push({
        kind: 'path',
        d: lineD,
        fill: 'none',
        stroke: { color, width: g.chart === 'spark' ? 2.5 : 2.5 },
      })
      if (g.chart !== 'spark') {
        for (const [px, py] of pts)
          primitives.push({
            kind: 'ellipse',
            cx: px,
            cy: py,
            rx: 3.5,
            ry: 3.5,
            fill: 'bg',
            stroke: { color, width: 2 },
          })
      }
    })
  }

  if (g.labels?.length && g.chart !== 'spark') {
    const slotW = pw / count
    g.labels.slice(0, count).forEach((lbl, idx) => {
      const x =
        g.chart === 'bar'
          ? pad.l + (idx + 0.5) * slotW
          : count === 1
            ? pad.l + pw / 2
            : pad.l + (idx * pw) / (count - 1)
      primitives.push({
        kind: 'text',
        text: lbl,
        x: r2(x),
        y: vh - 12,
        anchor: 'middle',
        size: 11,
        fill: 'muted',
      })
    })
  }
  if (g.legend && g.series.some(s => s.name)) {
    let lx = pad.l
    g.series.forEach((s, si) => {
      if (!s.name) return
      const color = s.color ?? SERIES_COLORS[si % SERIES_COLORS.length]!
      primitives.push(
        { kind: 'rect', x: lx, y: 10, w: 10, h: 10, r: 3, fill: color },
        {
          kind: 'text',
          text: s.name,
          x: lx + 15,
          y: 19,
          size: 11,
          weight: 600,
          fill: 'ink',
        },
      )
      lx += 28 + s.name.length * 7
    })
  }
  return { view, primitives }
}

function lowerDiagram(g: Extract<ShapeGeometry, { type: 'diagram' }>): {
  view: [number, number]
  primitives: LoweredPrimitive[]
} {
  const dir = g.dir ?? 'LR'
  const nodes = g.nodes
  const idxOf = new Map(nodes.map((n, i) => [n.id, i]))
  // Compute deterministic topological layers when explicit col/row are omitted.
  const depth = new Array<number>(nodes.length).fill(0)
  for (let pass = 0; pass < nodes.length; pass++) {
    for (const [from, to] of g.edges) {
      const a = idxOf.get(from)
      const b = idxOf.get(to)
      if (a !== undefined && b !== undefined && a !== b)
        depth[b] = Math.max(depth[b]!, depth[a]! + 1)
    }
  }
  const slotCount = new Map<number, number>()
  const coords = nodes.map((n, i) => {
    const primary =
      n.col !== undefined && dir === 'LR'
        ? n.col
        : n.row !== undefined && dir === 'TB'
          ? n.row
          : depth[i]!
    const seen = slotCount.get(primary) ?? 0
    slotCount.set(primary, seen + 1)
    const secondary = dir === 'LR' ? (n.row ?? seen) : (n.col ?? seen)
    return dir === 'LR'
      ? { col: primary, row: secondary }
      : { col: secondary, row: primary }
  })
  const maxCol = Math.max(0, ...coords.map(c => c.col))
  const maxRow = Math.max(0, ...coords.map(c => c.row))
  const boxW = 148
  const boxH = 58
  const gapX = 56
  const gapY = 38
  const pad = 28
  const autoW = pad * 2 + (maxCol + 1) * boxW + maxCol * gapX
  const autoH = pad * 2 + (maxRow + 1) * boxH + maxRow * gapY
  const view: [number, number] = g.view ?? [autoW, autoH]
  const sx = view[0] / autoW
  const sy = view[1] / autoH
  const rectOf = new Map<
    string,
    { x: number; y: number; w: number; h: number }
  >()
  const primitives: LoweredPrimitive[] = []

  // Compute node boxes first so edges route cleanly between borders.
  nodes.forEach((n, i) => {
    const c = coords[i]!
    rectOf.set(n.id, {
      x: r2((pad + c.col * (boxW + gapX)) * sx),
      y: r2((pad + c.row * (boxH + gapY)) * sy),
      w: r2(boxW * sx),
      h: r2(boxH * sy),
    })
  })

  for (const [from, to, lbl] of g.edges) {
    const a = rectOf.get(from)
    const b = rectOf.get(to)
    if (!a || !b) continue
    const x1 = dir === 'LR' ? a.x + a.w : a.x + a.w / 2
    const y1 = dir === 'LR' ? a.y + a.h / 2 : a.y + a.h
    const x2 = dir === 'LR' ? b.x : b.x + b.w / 2
    const y2 = dir === 'LR' ? b.y + b.h / 2 : b.y
    const mx = (x1 + x2) / 2
    const my = (y1 + y2) / 2
    const d =
      dir === 'LR'
        ? `M${r2(x1)} ${r2(y1)}C${r2(mx)} ${r2(y1)},${r2(mx)} ${r2(y2)},${r2(x2)} ${r2(y2)}`
        : `M${r2(x1)} ${r2(y1)}C${r2(x1)} ${r2(my)},${r2(x2)} ${r2(my)},${r2(x2)} ${r2(y2)}`
    primitives.push({
      kind: 'path',
      d,
      fill: 'none',
      stroke: { color: 'muted', width: 2 },
      markerEnd: true,
    })
    if (lbl) {
      primitives.push({
        kind: 'text',
        text: lbl,
        x: r2(mx),
        y: r2(my - 6),
        anchor: 'middle',
        size: 11,
        font: 'sys:mono',
        fill: 'muted',
      })
    }
  }

  for (const n of nodes) {
    const r = rectOf.get(n.id)!
    const fill = n.fill ?? 'bg'
    const textFill: Color =
      fill === 'ink' || fill === 'deep'
        ? 'bg'
        : fill === 'brand' || fill === 'accent'
          ? 'bg'
          : 'ink'
    const subFill: Color = textFill === 'bg' ? 'bg' : 'muted'
    primitives.push({
      kind: 'rect',
      x: r.x,
      y: r.y,
      w: r.w,
      h: r.h,
      r: 10,
      fill,
      stroke: { color: fill === 'bg' ? 'line' : fill, width: 1.5 },
    })
    primitives.push({
      kind: 'text',
      text: n.label,
      x: r2(r.x + r.w / 2),
      y: r2(r.y + (n.sub ? r.h * 0.44 : r.h * 0.54)),
      anchor: 'middle',
      size: 13,
      weight: 700,
      fill: textFill,
    })
    if (n.sub)
      primitives.push({
        kind: 'text',
        text: n.sub,
        x: r2(r.x + r.w / 2),
        y: r2(r.y + r.h * 0.72),
        anchor: 'middle',
        size: 11,
        font: 'sys:mono',
        fill: subFill,
      })
  }
  return { view, primitives }
}

function lowerContours(g: Extract<ShapeGeometry, { type: 'contours' }>): {
  view: [number, number]
  primitives: LoweredPrimitive[]
} {
  const view: [number, number] = g.view ?? [400, 260]
  const [vw, vh] = view
  const rnd = mulberry32(g.seed)
  const gx = 24
  const gy = 16
  const scale = clamp(g.scale ?? 1, 0.25, 4)
  // Smooth seeded trigonometric + noise field for organic topographic isolines.
  const modes = Array.from({ length: 5 }, () => ({
    fx: (0.8 + rnd() * 1.8) * scale,
    fy: (0.8 + rnd() * 1.8) * scale,
    px: rnd() * Math.PI * 2,
    py: rnd() * Math.PI * 2,
    w: 0.4 + rnd() * 0.6,
  }))
  const field: number[][] = Array.from({ length: gy + 1 }, (_, y) =>
    Array.from({ length: gx + 1 }, (_, x) => {
      const nx = x / gx
      const ny = y / gy
      let sum = 0
      for (const m of modes)
        sum +=
          m.w *
          Math.sin(nx * Math.PI * m.fx + m.px) *
          Math.cos(ny * Math.PI * m.fy + m.py)
      return sum
    }),
  )
  const flat = field.flat()
  const lo = Math.min(...flat)
  const hi = Math.max(...flat)
  const bands = clamp(Math.round(g.bands ?? 10), 2, 24)
  const cw = vw / gx
  const ch = vh / gy
  const primitives: LoweredPrimitive[] = []
  const interp = (a: number, b: number, level: number) =>
    Math.abs(b - a) < 1e-6 ? 0.5 : clamp((level - a) / (b - a), 0, 1)

  for (let b = 1; b < bands; b++) {
    const level = lo + ((hi - lo) * b) / bands
    let d = ''
    for (let y = 0; y < gy; y++) {
      for (let x = 0; x < gx; x++) {
        const v0 = field[y]![x]!
        const v1 = field[y]![x + 1]!
        const v2 = field[y + 1]![x + 1]!
        const v3 = field[y + 1]![x]!
        const mask =
          (v0 >= level ? 8 : 0) |
          (v1 >= level ? 4 : 0) |
          (v2 >= level ? 2 : 0) |
          (v3 >= level ? 1 : 0)
        if (mask === 0 || mask === 15) continue
        const top: [number, number] = [(x + interp(v0, v1, level)) * cw, y * ch]
        const right: [number, number] = [
          (x + 1) * cw,
          (y + interp(v1, v2, level)) * ch,
        ]
        const bot: [number, number] = [
          (x + interp(v3, v2, level)) * cw,
          (y + 1) * ch,
        ]
        const left: [number, number] = [
          x * cw,
          (y + interp(v0, v3, level)) * ch,
        ]
        const seg = (p: [number, number], q: [number, number]) => {
          d += `M${r2(p[0])} ${r2(p[1])}L${r2(q[0])} ${r2(q[1])}`
        }
        switch (mask) {
          case 1:
          case 14:
            seg(left, bot)
            break
          case 2:
          case 13:
            seg(bot, right)
            break
          case 3:
          case 12:
            seg(left, right)
            break
          case 4:
          case 11:
            seg(top, right)
            break
          case 5:
            seg(top, left)
            seg(bot, right)
            break
          case 6:
          case 9:
            seg(top, bot)
            break
          case 7:
          case 8:
            seg(top, left)
            break
          case 10:
            seg(top, right)
            seg(left, bot)
            break
        }
      }
    }
    if (d)
      primitives.push({
        kind: 'path',
        d,
        fill: 'none',
        stroke: {
          color: b % 3 === 0 ? 'brand' : 'ink',
          width: b % 3 === 0 ? 1.8 : 1,
        },
        opacity: r2(0.28 + 0.55 * (b / bands)),
      })
  }
  return { view, primitives }
}

function lowerStamp(
  g: Extract<ShapeGeometry, { type: 'stamp' }>,
  shapeId: string,
): { view: [number, number]; primitives: LoweredPrimitive[] } {
  const view: [number, number] = g.view ?? [160, 160]
  const [vw, vh] = view
  const cx = vw / 2
  const cy = vh / 2
  const rOuter = Math.min(vw, vh) * 0.45
  const rText = rOuter * 0.74
  const rInner = rOuter * 0.54
  const rot = g.rotate ?? 0
  const primitives: LoweredPrimitive[] = []
  if (g.teeth && g.teeth >= 8) {
    const n = g.teeth * 2
    const pts: string[] = []
    for (let i = 0; i < n; i++) {
      const a = (((360 * i) / n + rot) * Math.PI) / 180
      const r = i % 2 === 0 ? rOuter : rOuter * 0.9
      pts.push(`${r2(cx + r * Math.cos(a))},${r2(cy + r * Math.sin(a))}`)
    }
    primitives.push({
      kind: 'path',
      d: `M${pts.join('L')}Z`,
      fill: 'none',
      stroke: { color: 'brand', width: 2 },
    })
  } else {
    primitives.push({
      kind: 'ellipse',
      cx,
      cy,
      rx: rOuter,
      ry: rOuter,
      fill: 'none',
      stroke: { color: 'brand', width: 2.2 },
    })
  }
  if ((g.rings ?? 2) === 2)
    primitives.push({
      kind: 'ellipse',
      cx,
      cy,
      rx: rInner,
      ry: rInner,
      fill: 'none',
      stroke: { color: 'brand', width: 1.5 },
    })
  const trackId = `${shapeId.replace(/[^a-z0-9_-]/gi, '_')}-tp`
  primitives.push({
    kind: 'path',
    pathId: trackId,
    d: `M${r2(cx - rText)},${r2(cy)} A${r2(rText)},${r2(rText)} 0 1,1 ${r2(cx + rText)},${r2(cy)} A${r2(rText)},${r2(rText)} 0 1,1 ${r2(cx - rText)},${r2(cy)}`,
    fill: 'none',
  })
  primitives.push({
    kind: 'text',
    text: g.text,
    x: cx,
    y: cy,
    textPath: trackId,
    startOffset: '50%',
    anchor: 'middle',
    size: clamp(Math.round(rOuter * 0.19), 9, 22),
    weight: 700,
    font: 'sys:mono',
    fill: 'brand',
  })
  if (g.center)
    primitives.push({
      kind: 'text',
      text: g.center,
      x: cx,
      y: r2(cy + rOuter * 0.08),
      anchor: 'middle',
      size: clamp(Math.round(rOuter * 0.28), 11, 32),
      weight: 800,
      fill: 'ink',
    })
  return { view, primitives }
}

/** Lowers extended procedural/scene geometries into normalized SVG primitives. Returns null for legacy core geometries. */
export function lowerSceneGeometry(
  g: ShapeGeometry,
  marksProp?: unknown,
  shapeId = 's',
): { view: [number, number]; primitives: LoweredPrimitive[] } | null {
  switch (g.type) {
    case 'scene': {
      const view = g.view ?? [400, 240]
      const list = Array.isArray(marksProp) ? (marksProp as SceneMark[]) : []
      return { view, primitives: expandMarks(list, view).primitives }
    }
    case 'curve': {
      const view = g.view ?? [100, 100]
      return {
        view,
        primitives: [
          {
            kind: 'path',
            d: splinePath(g.points, g.closed, g.tension),
            fill: g.closed ? undefined : 'none',
          },
        ],
      }
    }
    case 'arc': {
      const view = g.view ?? [100, 100]
      return {
        view,
        primitives: [
          {
            kind: 'path',
            d: arcPath(
              g.cx ?? view[0] / 2,
              g.cy ?? view[1] / 2,
              g.r ?? Math.min(view[0], view[1]) * 0.45,
              g.start,
              g.end,
              g.inner ?? 0,
            ),
          },
        ],
      }
    }
    case 'wave': {
      const view = g.view ?? [400, 120]
      return {
        view,
        primitives: [{ kind: 'path', d: wavePath(view[0], view[1], g) }],
      }
    }
    case 'chart':
      return lowerChart(g)
    case 'diagram':
      return lowerDiagram(g)
    case 'contours':
      return lowerContours(g)
    case 'stamp':
      return lowerStamp(g, shapeId)
    default:
      return null
  }
}
