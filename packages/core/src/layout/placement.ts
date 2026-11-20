import type { Box, Layout, Node, PlacementValue } from '../document/index.ts'

export const PLACEMENT_MODES = [
  'normal',
  'front',
  'behind',
  'wrap-start',
  'wrap-end',
] as const
/** `true` is the phone layout, `"tablet"` the tablet one. Each layout starts as the one above it: desktop, tablet, phone. */
export type LayoutFlag = boolean | 'tablet'
/** The flag the placement helpers take for a layout. */
export const flagOf = (layout: Layout): LayoutFlag =>
  layout === 'phone' ? true : layout === 'tablet' ? 'tablet' : false
/**
 * Whether a block is drawn on a layout: hiding on desktop reaches tablet too, and phone shows it again.
 * Not the same rule as `shownOn` in `document/samples.ts` (the sample check), where a desktop hide does not reach tablet.
 * The two differ on purpose for now: changing either changes published output, so they are to be settled together.
 */
export const shownOn = (w: Node, layout: Layout): boolean =>
  !w.hide?.[layout] && !(layout === 'tablet' && w.hide?.desktop)
export function effectivePlacement(
  w: Node,
  layout: LayoutFlag = false,
): PlacementValue {
  const p = w.placement
  return {
    mode: p?.mode ?? (w.origin?.block === 'pattern' ? 'behind' : 'normal'),
    ...(p?.x !== undefined ? { x: p.x } : {}),
    ...(p?.y !== undefined ? { y: p.y } : {}),
    ...(layout ? p?.tablet : {}),
    ...(layout === true ? p?.phone : {}),
  }
}
export const floating = (w: Node, phone: LayoutFlag = false) =>
  ['front', 'behind'].includes(effectivePlacement(w, phone).mode)
export const wrapping = (w: Node, phone: LayoutFlag = false) =>
  ['wrap-start', 'wrap-end'].includes(effectivePlacement(w, phone).mode)
const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/** Resolve downwards only where horizontal spans collide; preserve columns and explicit overlays. */
export function resolveFreeCollisions(
  children: Node[],
  boxes: ReadonlyMap<string, Box>,
  phone: LayoutFlag = false,
  maxY = 999,
): Map<string, Box> {
  const out = new Map<string, Box>(),
    occupied: Box[] = []
  for (const w of children) {
    const box = boxes.get(w.id)
    if (!box) continue
    const b = { ...box }
    if (!floating(w, phone)) {
      let collisions = occupied.filter(q => overlaps(b, q))
      while (collisions.length) {
        b.y = Math.max(...collisions.map(q => q.y + q.h))
        collisions = occupied.filter(q => overlaps(b, q))
      }
      occupied.push(b)
    }
    if (b.y > maxY)
      throw new RangeError(
        'There is no room for these blocks within the layout’s 1,000 rows. Move content to another page or shorten the desktop layout first.',
      )
    out.set(w.id, b)
  }
  return out
}
