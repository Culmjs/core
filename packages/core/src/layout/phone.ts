import { walk } from '../document/index.ts'
import { groupOrder, runs } from '../document/tree.ts'
import type { Box, FreeSlot, Layout, Node } from '../document/index.ts'
import { shownAtLayout } from '../document/visibility.ts'
import { flagOf, floating, resolveFreeCollisions } from './placement.ts'

const MIN_COL = 8
const rows = (h: number) => Math.max(1, Math.ceil(h / 2))
const s = (w: Node) => w.slot as FreeSlot
const skipped = (w: Node) => !!w.hide?.phone
const bottom = (bs: Iterable<Box>) =>
  Math.max(0, ...[...bs].map(b => b.y + b.h))

/** True when a Free area stores its own phone boxes. */
export const ownPhone = (free: Node): boolean =>
  !!free.children?.some(w => s(w).phone)

/** True when a Free area stores its own tablet boxes. */
export const ownTablet = (free: Node): boolean =>
  !!free.children?.some(w => s(w).tablet)

/** The child as the tablet sees it: its own tablet box, else its desktop box. Phone boxes ride along. */
const atTablet = (w: Node): Node =>
  s(w).tablet
    ? {
        ...w,
        slot: { ...s(w).tablet!, ...(s(w).phone ? { phone: s(w).phone } : {}) },
      }
    : w

type Placed = { boxes: Map<string, Box>; h: number }

/** Phone rows for widgets that keep their relative places: half the desktop rows, but one below another stays below it. */
function halvedTops(ps: Node[]): Map<string, number> {
  const y0 = Math.min(...ps.map(p => s(p).y))
  const tops = new Map<string, number>()
  for (const p of [...ps].sort((a, b) => s(a).y - s(b).y)) {
    const above = ps.filter(q => tops.has(q.id) && s(q).y + s(q).h <= s(p).y)
    tops.set(
      p.id,
      Math.max(
        Math.floor((s(p).y - y0) / 2),
        ...above.map(q => tops.get(q.id)! + rows(s(q).h)),
      ),
    )
  }
  return tops
}

/** Column widths in proportion to desktop widths, none under MIN_COL, adding up to `width`. */
function columnWidths(extents: number[], width: number): number[] {
  const total = extents.reduce((a, b) => a + b, 0)
  const ws = extents.map(e =>
    Math.max(MIN_COL, Math.round((width * e) / total)),
  )
  for (let sum = ws.reduce((a, b) => a + b, 0); sum !== width;) {
    const step = sum > width ? -1 : 1
    const i = ws.indexOf(Math.max(...ws.filter(c => step > 0 || c > MIN_COL)))
    ws[i] += step
    sum += step
  }
  return ws
}

/** Works out boxes (relative to their group) on a grid of `width` columns. */
function place(ps: Node[], width: number): Placed {
  const boxes = new Map<string, Box>()
  if (ps.length === 1) {
    boxes.set(ps[0].id, {
      x: 0,
      y: 0,
      w: width,
      h: rows(s(ps[0]).h),
      z: s(ps[0]).z,
    })
    return { boxes, h: rows(s(ps[0]).h) }
  }
  const bands = runs(ps, 'y', 'h')
  if (bands.length > 1) {
    let y = 0
    for (const band of bands) {
      const r = place(band, width)
      for (const [id, b] of r.boxes) boxes.set(id, { ...b, y: b.y + y })
      y += r.h
    }
    return { boxes, h: y }
  }
  const cols = runs(ps, 'x', 'w')
  if (cols.length > 1) {
    const stacked = cols.length * MIN_COL > width
    const extents = cols.map(
      c =>
        Math.max(...c.map(p => s(p).x + s(p).w)) -
        Math.min(...c.map(p => s(p).x)),
    )
    const widths = stacked
      ? cols.map(() => width)
      : columnWidths(extents, width)
    let x = 0
    let y = 0
    let h = 0
    cols.forEach((c, i) => {
      const r = place(c, widths[i])
      for (const [id, b] of r.boxes)
        boxes.set(id, { ...b, x: b.x + (stacked ? 0 : x), y: b.y + y })
      if (stacked) y += r.h
      else x += widths[i]
      h = stacked ? y : Math.max(h, r.h)
    })
    return { boxes, h }
  }
  // Overlapping boxes that nothing splits keep their relative positions, scaled to fit.
  const x0 = Math.min(...ps.map(p => s(p).x))
  const tops = halvedTops(ps)
  const span = Math.max(...ps.map(p => s(p).x + s(p).w)) - x0
  let h = 0
  for (const p of ps) {
    const x = Math.min(width - 1, Math.round(((s(p).x - x0) * width) / span))
    const bw = Math.max(
      1,
      Math.min(width - x, Math.round((s(p).w * width) / span)),
    )
    const y = tops.get(p.id)!
    boxes.set(p.id, { x, y, w: bw, h: rows(s(p).h), z: s(p).z })
    h = Math.max(h, y + rows(s(p).h))
  }
  return { boxes, h }
}

const overlap = (a: Node, b: Node) => {
  const p = s(a),
    q = s(b)
  return (
    p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h
  )
}

/** Phone boxes for a nested Free area's children: they keep their relative places, scaled to `cols`. */
export function derivePieces(children: Node[], cols: number): Map<string, Box> {
  const ps = children.filter(w => !skipped(w))
  return ps.length ? place(ps, cols).boxes : new Map()
}

/** Where every child of one container lands when the phone follows the desktop. */
export function deriveLayout(children: Node[], cols: number): Map<string, Box> {
  const out = new Map<string, Box>()
  // Desktop's reading order (row, then column: the XY cut the page's own order uses), so a left column reads before the one beside it.
  const list = groupOrder(children.filter(w => !skipped(w)))
  const root = list.map((_, i) => i)
  const find = (i: number): number =>
    root[i] === i ? i : (root[i] = find(root[i]))
  list.forEach((a, i) =>
    list.forEach((b, j) => i < j && overlap(a, b) && (root[find(j)] = find(i))),
  )
  // list is in reading order, so clusters come out ordered by their first member
  const clusters = new Map<number, Node[]>()
  list.forEach((w, i) =>
    clusters.set(find(i), [...(clusters.get(find(i)) ?? []), w]),
  )
  let cursor = 0
  for (const members of clusters.values()) {
    const lone = members.length === 1
    const tops = halvedTops(members)
    let height = 0
    for (const m of members) {
      const width = lone ? cols : s(m).w
      const h = rows(s(m).h)
      const y = cursor + (lone ? 0 : tops.get(m.id)!)
      out.set(m.id, { x: lone ? 0 : s(m).x, y, w: width, h, z: s(m).z })
      height = Math.max(height, y - cursor + h)
    }
    cursor += height + 1
  }
  return out
}

/** The phone positions in force for one Free area: the stored ones, or derived ones when none are stored. */
function rawPhoneBoxes(free: Node): Map<string, Box> {
  const children = free.children ?? []
  const cols = typeof free.props?.cols === 'number' ? free.props.cols : 24
  if (!ownPhone(free))
    return 'w' in free.slot
      ? derivePieces(children, cols)
      : deriveLayout(children, cols)
  const shown = children.filter(w => !w.hide?.phone)
  const p = (w: Node) => s(w).phone!
  // The phone's own order is its stored boxes'. A block it has no box for (added on desktop since) was never placed on phone,
  // so it goes in after the block before it in desktop reading order, past any block stored beside that one.
  const seq = shown
    .filter(w => s(w).phone)
    .sort((a, b) => p(a).y - p(b).y || p(a).x - p(b).x)
  // A phone-only block's desktop box means nothing on desktop, so it has no place in desktop reading order; one without a box goes last.
  const reading = groupOrder(shown.filter(w => !w.hide?.desktop))
  reading.forEach((w, i) => {
    if (s(w).phone) return
    const prev = reading[i - 1]
    let at = prev ? seq.indexOf(prev) + 1 : 0
    if (prev && s(prev).phone)
      while (
        at < seq.length &&
        s(seq[at]).phone &&
        p(seq[at]).y < p(prev).y + p(prev).h
      )
        at++
    seq.splice(at, 0, w)
  })
  seq.push(...shown.filter(w => !seq.includes(w)))
  // Stored boxes keep their places relative to each other; each inserted block pushes the ones after it down.
  const out = new Map<string, Box>()
  let shift = 0,
    floor = 0
  for (const w of seq) {
    if (s(w).phone) {
      const y = Math.max(p(w).y + shift, floor)
      shift = y - p(w).y
      out.set(w.id, { ...p(w), y })
    } else {
      const y = out.size ? bottom(out.values()) + 1 : 0,
        h = rows(s(w).h)
      out.set(w.id, { x: 0, y, w: cols, h, z: s(w).z })
      floor = y + h + 1
    }
  }
  return out
}

/** Shared effective geometry: callers must use these boxes instead of raw slots. */
export function effectiveFreeBoxes(
  free: Node,
  l: Layout = 'desktop',
): Map<string, Box> {
  const flag = flagOf(l)
  const children = (free.children ?? [])
    .filter(w => shownAtLayout(w, l))
    .map(w => (l === 'desktop' ? w : atTablet(w)))
  let boxes: Map<string, Box>
  if (l === 'phone') {
    boxes = rawPhoneBoxes({
      ...free,
      children: children.filter(w => !floating(w, true)),
    })
    for (const w of children.filter(w => floating(w, true))) {
      const b = s(w)
      boxes.set(
        w.id,
        b.phone ?? {
          x: b.x,
          y: Math.floor(b.y / 2),
          w: b.w,
          h: rows(b.h),
          z: b.z,
        },
      )
    }
  } else
    boxes = new Map(
      children.map(w => {
        const { x, y, w: width, h, z } = s(w)
        return [w.id, { x, y, w: width, h, z }]
      }),
    )
  // Automatic phone layouts historically extend beyond persisted coordinates; edits still enforce 999.
  return resolveFreeCollisions(
    children,
    boxes,
    flag,
    l === 'phone' ? Infinity : 999,
  )
}

export const phoneBoxes = (free: Node): Map<string, Box> =>
  effectiveFreeBoxes(free, 'phone')

/** True when any Free area in the tree stores its own phone boxes. */
export function anyOwnPhone(root: Node): boolean {
  let any = false
  walk(root, w => {
    if (w.kind === 'free' && ownPhone(w)) any = true
  })
  return any
}
