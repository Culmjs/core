// `find`: where a thing is, as the small JSX of it, its tree, its element path (the one `write` errors use) and the id a targeted `write` needs.
// Also the index of a site (each tree's top-level sections) and the path of any node id, for the replies of `write`.
import type { Node, SiteDocument } from '@culmjs/core'
import { emit, nameOf } from './tree.ts'

type Obj = Record<string, unknown>
export type Hit = {
  id: string
  tree: string
  path: string
  kind: string
  text?: string
  children: number
  jsx: string
}

const label = (kind: string) =>
  kind === 'instance' ? 'Instance' : nameOf(kind)

/** Every tree of the site: its name ("header", "footer" or a page id) and root. */
export const treesOf = (doc: SiteDocument): [string, Node][] => [
  ['header', doc.header],
  ['footer', doc.footer],
  ...doc.pages.map(p => [p.id, p.root] as [string, Node]),
]

/** The words a node shows: its runs, label, alt, placeholder or summary. */
export function textOf(n: Node): string {
  const p = (n.props ?? {}) as Obj
  if (Array.isArray(p.runs))
    return (p.runs as Obj[])
      .map(r => (typeof r.text === 'string' ? r.text : r.br ? ' ' : ''))
      .join('')
  for (const k of ['label', 'alt', 'placeholder', 'summary'])
    if (typeof p[k] === 'string' && p[k] !== '') return p[k] as string
  return ''
}

/** Walks the children of each root; `up` is the chain of ancestors, each with its place among its siblings. */
function walk(
  doc: SiteDocument,
  only: string | undefined,
  f: (n: Node, up: Node[], path: string, tree: string) => void,
) {
  for (const [tree, root] of treesOf(doc)) {
    if (only !== undefined && tree !== only) continue
    const go = (n: Node, up: Node[], at: string) => {
      f(n, up, at, tree)
      ;(n.children ?? []).forEach((c, i) =>
        go(c, [...up, n], `${at} > ${label(c.kind)}[${i}]`),
      )
    }
    ;(root.children ?? []).forEach((c, i) =>
      go(c, [], `${label(c.kind)}[${i}]`),
    )
  }
}

/** `<tree>:<path>` of every node id (headers and footers included). */
export function pathIndex(doc: SiteDocument): Map<string, string> {
  const m = new Map<string, string>()
  walk(doc, undefined, (n, _u, path, tree) => m.set(n.id, `${tree}:${path}`))
  return m
}

type Compound = {
  kind?: string
  id?: string
  attrs: [string, string, string][]
}
type Step = { comb: '>' | ' '; c: Compound }

/** `Row > Text[level=1]`, `Column Button`, `#hero`, `Text[text*=Order]`: names of elements, `>` and spaces, `#id`, `[name=value]`, `[name*=part]`. */
export function parseSelector(sel: string): Step[] | string {
  const steps: Step[] = []
  const re = /\s*(>)\s*|\s+/y
  let i = 0
  let comb: '>' | ' ' = ' '
  const s = sel.trim()
  if (!s) return 'The selector is empty.'
  while (i < s.length) {
    const m = /^(\*|[A-Za-z][A-Za-z0-9]*)?(#[a-z0-9]+)?((?:\[[^\]]*\])*)/.exec(
      s.slice(i),
    )
    if (!m || !m[0])
      return `Cannot read the selector at "${s.slice(i, i + 12)}".`
    const c: Compound = { attrs: [] }
    if (m[1] && m[1] !== '*') c.kind = m[1]
    if (m[2]) c.id = m[2].slice(1)
    for (const a of m[3]!.match(/\[[^\]]*\]/g) ?? []) {
      const p =
        /^\[\s*([A-Za-z][\w.]*)\s*(\*=|=)\s*["']?([^"'\]]*?)["']?\s*\]$/.exec(a)
      if (!p) return `Cannot read ${a}; write [name=value] or [name*=part].`
      c.attrs.push([p[1]!, p[2]!, p[3]!])
    }
    steps.push({ comb, c })
    i += m[0].length
    if (i >= s.length) break
    re.lastIndex = i
    const sep = re.exec(s)
    if (!sep) return `Cannot read the selector at "${s.slice(i, i + 12)}".`
    comb = sep[1] ? '>' : ' '
    i = re.lastIndex
  }
  return steps
}

const attrOf = (n: Node, name: string): string | undefined => {
  if (name === 'text') return textOf(n)
  if (name === 'kind') return n.kind
  if (name === 'id') return n.id
  const p = (n.props ?? {}) as Obj
  const v = p[name] ?? ((n.style?.base ?? {}) as Obj)[name]
  return v === undefined || typeof v === 'object' ? undefined : String(v)
}
const matches = (n: Node, c: Compound) =>
  (c.kind === undefined ||
    n.kind === c.kind.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()) &&
  (c.id === undefined || n.id === c.id) &&
  c.attrs.every(([k, op, want]) => {
    const v = attrOf(n, k)
    if (v === undefined) return false
    const [a, b] = [v.toLowerCase(), want.toLowerCase()]
    return op === '='
      ? a === b || (k === 'level' && a === `h${b}`)
      : a.includes(b)
  })
/** The node `up` leads to matches the steps (right to left). */
function selects(steps: Step[], at: number, n: Node, up: Node[]): boolean {
  if (!matches(n, steps[at]!.c)) return false
  if (at === 0) return true
  const left = at - 1
  if (steps[at]!.comb === '>') {
    const p = up[up.length - 1]
    return !!p && selects(steps, left, p, up.slice(0, -1))
  }
  for (let k = up.length - 1; k >= 0; k--)
    if (selects(steps, left, up[k]!, up.slice(0, k))) return true
  return false
}

export type Query = {
  text?: string
  kind?: string
  id?: string
  selector?: string
  /** "header", "footer" or a page id. */
  tree?: string
  /** The whole subtree as JSX, not the node alone. */
  full?: boolean
  limit?: number
}

const clip = (s: string, n: number) =>
  s.length > n ? `${s.slice(0, n - 1)}…` : s

export function findNodes(
  doc: SiteDocument,
  q: Query,
): { hits: Hit[]; total: number } | { error: string } {
  const steps = q.selector !== undefined ? parseSelector(q.selector) : undefined
  if (typeof steps === 'string') return { error: steps }
  const kind = q.kind?.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
  const text = q.text?.toLowerCase()
  const limit = Math.min(Math.max(q.limit ?? 20, 1), 50)
  const hits: Hit[] = []
  let total = 0
  walk(doc, q.tree, (n, up, path, tree) => {
    if (q.id !== undefined && n.id !== q.id) return
    if (kind !== undefined && n.kind !== kind) return
    if (text !== undefined && !textOf(n).toLowerCase().includes(text)) return
    if (steps && !selects(steps, steps.length - 1, n, up)) return
    total++
    if (hits.length >= limit) return
    let jsx: string
    try {
      jsx = q.full ? emit(n) : emit({ ...n, children: [] })
    } catch {
      jsx = `(a ${n.kind} cannot be shown as JSX)`
    }
    const t = textOf(n)
    hits.push({
      id: n.id,
      tree,
      path,
      kind: label(n.kind),
      ...(t ? { text: clip(t, 80) } : {}),
      children: (n.children ?? []).length,
      jsx: clip(jsx, q.full ? 3000 : 400),
    })
  })
  return { hits, total }
}

/** What exists, short: each tree's top-level sections as id, kind and first words. */
export function indexOf(doc: SiteDocument) {
  const first = (n: Node): string => {
    const t = textOf(n)
    if (t) return t
    for (const c of n.children ?? []) {
      const x = first(c)
      if (x) return x
    }
    return ''
  }
  return treesOf(doc).map(([tree, root]) => {
    const page = doc.pages.find(p => p.id === tree)
    return {
      tree,
      ...(page ? { path: page.slug } : {}),
      sections: (root.children ?? []).map(c => {
        const t = first(c)
        return {
          id: c.id,
          kind: label(c.kind),
          ...(t ? { text: clip(t, 30) } : {}),
        }
      }),
    }
  })
}
