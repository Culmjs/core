import { STATES } from './layers.ts'
import type {
  Component,
  Layout,
  Node,
  Override,
  SiteDocument,
  SiteStyles,
  Style,
  StyleLayer,
} from './types.ts'

/** Whether the node must stay in the site: marked `true`, or a form or field not marked `false` (a field also needs its form not marked `false`). */
export function isRequired(node: Node, enclosingForm?: Node): boolean {
  if (node.required !== undefined) return node.required
  if (node.kind === 'form') return true
  return node.kind === 'field' && enclosingForm?.required !== false
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
      if (n.kind === 'instance' && typeof n.component === 'string') {
        const list = uses.get(n.component) ?? []
        list.push({ tree, path: [...up, n] })
        uses.set(n.component, list)
      }
    })
  // A use counts only when it is reachable from a page, the header or the footer: directly, or inside a used component.
  const compOf = (u: Use) =>
    typeof u.tree === 'object' && 'component' in u.tree
      ? u.tree.component
      : undefined
  // Reachability from the pages, header and footer, in one pass: `inside` lists the components each component's tree instantiates.
  const used = new Set<string>()
  const inside = new Map<string, string[]>()
  const todo: string[] = []
  for (const [cid, list] of uses)
    for (const u of list) {
      const host = compOf(u)
      if (host === undefined) {
        if (!used.has(cid)) {
          used.add(cid)
          todo.push(cid)
        }
      } else {
        const l = inside.get(host) ?? []
        l.push(cid)
        inside.set(host, l)
      }
    }
  for (let c = todo.pop(); c !== undefined; c = todo.pop())
    for (const t of inside.get(c) ?? [])
      if (!used.has(t)) {
        used.add(t)
        todo.push(t)
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

const num = (v: unknown): v is number => typeof v === 'number'

/** The optional display ceiling applies only to semantic headings, never to a
 * paragraph, container or shared text preset. The minimum remains site-wide. */
export function textRangeFor(
  styles: SiteStyles | undefined,
  kind: string,
  level: unknown,
) {
  const range = styles?.textRange
  return range?.displayMax !== undefined &&
    kind === 'text' &&
    (level === 'h1' || level === 'h2')
    ? { min: range.min, max: range.displayMax }
    : range
}

/** The `size` of a declaration, and the `min` of its `fluidSize`; `at` is the path of the declaration. */
function* sizesOf(
  d: unknown,
  at: string,
): Iterable<{ size: number; path: string }> {
  if (!isObj(d)) return
  if (num(d.size)) yield { size: d.size, path: `${at}.size` }
  const min = isObj(d.fluidSize) ? d.fluidSize.min : undefined
  if (num(min)) yield { size: min, path: `${at}.fluidSize.min` }
}

/** The `size` and `fluidSize.min` of a node's style layers (including `when`) and of the styles of its runs; `path` is relative to the node. */
export function* nodeSizes(n: Node): Iterable<{ size: number; path: string }> {
  const style: Record<string, unknown> = isObj(n.style) ? n.style : {}
  const decls: [string, unknown][] = [
    ...STATES.map(k => [`style.${k}`, style[k]] as [string, unknown]),
    ...arr(style.when).map(
      (w, i) =>
        [`style.when.${i}.decl`, isObj(w) ? w.decl : undefined] as [
          string,
          unknown,
        ],
    ),
    ...arr(isObj(n.props) ? n.props.runs : undefined).map(
      (r, i) =>
        [`props.runs.${i}.style`, isObj(r) ? r.style : undefined] as [
          string,
          unknown,
        ],
    ),
  ]
  for (const [at, d] of decls) yield* sizesOf(d, at)
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
