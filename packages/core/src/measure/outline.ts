import type { Box, Layout, Node } from '../document/index.ts'
import { walk } from '../document/tree.ts'
import { shownAtLayout } from '../document/visibility.ts'
import { effectiveFreeBoxes } from '../layout/phone.ts'
import { flagOf, wrapping } from '../layout/placement.ts'
import type { Registry } from '../registry/index.ts'

const LAYOUTS = ['desktop', 'tablet', 'phone'] as const
type PerLayout<T> = Record<Layout, T>

export type OutlineNode = {
  id: string
  kind: string
  name: string
  section?: { id: string; name: string; look: string }
  depth: number
  parent: string | null
  /** The node's reading position among its shown siblings, or null where it is hidden. */
  order: PerLayout<number | null>
  hidden: PerLayout<boolean>
  /** Only for a child of a Free area; null where it is hidden. */
  box?: PerLayout<Box | null>
}
export type Outline = {
  nodes: OutlineNode[]
  overlaps: { a: string; b: string; layout: Layout }[]
}

/** The layers a layout reads, nearest first: phone inherits tablet, and tablet inherits the base. */
const CHAIN: Record<Layout, ('base' | 'tablet' | 'phone')[]> = {
  desktop: ['base'],
  tablet: ['tablet', 'base'],
  phone: ['phone', 'tablet', 'base'],
}
const orderRank = (w: Node, layout: Layout): number =>
  CHAIN[layout].map(l => w.style?.[l]?.order).find(o => o !== undefined) ?? 0
/** A Box orders its blocks by CSS only on a layout where one of them has its own order (or one above it, for phone). */
const boxOrdered = (parent: Node, layout: Layout) =>
  layout !== 'desktop' &&
  !!parent.children?.some(w =>
    CHAIN[layout].slice(0, -1).some(l => w.style?.[l]?.order !== undefined),
  )
const usesCssOrder = (parent: Node, layout: Layout) =>
  !parent.children?.some(w => wrapping(w, flagOf(layout))) &&
  (['row', 'column', 'grid', 'list'].includes(parent.kind) ||
    (parent.kind === 'box' && boxOrdered(parent, layout)))

/** The shown children of `parent` in the order the layout draws them (a Free area's by position, a CSS-ordered group's by order). */
export function visualSiblings(parent: Node, layout: Layout): Node[] {
  const children = (parent.children ?? []).filter(w => shownAtLayout(w, layout))
  if (parent.kind === 'free') {
    const boxes = effectiveFreeBoxes(parent, layout)
    return children
      .map(w => ({ ...w, slot: { ...w.slot, ...boxes.get(w.id)! } }))
      .sort(
        (a, b) =>
          (a.slot as Box).y - (b.slot as Box).y ||
          (a.slot as Box).x - (b.slot as Box).x,
      )
  }
  return usesCssOrder({ ...parent, children }, layout)
    ? [...children].sort((a, b) => orderRank(a, layout) - orderRank(b, layout))
    : children
}

const per = <T>(fn: (l: Layout) => T): PerLayout<T> => ({
  desktop: fn('desktop'),
  tablet: fn('tablet'),
  phone: fn('phone'),
})
const intersect = (a: Box, b: Box) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/** A tree as the checks see it, read with no browser. A block's name comes from the registry. */
export function outlineOf(root: Node, registry: Registry): Outline {
  const names = new Map(registry.blocks().map(b => [b.id, b.name]))
  const nodes: OutlineNode[] = []
  const overlaps: Outline['overlaps'] = []
  // Each parent's sibling order and boxes are worked out once per layout, not once per child.
  const memo = new Map<string, unknown>()
  const once = <T>(key: string, fn: () => T): T =>
    (memo.has(key) ? memo.get(key) : memo.set(key, fn()).get(key)) as T
  const order = (p: Node, l: Layout) =>
    once(`o:${l}:${p.id}`, () => visualSiblings(p, l).map(x => x.id))
  const boxesOf = (p: Node, l: Layout) =>
    once(`b:${l}:${p.id}`, () => effectiveFreeBoxes(p, l))
  walk(root, (w, parent, depth) => {
    const o = w.origin
    const boxes =
      parent?.kind === 'free'
        ? per(l => boxesOf(parent, l).get(w.id) ?? null)
        : undefined
    nodes.push({
      id: w.id,
      kind: w.kind,
      name: w.name,
      ...(o
        ? {
            section: {
              id: o.block,
              name: names.get(o.block) ?? o.block,
              look: o.look,
            },
          }
        : {}),
      depth,
      parent: parent?.id ?? null,
      order: per(l => {
        if (!parent) return 0
        const i = order(parent, l).indexOf(w.id)
        return i < 0 ? null : i
      }),
      hidden: per(l => !shownAtLayout(w, l)),
      ...(boxes ? { box: boxes } : {}),
    })
    if (w.kind !== 'free') return
    for (const layout of LAYOUTS) {
      const shown = [...boxesOf(w, layout)]
      shown.forEach(([a, boxA], i) => {
        for (const [b, boxB] of shown.slice(i + 1))
          if (intersect(boxA, boxB)) overlaps.push({ a, b, layout })
      })
    }
  })
  return { nodes, overlaps }
}
