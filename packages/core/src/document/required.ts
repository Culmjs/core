import { STATES } from './layers.ts'
import { resolvePart } from './tree.ts'
import type {
  Component,
  Layout,
  Node,
  Override,
  SiteDocument,
  Style,
  StyleLayer,
} from './types.ts'

/** Whether the node must stay in the site: marked `true`, or a form or field not marked `false` (a field also needs its form not marked `false`). */
export function isRequired(node: Node, enclosingForm?: Node): boolean {
  if (node.required !== undefined) return node.required
  if (node.kind === 'form') return true
  return node.kind === 'field' && enclosingForm?.required !== false
}

export type HiddenWhy = {
  /** id of the node that carries the hiding */
  by: string
  how: 'hide' | 'hidden' | 'override' | 'variant'
  /** the layout of a `hide`, or the style layer of a `hidden: true` */
  where: Layout | StyleLayer | 'when'
}

const LAYOUTS: readonly Layout[] = ['desktop', 'tablet', 'phone']

const hideOf = (h: Node['hide']): Layout | undefined =>
  h && typeof h === 'object' ? LAYOUTS.find(l => h[l] === true) : undefined

const hiddenIn = (s: Style | undefined): StyleLayer | 'when' | undefined => {
  if (!s || typeof s !== 'object') return undefined
  const layer = STATES.find(k => s[k]?.hidden === true)
  if (layer) return layer
  return Array.isArray(s.when) && s.when.some(w => w?.decl?.hidden === true)
    ? 'when'
    : undefined
}

/** `hide` or `hidden: true` on a node or on an override or variant patch, as the reason it gives. */
export const reasonOf = (x: Pick<Override, 'hide' | 'style'>) => {
  const l = hideOf(x.hide)
  if (l) return { how: 'hide', where: l } as const
  const s = hiddenIn(x.style)
  return s ? ({ how: 'hidden', where: s } as const) : undefined
}

export type TreeAt =
  'header' | 'footer' | { page: string } | { component: string }

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

/** Visits every node with its ancestors (root first). Anything that is not a node object is skipped. */
export function walkWithAncestors(
  root: Node,
  fn: (n: Node, ancestors: readonly Node[]) => void,
): void {
  const go = (n: Node, up: Node[]) => {
    fn(n, up)
    for (const c of arr(n.children)) if (isObj(c)) go(c as Node, [...up, n])
  }
  if (isObj(root)) go(root, [])
}

/** Every tree of the document with its root; a tree of the wrong shape is skipped. */
export function* trees(doc: SiteDocument): Generator<[TreeAt, Node]> {
  for (const p of arr(doc.pages))
    if (isObj(p) && isObj(p.root) && typeof p.id === 'string')
      yield [{ page: p.id }, p.root as Node]
  if (isObj(doc.header)) yield ['header', doc.header]
  if (isObj(doc.footer)) yield ['footer', doc.footer]
  for (const c of arr(doc.components))
    if (isObj(c) && isObj(c.root) && typeof c.id === 'string')
      yield [{ component: c.id }, c.root as Node]
}

export type Use = { tree: TreeAt; path: readonly Node[] } // path: root .. the instance
export type Index = {
  components: Map<string, Component>
  uses: Map<string, Use[]>
}

/** The components by id, and every instance node by the component it follows. */
function indexOf(doc: SiteDocument): Index {
  const components = new Map<string, Component>()
  for (const c of arr(doc.components))
    if (isObj(c) && typeof c.id === 'string')
      components.set(c.id, c as Component)
  const uses = new Map<string, Use[]>()
  for (const [tree, root] of trees(doc))
    walkWithAncestors(root, (n, up) => {
      if (n.kind === 'instance' && typeof n.component === 'string')
        uses.set(n.component, [
          ...(uses.get(n.component) ?? []),
          { tree, path: [...up, n] },
        ])
    })
  // A use counts only when it is reachable from a page, the header or the footer: directly, or inside a used component.
  const compOf = (u: Use) =>
    typeof u.tree === 'object' && 'component' in u.tree
      ? u.tree.component
      : undefined
  const used = new Set<string>()
  for (let grew = true; grew;) {
    grew = false
    for (const [cid, list] of uses)
      if (
        !used.has(cid) &&
        list.some(u => compOf(u) === undefined || used.has(compOf(u)!))
      ) {
        used.add(cid)
        grew = true
      }
  }
  for (const [cid, list] of uses) {
    const live = list.filter(
      u => compOf(u) === undefined || used.has(compOf(u)!),
    )
    if (live.length) uses.set(cid, live)
    else uses.delete(cid)
  }
  return { components, uses }
}

const partOf = (ix: Index, c: Component, key: string) => {
  try {
    return resolvePart(ix.components, c, key)
  } catch {
    return undefined
  }
}

/** The first reason among `nodes`, nearest first (`nodes` is root first). */
const own = (nodes: readonly Node[]): HiddenWhy | undefined => {
  for (const n of [...nodes].reverse()) {
    const r = isObj(n) ? reasonOf(n) : undefined
    if (r) return { by: n.id, ...r }
  }
  return undefined
}

/** The variants of `comp` that apply to the use `inst`: every entry of a variant's `when` equals the value the use gives that property (its `set`, else its default; a choice takes only one of its options). Same rule as `unrollInstances`. */
export function looksOf(comp: Component, inst: Node): number[] {
  const obj = (v: unknown) =>
    isObj(v) || Array.isArray(v) ? (v as Record<string, unknown>) : {}
  const set = obj(inst.set)
  const values: Record<string, unknown> = {}
  for (const p of arr(comp.props)) {
    if (!isObj(p)) continue
    const given = Object.hasOwn(set, p.key as string)
      ? set[p.key as string]
      : undefined
    const options = p.options as unknown
    values[p.key as string] =
      p.type === 'choice'
        ? typeof given === 'string' &&
          Array.isArray(options) &&
          options.includes(given)
          ? given
          : (p.default ?? (Array.isArray(options) ? options[0] : undefined))
        : (given ?? p.default)
  }
  const looks: number[] = []
  arr(comp.variants).forEach((v, i) => {
    if (
      isObj(v) &&
      isObj(v.when) &&
      Object.entries(v.when).every(([k, val]) => values[k] === val)
    )
      looks.push(i)
  })
  return looks
}

/**
 * Whether a part of component `cid`, or the nodes in `chain` (the part, its ancestors, and the instances above it), is hidden
 * by a variant patch of the component or by an instance of it: the instance itself, its ancestors, or one of its overrides.
 */
function through(
  ix: Index,
  cid: string,
  chain: ReadonlySet<Node>,
  stack: ReadonlySet<string>,
  onlyUse = false,
): HiddenWhy | undefined {
  const comp = ix.components.get(cid)
  if (!comp || stack.has(cid)) return undefined
  const next = new Set(stack).add(cid)
  const patch = (o: unknown, key: string) => {
    const node = partOf(ix, comp, key)
    return node && chain.has(node) && isObj(o) ? reasonOf(o) : undefined
  }
  for (const use of ix.uses.get(cid) ?? []) {
    const inst = use.path[use.path.length - 1]
    if (!onlyUse) {
      // a look hides only for a use that selects it
      const all = arr(comp.variants)
      for (const i of looksOf(comp, inst))
        for (const [k, o] of Object.entries(
          isObj(all[i]) && isObj((all[i] as { patch?: unknown }).patch)
            ? (all[i] as { patch: object }).patch
            : {},
        )) {
          const r = patch(o, k)
          if (r) return { by: cid, ...r, how: 'variant' }
        }
      for (const [k, o] of Object.entries(
        isObj(inst.overrides) ? inst.overrides : {},
      )) {
        const r = patch(o, k)
        if (r) return { by: inst.id, ...r, how: 'override' }
      }
    }
    const r = own(use.path)
    if (r) return r
    if (typeof use.tree === 'object' && 'component' in use.tree) {
      const r2 = through(
        ix,
        use.tree.component,
        new Set([...chain, ...use.path]),
        next,
        onlyUse,
      )
      if (r2) return r2
    }
  }
  return undefined
}

/** `hiddenBy` for a node already found: `path` runs from the root of `tree` to the node. */
export function hiddenAt(
  ix: Index,
  tree: TreeAt,
  path: readonly Node[],
): HiddenWhy | undefined {
  const r = own(path)
  if (r || typeof tree !== 'object' || !('component' in tree)) return r
  return through(ix, tree.component, new Set(path), new Set())
}
export { indexOf as hiddenIndex }

/** What hides a part of a component through the uses that hold it: a use, or an ancestor of one, that is hidden. Not the part's own tree, and not what a use's overrides, properties or looks do to the part (the caller judges those per use). */
export function hiddenViaUse(
  ix: Index,
  tree: TreeAt,
  path: readonly Node[],
): HiddenWhy | undefined {
  return typeof tree === 'object' && 'component' in tree
    ? through(ix, tree.component, new Set(path), new Set(), true)
    : undefined
}

/** An instance further out that can override a part of a nested component: `via` is the ids of the instances between it and the part (`<inner>.<part>` is the key of its override). */
export type Outer = { inst: Node; via: string }
/** How many different sets of outer overrides one use may have, and how many steps the walk may take, before the rest cannot be judged. */
const MAX_CHAINS = 256
const MAX_VISITS = 20000

const hasOverrides = (n: Node) =>
  isObj(n.overrides) && Object.keys(n.overrides).length > 0
// The components an instance with overrides reaches, directly or through the components above it; worked out once per index.
const carries = new WeakMap<Index, Set<string>>()
function carriers(ix: Index): Set<string> {
  let set = carries.get(ix)
  if (set) return set
  set = new Set<string>()
  const above = (u: Use) =>
    typeof u.tree === 'object' && 'component' in u.tree
      ? u.tree.component
      : undefined
  for (let grew = true; grew;) {
    grew = false
    for (const [cid, list] of ix.uses)
      if (
        !set.has(cid) &&
        list.some(
          u =>
            hasOverrides(u.path[u.path.length - 1]) || set!.has(above(u) ?? ''),
        )
      ) {
        set.add(cid)
        grew = true
      }
  }
  carries.set(ix, set)
  return set
}

/**
 * The instances further out that can change a part of the instance at the end of `use.path`, innermost first, one chain for each
 * different set of them. Only an instance whose `overrides` has the key of the nested instance itself (`<via>`, its root) or one under it (`<via>.`) is recorded, so
 * uses that carry no such override are the same chain as the shorter one, however many there are. A use directly in a page,
 * the header or the footer has one chain, empty. `over` is true when the bounds were hit and some chains are missing: the
 * caller must treat that as "not all uses could be checked".
 */
export function outerChains(
  ix: Index,
  use: Use,
): { chains: Outer[][]; over: boolean } {
  const found = new Map<string, Outer[]>()
  const seen = new Map<Node, number>()
  let visits = 0
  let over = false
  const add = (acc: Outer[]) => {
    const key = acc
      .map(o => {
        if (!seen.has(o.inst)) seen.set(o.inst, seen.size)
        return `${seen.get(o.inst)}:${o.via}`
      })
      .join(',')
    if (found.has(key)) return
    if (found.size >= MAX_CHAINS) over = true
    else found.set(key, acc)
  }
  const gives = (inst: Node, via: string) =>
    isObj(inst.overrides) &&
    Object.keys(inst.overrides).some(k => k === via || k.startsWith(`${via}.`))
  const up = (
    tree: TreeAt,
    via: string,
    acc: Outer[],
    stack: ReadonlySet<string>,
  ) => {
    if (over) return
    if (++visits > MAX_VISITS) {
      over = true
      return
    }
    if (typeof tree !== 'object' || !('component' in tree)) return add(acc)
    const cid = tree.component
    if (stack.has(cid)) return
    if (!carriers(ix).has(cid)) return add(acc)
    const next = new Set(stack).add(cid)
    for (const v of ix.uses.get(cid) ?? []) {
      const inst = v.path[v.path.length - 1]
      up(
        v.tree,
        `${inst.id}.${via}`,
        gives(inst, via) ? [...acc, { inst, via }] : acc,
        next,
      )
    }
  }
  up(use.tree, use.path[use.path.length - 1].id, [], new Set())
  return { chains: [...found.values()], over }
}

/**
 * Why a node is hidden, or nothing. It is hidden by `hide` or `hidden: true` on it or an ancestor; and, inside a component,
 * by the same on an instance that uses the component (or its ancestors), by an instance override or a variant patch that
 * resolves to it or to an ancestor, through any depth of nesting. Never throws; a malformed document gives nothing.
 */
export function hiddenBy(
  doc: SiteDocument,
  tree: TreeAt,
  id: string,
): HiddenWhy | undefined {
  try {
    for (const [t, root] of trees(doc)) {
      if (JSON.stringify(t) !== JSON.stringify(tree)) continue
      let hit: readonly Node[] | undefined
      walkWithAncestors(root, (n, up) => {
        if (!hit && n.id === id) hit = [...up, n]
      })
      return hit && hiddenAt(indexOf(doc), tree, hit)
    }
  } catch {
    // a getter or proxy that throws counts as not hidden
  }
  return undefined
}

const num = (v: unknown): v is number => typeof v === 'number'

/** The `size` of a declaration, and the `min` of its `fluidSize`; `at` is the path of the declaration, `real` the same path as it is written in the node (they differ for a `when` layer). */
function* sizesOf(
  d: unknown,
  at: string,
  real = at,
): Iterable<{ size: number; path: string; real: string }> {
  if (!isObj(d)) return
  if (num(d.size))
    yield { size: d.size, path: `${at}.size`, real: `${real}.size` }
  const min = isObj(d.fluidSize) ? d.fluidSize.min : undefined
  if (num(min))
    yield {
      size: min,
      path: `${at}.fluidSize.min`,
      real: `${real}.fluidSize.min`,
    }
}

/** The `size` and `fluidSize.min` of a node's style layers (including `when`) and of the styles of its runs; `path` is relative to the node. */
export function* nodeSizes(
  n: Node,
): Iterable<{ size: number; path: string; real: string }> {
  const style: Record<string, unknown> = isObj(n.style) ? n.style : {}
  const decls: [string, string, unknown][] = [
    ...STATES.map(
      k => [`style.${k}`, `style.${k}`, style[k]] as [string, string, unknown],
    ),
    ...arr(style.when).map(
      (w, i) =>
        [
          `style.when.${i}`,
          `style.when.${i}.decl`,
          isObj(w) ? w.decl : undefined,
        ] as [string, string, unknown],
    ),
    ...arr(isObj(n.props) ? n.props.runs : undefined).map(
      (r, i) =>
        [
          `props.runs.${i}.style`,
          `props.runs.${i}.style`,
          isObj(r) ? r.style : undefined,
        ] as [string, string, unknown],
    ),
  ]
  for (const [at, real, d] of decls) yield* sizesOf(d, at, real)
}

/**
 * Every text size of the document: `size` and the `min` of a `fluidSize` in a node's style layers (including `when`), in the
 * styles of the runs in its `runs` prop, and in a named text style. A node's `path` is relative to the node.
 */
export function* textSizes(
  doc: SiteDocument,
): Iterable<{ size: number; nodeId?: string; path: string }> {
  for (const [, root] of trees(doc)) {
    const found: Node[] = []
    walkWithAncestors(root, n => found.push(n))
    for (const n of found)
      for (const s of nodeSizes(n))
        yield { size: s.size, path: s.path, nodeId: n.id }
  }
  for (const [i, t] of arr(doc.styles?.text).entries())
    for (const s of sizesOf(
      isObj(t) ? t.decl : undefined,
      `styles.text.${i}.decl`,
    ))
      yield { size: s.size, path: s.path }
}

/** Every required node of every tree; a node inside a component counts only when the component is used (an instance of it is reachable from a page, the header or the footer). */
export function requiredRefs(
  doc: SiteDocument,
): { tree: TreeAt; id: string }[] {
  const used = indexOf(doc).uses
  const out: { tree: TreeAt; id: string }[] = []
  for (const [tree, root] of trees(doc)) {
    if (
      typeof tree === 'object' &&
      'component' in tree &&
      !used.has(tree.component)
    )
      continue
    walkWithAncestors(root, (n, up) => {
      const form = [...up].reverse().find(a => a.kind === 'form')
      if (isRequired(n, form)) out.push({ tree, id: n.id })
    })
  }
  return out
}
