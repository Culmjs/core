import { canonicalJson } from '../document/hash.ts'
import type { Node, Problem, SiteDocument } from '../document/index.ts'
import { paged } from './cap.ts'
import type { TreeRef } from './types.ts'

export type SiteDiff = {
  ok: true
  trees: {
    tree: TreeRef
    added: string[]
    removed: string[]
    moved: string[]
    changed: { id: string; paths: string[] }[]
  }[]
  /** Top-level keys that differ, `pages.<id>.<field>` for a page's own settings, `pages` for order, `pages.<id>` for an added or removed page, and `components.<id>[.<field>]` likewise. */
  site: string[]
  /** Ids of the affected pages, in document order of `b`. */
  pages: string[]
  cut: boolean
  cursor?: string
}

type Row = {
  tree: TreeRef
  key: string
  kind: 'added' | 'removed' | 'moved' | 'changed'
  id: string
  paths?: string[]
}
type Entry = { node: Node; parent: string | null; index: number }
type Tree = { tree: TreeRef; key: string; root: Node | undefined }

const isObj = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x)
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : [])
const text = (x: unknown): string => {
  try {
    return canonicalJson(x)
  } catch {
    return `#${Math.random()}` // not comparable: counts as different
  }
}
const same = (x: unknown, y: unknown) => x === y || text(x) === text(y)

/** Every node of a tree by id (first one wins) in document order; what is not a node is skipped. */
function index(root: Node | undefined): Map<string, Entry> {
  const out = new Map<string, Entry>()
  const go = (n: unknown, parent: string | null, i: number) => {
    if (!isObj(n) || typeof n.id !== 'string') return
    if (!out.has(n.id)) out.set(n.id, { node: n as Node, parent, index: i })
    arr(n.children).forEach((c, j) => go(c, n.id as string, j))
  }
  go(root, null, 0)
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
    ...(p ? { paths: p } : {}),
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
    else orderA.set(e.parent, [...(orderA.get(e.parent) ?? []), id])
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
 * The paged rows are (tree, id, kind of difference); `site` and `pages` come with every page. The cursor's revision is 0.
 * It takes whatever a store returns: what is not the expected shape is skipped. It does not change its inputs.
 */
export function diffSites(
  a: SiteDocument,
  b: SiteDocument,
  options: { cursor?: string } = {},
): SiteDiff | { ok: false; problems: Problem[] } {
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
  for (const k of ['name', 'look', 'styles', 'fonts', 'languages'])
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

  return paged(rows, 0, options.cursor, (page, cut, cursor): SiteDiff => {
    const out: SiteDiff['trees'] = []
    let last = ''
    for (const r of page) {
      let g = out[out.length - 1]
      if (!g || last !== r.key) {
        last = r.key
        g = { tree: r.tree, added: [], removed: [], moved: [], changed: [] }
        out.push(g)
      }
      if (r.kind === 'changed') g.changed.push({ id: r.id, paths: r.paths! })
      else g[r.kind].push(r.id)
    }
    return {
      ok: true,
      trees: out,
      site,
      pages,
      cut,
      ...(cursor ? { cursor } : {}),
    }
  })
}
