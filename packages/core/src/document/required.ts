import { STATES } from './layers.ts'
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
const reasonOf = (x: Pick<Override, 'hide' | 'style'>) => {
  const l = hideOf(x.hide)
  if (l) return { how: 'hide', where: l } as const
  const s = hiddenIn(x.style)
  return s ? ({ how: 'hidden', where: s } as const) : undefined
}

/**
 * Why a node is hidden, or nothing. Looks at the node and its ancestors (root first in `ancestors`), then at the
 * overrides of the instances in `ctx.uses` and the variant patches of `ctx.component`, for the node and its ancestors.
 */
export function hiddenBy(
  node: Node,
  ancestors: readonly Node[],
  ctx: { component?: Component; uses?: readonly Node[] },
): HiddenWhy | undefined {
  const chain = [node, ...[...ancestors].reverse()]
  for (const n of chain) {
    const r = reasonOf(n)
    if (r) return { by: n.id, ...r }
  }
  for (const inst of ctx.uses ?? [])
    for (const n of chain) {
      // a key is a plain part id, or `<nestedInstanceId>.<partId>` (any depth) from an outer instance
      for (const [k, o] of Object.entries(inst.overrides ?? {})) {
        if (k !== n.id && !k.endsWith(`.${n.id}`)) continue
        const r = o && reasonOf(o)
        if (r) return { by: inst.id, ...r, how: 'override' }
      }
    }
  for (const v of ctx.component?.variants ?? [])
    for (const n of chain) {
      const o = v.patch?.[n.id]
      const r = o && reasonOf(o)
      if (r) return { by: ctx.component!.id, ...r, how: 'variant' }
    }
  return undefined
}

/** Visits every node with its ancestors (root first). */
export function walkWithAncestors(
  root: Node,
  fn: (n: Node, ancestors: readonly Node[]) => void,
): void {
  const go = (n: Node, up: Node[]) => {
    fn(n, up)
    for (const c of n.children ?? []) go(c, [...up, n])
  }
  go(root, [])
}

type Tree = 'header' | 'footer' | { page: string } | { component: string }

/** Every tree of the document with its root. */
export function* trees(doc: SiteDocument): Generator<[Tree, Node]> {
  for (const p of doc.pages) yield [{ page: p.id }, p.root]
  yield ['header', doc.header]
  yield ['footer', doc.footer]
  for (const c of doc.components) yield [{ component: c.id }, c.root]
}

/** Every instance node of the document, grouped by the component it follows. */
export function usesByComponent(doc: SiteDocument): Map<string, Node[]> {
  const out = new Map<string, Node[]>()
  for (const [, root] of trees(doc))
    walkWithAncestors(root, n => {
      if (n.kind === 'instance' && typeof n.component === 'string')
        out.set(n.component, [...(out.get(n.component) ?? []), n])
    })
  return out
}

/** The instances whose overrides can reach a component's parts: its own, and those of the components that nest them, outward. */
export function reachingUses(doc: SiteDocument, id: string): Node[] {
  const by = usesByComponent(doc)
  const owner = new Map<string, string>() // instance id -> component whose tree holds it
  for (const c of doc.components)
    walkWithAncestors(c.root, n => {
      if (n.kind === 'instance') owner.set(n.id, c.id)
    })
  const out: Node[] = []
  const seen = new Set<string>()
  const go = (cid: string) => {
    if (seen.has(cid)) return
    seen.add(cid)
    for (const i of by.get(cid) ?? []) {
      out.push(i)
      const o = owner.get(i.id)
      if (o) go(o)
    }
  }
  go(id)
  return out
}

const num = (v: unknown): v is number => typeof v === 'number'

/** Every text size of the document: `size` in a node's style layers (including `when`), in a run's style, in a named text style, and the `min` of a `fluidSize`. */
export function* textSizes(
  doc: SiteDocument,
): Iterable<{ size: number; nodeId?: string; path: string }> {
  for (const [, root] of trees(doc)) {
    const stack = [root]
    for (let n = stack.pop(); n; n = stack.pop()) {
      stack.push(...[...(n.children ?? [])].reverse())
      const at = `${n.id}.style`
      const layers: [string, Style[StyleLayer]][] = [
        ...STATES.map(k => [`${at}.${k}`, n.style?.[k]] as [string, never]),
        ...(Array.isArray(n.style?.when) ? n.style.when : []).map(
          (w, i) => [`${at}.when[${i}].decl`, w?.decl] as [string, never],
        ),
      ]
      for (const [path, d] of layers) {
        if (num(d?.size))
          yield { size: d.size, nodeId: n.id, path: `${path}.size` }
        const min = d?.fluidSize?.min
        if (num(min))
          yield { size: min, nodeId: n.id, path: `${path}.fluidSize.min` }
      }
      for (const [key, v] of Object.entries(n.props ?? {}))
        if (Array.isArray(v))
          for (const [i, run] of v.entries()) {
            const size = (run as { style?: { size?: unknown } } | null)?.style
              ?.size
            if (num(size))
              yield {
                size,
                nodeId: n.id,
                path: `${n.id}.props.${key}[${i}].style.size`,
              }
          }
    }
  }
  for (const [i, t] of (doc.styles?.text ?? []).entries())
    if (num(t?.decl?.size))
      yield { size: t.decl.size, path: `styles.text[${i}].decl.size` }
}

/** Every required node of every tree; a node inside a component counts only when an instance uses the component. */
export function requiredRefs(doc: SiteDocument): { tree: Tree; id: string }[] {
  const used = usesByComponent(doc)
  const out: { tree: Tree; id: string }[] = []
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
