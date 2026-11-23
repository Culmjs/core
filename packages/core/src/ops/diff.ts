import { canonicalJson } from '../document/hash.ts'
import type { Node, Problem, SiteDocument } from '../document/index.ts'
import { paged, tagOf } from './cap.ts'
import { cut } from './read.ts'
import { refuse, why, type NodeRef, type TreeRef } from './types.ts'
import { DEPTH_GUARD } from '../document/kinds.ts'

export type SiteDiff = {
  ok: true
  trees: {
    tree: TreeRef
    added: string[]
    removed: string[]
    moved: string[]
    changed: { id: string; paths: string[]; more?: number }[]
  }[]
  /** Top-level keys that differ, `pages.<id>.<field>` for a page's own settings, `pages` for order, `pages.<id>` for an added or removed page, and `components.<id>[.<field>]` likewise. */
  site: string[]
  /** Ids of the affected pages, in document order of `b`. */
  pages: string[]
  cut: boolean
  cursor?: string
}

export type Row = {
  tree: TreeRef
  key: string
  kind: 'added' | 'removed' | 'moved' | 'changed'
  id: string
  paths?: string[]
  more?: number
}
/** At most this many paths in one `changed` row; the rest are counted in `more`. */
const MAX_PATHS = 20
/** A path longer than this (a document with a very long key) is cut, so a row stays small whatever the keys are. */
const MAX_PATH = 200
type Entry = {
  node: Node
  parent: string | null
  index: number
  /** true when this node sits at the guard depth and has children that were not walked */
  cut?: true
}
type Tree = { tree: TreeRef; key: string; root: Node | undefined }

const isObj = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x)
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : [])
/** The canonical text of a value, or undefined for one that cannot be written as JSON (it is then equal to nothing but itself). */
const text = (x: unknown): string | undefined => {
  try {
    return canonicalJson(x)
  } catch {
    return undefined
  }
}
const same = (x: unknown, y: unknown) => {
  if (x === y) return true
  const t = text(x)
  return t !== undefined && t === text(y)
}

/** Every node of a tree by id (first one wins) in document order; what is not a node is skipped. */
function index(root: Node | undefined): Map<string, Entry> {
  const out = new Map<string, Entry>()
  const go = (n: unknown, parent: string | null, i: number, depth: number) => {
    if (!isObj(n) || typeof n.id !== 'string') return
    const kids = arr(n.children)
    // compared node by node down to the shared depth guard; below it, one leaf: its `children` differ or they do not (keeps the recursion off the stack limit)
    const cut = depth >= DEPTH_GUARD && kids.length > 0
    if (!out.has(n.id))
      out.set(n.id, {
        node: n as Node,
        parent,
        index: i,
        ...(cut ? { cut: true as const } : {}),
      })
    if (!cut) kids.forEach((c, j) => go(c, n.id as string, j, depth + 1))
  }
  go(root, null, 0, 0)
  return out
}

/** Dotted paths, at most three levels deep, to the leaves where two values differ. */
function paths(
  x: unknown,
  y: unknown,
  at: string,
  level: number,
  out: Set<string>,
) {
  if (same(x, y)) return
  if (isObj(x) && isObj(y) && level < 3)
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)]))
      paths(x[k], y[k], `${at}.${k}`, level + 1, out)
  else out.add(at)
}

/** Positions (in `seq`) that are not in one longest increasing subsequence. */
function outside(seq: number[]): Set<number> {
  const tails: number[] = [] // index in seq of the smallest tail of each length
  const prev: number[] = []
  seq.forEach((v, i) => {
    let lo = 0
    let hi = tails.length
    while (lo < hi) {
      const m = (lo + hi) >> 1
      if (seq[tails[m]] < v) lo = m + 1
      else hi = m
    }
    prev[i] = lo ? tails[lo - 1] : -1
    tails[lo] = i
  })
  const keep = new Set<number>()
  for (let i = tails.length ? tails[tails.length - 1] : -1; i >= 0; i = prev[i])
    keep.add(i)
  return new Set(seq.map((_, i) => i).filter(i => !keep.has(i)))
}

function treeRows(t: Tree, a: Tree | undefined, b: Tree | undefined): Row[] {
  const ia = a ? index(a.root) : new Map<string, Entry>()
  const ib = b ? index(b.root) : new Map<string, Entry>()
  const row = (kind: Row['kind'], id: string, p?: string[]): Row => ({
    tree: t.tree,
    key: t.key,
    kind,
    id,
    ...(p
      ? {
          paths: p.slice(0, MAX_PATHS).map(x => cut(x, MAX_PATH)),
          ...(p.length > MAX_PATHS ? { more: p.length - MAX_PATHS } : {}),
        }
      : {}),
  })
  const added = [...ib.keys()].filter(id => !ia.has(id))
  const removed = [...ia.keys()].filter(id => !ib.has(id))
  // A node is moved when its parent differs, or when it is not in the longest run of siblings
  // (those with this parent in both versions) that keep their order. Siblings added or removed
  // shift indexes but are not in that run, so they move nobody.
  const moved = new Set<string>()
  const orderA = new Map<string | null, string[]>()
  for (const [id, e] of ia) {
    const o = ib.get(id)
    if (!o) continue
    if (o.parent !== e.parent) moved.add(id)
    else {
      const l = orderA.get(e.parent)
      if (l) l.push(id)
      else orderA.set(e.parent, [id])
    }
  }
  const posB = new Map<string, number>()
  const count = new Map<string | null, number>()
  for (const [id, e] of ib) {
    if (!ia.has(id) || ia.get(id)!.parent !== e.parent) continue
    const n = count.get(e.parent) ?? 0
    posB.set(id, n)
    count.set(e.parent, n + 1)
  }
  for (const ids of orderA.values()) {
    const out = outside(ids.map(id => posB.get(id)!))
    for (const i of out) moved.add(ids[i])
  }
  const changed: Row[] = []
  for (const [id, e] of ia) {
    const o = ib.get(id)
    if (!o) continue
    const out = new Set<string>()
    for (const k of new Set([...Object.keys(e.node), ...Object.keys(o.node)]))
      if (k !== 'children')
        paths(
          (e.node as Record<string, unknown>)[k],
          (o.node as Record<string, unknown>)[k],
          k,
          1,
          out,
        )
    // Below the guard depth nothing was walked: the children count as one value.
    if ((e.cut || o.cut) && !same(e.node.children, o.node.children))
      out.add('children')
    if (out.size) changed.push(row('changed', id, [...out].sort()))
  }
  return [
    ...added.map(id => row('added', id)),
    ...removed.map(id => row('removed', id)),
    ...[...ib.keys()].filter(id => moved.has(id)).map(id => row('moved', id)),
    ...changed,
  ]
}

const PAGE_FIELDS = ['title', 'slug', 'on', 'inMenu', 'inFooter', 'icon']
const COMPONENT_FIELDS = ['name', 'props', 'variants']

/** Each id once, first one wins. */
function byId<T extends { id: string }>(xs: unknown[]): Map<string, T> {
  const m = new Map<string, T>()
  for (const x of xs)
    if (isObj(x) && typeof x.id === 'string' && !m.has(x.id))
      m.set(x.id, x as T)
  return m
}

function treesOf(d: Record<string, unknown>) {
  const pages = byId<SiteDocument['pages'][number]>(arr(d.pages))
  const comps = byId<SiteDocument['components'][number]>(arr(d.components))
  const list: Tree[] = [
    { tree: 'header', key: 'header', root: d.header as Node },
    { tree: 'footer', key: 'footer', root: d.footer as Node },
    ...[...pages.values()].map(p => ({
      tree: { page: p.id },
      key: `p:${p.id}`,
      root: p.root,
    })),
    ...[...comps.values()].map(c => ({
      tree: { component: c.id },
      key: `c:${c.id}`,
      root: c.root,
    })),
  ]
  return { pages, comps, list }
}

/**
 * Compares two site documents tree by tree (header, footer, each page and component by id), one pass per tree with maps by id.
 *
 * How "moved" is decided: a node present in both versions is moved when its parent id differs, or when it has the same parent in
 * both and is not part of the longest run of its shared siblings that kept their relative order (a longest increasing subsequence
 * of their positions). Siblings that exist in only one version are ignored, so inserting a node at the top, or removing one, moves
 * nobody; moving one node among many lists that node alone; swapping two lists one of them.
 *
 * `diffAll` is the whole answer without paging. It takes whatever a store returns: what is not the expected shape is skipped. It does not change its inputs.
 */
export function diffAll(
  a: SiteDocument,
  b: SiteDocument,
): { trees: SiteDiff['trees']; site: string[]; pages: string[]; rows: Row[] } {
  const da: Record<string, unknown> = isObj(a) ? a : {}
  const db: Record<string, unknown> = isObj(b) ? b : {}
  const A = treesOf(da)
  const B = treesOf(db)
  const ta = new Map(A.list.map(t => [t.key, t]))
  const tb = new Map(B.list.map(t => [t.key, t]))
  // Order: header, footer, pages and components of b, then those only in a.
  const keys = [...new Set([...tb.keys(), ...ta.keys()])]
  const rows: Row[] = []
  const dirty = new Set<string>()
  for (const k of keys) {
    const r = treeRows(tb.get(k) ?? ta.get(k)!, ta.get(k), tb.get(k))
    if (r.length) dirty.add(k)
    rows.push(...r)
  }

  const site: string[] = []
  for (const k of [
    'name',
    'look',
    'styles',
    'fonts',
    'languages',
    'centreMaxWidth',
  ])
    if (!same(da[k], db[k])) site.push(k)
  const order = (m: Map<string, unknown>, o: Map<string, unknown>) =>
    [...m.keys()].filter(id => o.has(id))
  if (!same(order(A.pages, B.pages), order(B.pages, A.pages)))
    site.push('pages')
  const own = new Set<string>() // pages whose own settings differ, or that are new
  for (const [id, p] of B.pages) {
    const q = A.pages.get(id)
    if (!q) {
      site.push(`pages.${id}`)
      own.add(id)
      continue
    }
    for (const f of PAGE_FIELDS)
      if (
        !same(
          (p as Record<string, unknown>)[f],
          (q as Record<string, unknown>)[f],
        )
      ) {
        site.push(`pages.${id}.${f}`)
        own.add(id)
      }
  }
  for (const id of A.pages.keys())
    if (!B.pages.has(id)) site.push(`pages.${id}`)
  const changedComp = new Set<string>()
  for (const id of new Set([...B.comps.keys(), ...A.comps.keys()])) {
    const c = B.comps.get(id)
    const o = A.comps.get(id)
    if (!c || !o) site.push(`components.${id}`)
    else
      for (const f of COMPONENT_FIELDS)
        if (
          !same(
            (c as Record<string, unknown>)[f],
            (o as Record<string, unknown>)[f],
          )
        ) {
          site.push(`components.${id}.${f}`)
          changedComp.add(id)
        }
    if (dirty.has(`c:${id}`) || !c || !o) changedComp.add(id)
  }

  // Components a tree of `b` holds an instance of, directly or through another component.
  const memo = new Map<string, Set<string>>()
  const direct = (root: Node | undefined) => {
    const s = new Set<string>()
    for (const e of index(root).values())
      if (e.node.kind === 'instance' && typeof e.node.component === 'string')
        s.add(e.node.component)
    return s
  }
  const uses = (c: string, seen = new Set<string>()): boolean => {
    if (changedComp.has(c)) return true
    if (seen.has(c)) return false
    seen.add(c)
    let m = memo.get(c)
    if (!m) memo.set(c, (m = direct(B.comps.get(c)?.root)))
    return [...m].some(x => uses(x, seen))
  }
  const touches = (t: Tree | undefined) =>
    !!t && [...direct(t.root)].some(c => uses(c))
  const shared =
    dirty.has('header') ||
    dirty.has('footer') ||
    touches(tb.get('header')) ||
    touches(tb.get('footer'))
  const everyPage = !same(da.look, db.look) || !same(da.styles, db.styles)
  const pages = [...B.pages.values()]
    .filter(
      p =>
        everyPage ||
        own.has(p.id) ||
        dirty.has(`p:${p.id}`) ||
        (shared && p.on === true) ||
        touches(tb.get(`p:${p.id}`)),
    )
    .map(p => p.id)

  return { trees: group(rows), site, pages, rows }
}

/**
 * The ids a diff lists, as a batch reports them: `created` is every added id, `changed` every changed or moved id that is not
 * created, each once. A removed id is in neither (the diff's `removed` has it). A page's own settings are in `pages` and `site`.
 */
export function affected(d: Pick<ReturnType<typeof diffAll>, 'trees'>): {
  created: NodeRef[]
  changed: NodeRef[]
} {
  const created: NodeRef[] = []
  const changed: NodeRef[] = []
  for (const t of d.trees) {
    const made = new Set(t.added)
    for (const id of t.added) created.push({ tree: t.tree, id })
    const seen = new Set<string>()
    for (const id of [...t.moved, ...t.changed.map(c => c.id)])
      if (!made.has(id) && !seen.has(id)) {
        seen.add(id)
        changed.push({ tree: t.tree, id })
      }
  }
  return { created, changed }
}

function group(rows: Row[]): SiteDiff['trees'] {
  const out: SiteDiff['trees'] = []
  let last = ''
  for (const r of rows) {
    let g = out[out.length - 1]
    if (!g || last !== r.key) {
      last = r.key
      g = { tree: r.tree, added: [], removed: [], moved: [], changed: [] }
      out.push(g)
    }
    if (r.kind === 'changed')
      g.changed.push({
        id: r.id,
        paths: r.paths!,
        ...(r.more ? { more: r.more } : {}),
      })
    else g[r.kind].push(r.id)
  }
  return out
}

/**
 * What tells one pair of documents from another in a cursor: each document's `schemaVersion`, its page count and its node count over
 * every tree. Cheap on purpose (no hash of the whole document): enough to tell an obviously different pair apart, so it guards against
 * mix-ups and is not a proof that the pair is the same.
 */
function glance(d: unknown): unknown[] {
  if (!isObj(d)) return [null]
  let nodes = 0
  const seen = new Set<unknown>() // a shared or cyclic object is counted once, so this ends for any input
  const todo: unknown[] = [
    d.header,
    d.footer,
    ...arr(d.pages).map(p => (isObj(p) ? p.root : undefined)),
    ...arr(d.components).map(c => (isObj(c) ? c.root : undefined)),
  ]
  while (todo.length) {
    const n = todo.pop()
    if (!isObj(n) || typeof n.id !== 'string' || seen.has(n)) continue
    seen.add(n)
    nodes++
    for (const c of arr(n.children)) todo.push(c)
  }
  return [d.schemaVersion ?? null, arr(d.pages).length, nodes]
}

/**
 * The paged view over `diffAll`. Every part of a reply is paged: the rows are, in order, one per `site` entry, one per affected page id,
 * then the tree rows (one per tree, id and kind of difference). Each reply carries only its slice: `site`, `pages` and `trees` hold the
 * entries of THIS reply (any may be empty) and a caller concatenates them across replies. The cursor's revision is 0, and its tag is
 * made from a glance at each document (see `glance`), so a cursor of another pair is refused when the two differ in schema version, page count or node count.
 * Never throws: `options` that is not an object counts as none, and anything that goes wrong is an INVALID_OPERATION.
 */
export function diffSites(
  a: SiteDocument,
  b: SiteDocument,
  options: { cursor?: string } = {},
): SiteDiff | { ok: false; problems: Problem[] } {
  try {
    const cursor = isObj(options) ? options.cursor : undefined
    const all = diffAll(a, b)
    type R = { s: string } | { p: string } | Row
    const rows: R[] = [
      ...all.site.map(s => ({ s })),
      ...all.pages.map(p => ({ p })),
      ...all.rows,
    ]
    const tag = tagOf('diffSites', glance(a), glance(b))
    return paged(rows, 0, cursor, tag, (page, cut, next): SiteDiff => ({
      ok: true,
      trees: group(page.filter((r): r is Row => 'key' in r)),
      site: page.flatMap(r => ('s' in r ? [r.s] : [])),
      pages: page.flatMap(r => ('p' in r ? [r.p] : [])),
      cut,
      ...(next ? { cursor: next } : {}),
    }))
  } catch (e) {
    return refuse(
      'INVALID_OPERATION',
      `The documents cannot be compared: ${why(e)}`,
    )
  }
}
