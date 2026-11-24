import type { Component, FreeSlot, Kind, Node, Slot } from './types.ts'

const s = (w: Node) => w.slot as FreeSlot

type At = { x: number; y: number }

/** Splits children into runs along one axis wherever nothing crosses the gap. */
export function runs(ws: Node[], at: 'x' | 'y', size: 'w' | 'h'): Node[][] {
  const out: Node[][] = []
  let end = -Infinity
  for (const p of [...ws].sort((a, b) => s(a)[at] - s(b)[at])) {
    if (!out.length || s(p)[at] >= end) out.push([])
    out[out.length - 1].push(p)
    end = Math.max(end, s(p)[at] + s(p)[size])
  }
  return out
}

/** Reading order for a Free area's children: an XY cut, so a left column reads before a photo on the right. */
export function groupOrder(children: Node[]): Node[] {
  if (children.length < 2) return children
  for (const [at, size] of [
    ['y', 'h'],
    ['x', 'w'],
  ] as const) {
    const parts = runs(children, at, size)
    if (parts.length > 1) return parts.flatMap(groupOrder)
  }
  return [...children].sort((a, b) => s(a).y - s(b).y || s(a).x - s(b).x)
}

/** The compiler and an editor's reading-order view share Free's spatial ordering. */
export const orderedChildren = (w: Node): Node[] =>
  w.kind === 'free' ? groupOrder(w.children ?? []) : (w.children ?? [])

export function walk(
  root: Node,
  fn: (w: Node, parent: Node | null, depth: number) => void,
): void {
  const go = (w: Node, p: Node | null, d: number) => {
    fn(w, p, d)
    for (const c of w.children ?? []) go(c, w, d + 1)
  }
  go(root, null, 0)
}

export function find(root: Node, id: string): Node | undefined {
  let hit: Node | undefined
  walk(root, w => {
    if (!hit && w.id === id) hit = w
  })
  return hit
}

export function parentOf(root: Node, id: string): Node | undefined {
  let hit: Node | undefined
  walk(root, (w, p) => {
    if (!hit && p && w.id === id) hit = p
  })
  return hit
}

export function count(root: Node): number {
  let n = 0
  walk(root, () => n++)
  return n
}

// Each change clones the tree once, then edits the clone, so the input is never touched.
function edit(root: Node, fn: (copy: Node) => void): Node {
  const copy = structuredClone(root)
  fn(copy)
  return copy
}

export const replace = (root: Node, id: string, w: Node): Node =>
  root.id === id
    ? structuredClone(w)
    : edit(root, c => {
        const p = parentOf(c, id)!
        p.children![p.children!.findIndex(x => x.id === id)] =
          structuredClone(w)
      })

export const remove = (root: Node, id: string): Node =>
  edit(root, c => {
    const p = parentOf(c, id)
    if (p) p.children = p.children!.filter(x => x.id !== id)
  })

export const insert = (
  root: Node,
  parentId: string,
  index: number,
  w: Node,
): Node =>
  edit(root, c => {
    const p = find(c, parentId)!
    ;(p.children ??= []).splice(index, 0, structuredClone(w))
  })

export function move(
  root: Node,
  id: string,
  parentId: string,
  index: number,
  at?: At,
): Node {
  const w = find(root, id)!
  const parent = find(root, parentId)!
  const moved = { ...structuredClone(w), slot: slotFor(parent.kind, w, at) }
  // Index counts positions after the node leaves its old place.
  return edit(root, copy => {
    const old = parentOf(copy, id)
    if (old) old.children = old.children!.filter(x => x.id !== id)
    const next = find(copy, parentId)!
    ;(next.children ??= []).splice(index, 0, moved)
  })
}

export function slotFor(parentKind: Kind, w: Node, at?: At): Slot {
  switch (parentKind) {
    case 'free': {
      const cur = (w.slot as { w?: number }).w
      return { x: at?.x ?? 0, y: at?.y ?? 0, w: cur ?? 6, h: 4, z: 0 }
    }
    case 'row':
    case 'column':
      return { grow: 0, align: 'stretch' }
    case 'grid':
      return { cols: 1, rows: 1 }
    default:
      return {}
  }
}

/** A table repeats its last row; other repeats copy the first child. */
export const templateIndex = (w: Node): number =>
  w.kind === 'table' ? (w.children?.length ?? 0) - 1 : 0

/** Names every descendant `<rootId>.<localId>`, gives the root `rootId`, and rewrites internal references. */
export function blockIds(rootId: string, w: Node): Node {
  // A JSON copy, not structuredClone: structuredClone keeps a style object that several nodes share as one object,
  // so a hide switch written through one node would hide them all. Nodes are plain JSON.
  const copy: Node = JSON.parse(JSON.stringify(w))
  const local = new Map<string, string>([[w.id, rootId]])
  walk(copy, (x, p) => {
    if (p) local.set(x.id, `${rootId}.${x.id}`)
  })
  walk(copy, (x, p) => {
    x.id = p ? local.get(x.id)! : rootId
    const o = x.props?.opens
    if (typeof o === 'string' && local.has(o)) x.props!.opens = local.get(o)!
    retarget(x, local)
  })
  return copy
}

/** "title.props.level" -> the block's `title` node and the path ["props", "level"]; "$root.showIf" -> the block's own root. null if it isn't under the root. */
export function localTarget(
  blockRoot: Node,
  target: string,
): { node: Node; path: string[] } | null {
  const [local, ...path] = target.split('.')
  const node =
    local === '$root' ? blockRoot : find(blockRoot, `${blockRoot.id}.${local}`)
  return node ? { node, path } : null
}

const TARGET_KEYS = ['scrollTo', 'open', 'close', 'play', 'pause'] as const
/** The block a trigger's action points at, if it points at one. */
export const targetOf = (d: unknown): string | undefined => {
  const o = (d ?? {}) as Record<string, unknown>
  const k = TARGET_KEYS.find(x => typeof o[x] === 'string')
  return k ? (o[k] as string) : undefined
}

/** Points trigger actions and motion steps at the new ids in this copy. */
export function retarget(w: Node, ids: ReadonlyMap<string, string>): void {
  for (const t of Array.isArray(w.on) ? w.on : []) {
    const d = t?.do as Record<string, unknown> | undefined
    for (const k of TARGET_KEYS)
      if (d && typeof d[k] === 'string' && ids.has(d[k] as string))
        d[k] = ids.get(d[k] as string)
  }
  const m = w.motion
  if (m && typeof m === 'object' && 'steps' in m && Array.isArray(m.steps))
    for (const step of m.steps) {
      const t = step?.target
      if (t && typeof t === 'object' && ids.has(t.id)) t.id = ids.get(t.id)!
    }
}

export function refsTo(root: Node, id: string): Node[] {
  const out: Node[] = []
  walk(root, w => {
    if (
      w.props?.opens === id ||
      (Array.isArray(w.on) && w.on.some(t => targetOf(t?.do) === id))
    )
      out.push(w)
  })
  return out
}

/**
 * A part of a component: a plain part id, or `<nestedInstanceId>.<partId>` through the component nested there.
 * Save and render both resolve overrides with this, so what one accepts the other applies. Cycles stop it; there is no depth cap.
 */
export function resolvePart(
  components: ReadonlyMap<string, Component>,
  c: Component,
  id: string,
): Node | undefined {
  const seen = new Set<string>()
  for (;;) {
    seen.add(c.id)
    const i = id.indexOf('.'),
      x = find(c.root, i < 0 ? id : id.slice(0, i))
    if (i < 0 || !x) return x
    const inner =
      x.kind === 'instance' ? components.get(x.component as string) : undefined
    if (!inner || seen.has(inner.id)) return undefined
    c = inner
    id = id.slice(i + 1)
  }
}
