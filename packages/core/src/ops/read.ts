import type {
  Layout,
  Node,
  Problem,
  PropValue,
  SiteDocument,
} from '../document/index.ts'
import { KINDS } from '../document/index.ts'
import { STATES } from '../document/layers.ts'
import { isRequired, requiredRefs } from '../document/required.ts'
import { readSettings } from '../registry/block.ts'
import type { Registry } from '../registry/index.ts'
import { FOREIGN_CURSOR, READ_CAP, paged, tagOf } from './cap.ts'
import { bad } from './nodes.ts'
import { rootOf, trees } from './trees.ts'
import { refuse } from './types.ts'
import type { Head, TreeRef } from './types.ts'

type Refusal = { ok: false; problems: Problem[] }
type Page = { cut: boolean; cursor?: string }

export type SiteOutline = {
  ok: true
  revision: number
  cut: boolean
  cursor?: string
  name: string
  languages: { code: string; dir?: 'rtl' }[]
  textRange?: { min: number; max: number; displayMax?: number }
  required: number
  header: number
  footer: number
  styles: {
    colors: string[]
    text: string[]
    shadows: string[]
    /** How many names each list leaves out, for the lists that were cut. */
    more?: { colors?: number; text?: number; shadows?: number }
  }
  fonts: string[]
  fontsMore?: number
  languagesMore?: number
  rows: (
    | { page: string; title: string; slug: string; on: boolean; nodes: number }
    | { component: string; name: string; uses: number }
  )[]
}
/** Depth-first; `depth` rebuilds the tree. What is at its default (no name of its own, shown, not required, no children) is left out. */
export type OutlineRow = {
  id: string
  kind: string
  depth: number
  name?: string
  hidden?: Layout[]
  block?: string
  required?: true
  text?: string
  children?: number
}
export type PageOutline = {
  ok: true
  revision: number
  rows: OutlineRow[]
} & Page
export type NodeRead = {
  ok: true
  revision: number
  node: Record<string, unknown>
  settings?: Record<string, PropValue | undefined>
  /** Dotted paths of the fields that were cut or replaced by `{ cut: <characters> }`. A cut field cannot be had in full from a read; a cut `children` is listed by `pageOutline` with `from`. A field that was cut first and then replaced with its parent is listed with the parent. */
  cutFields?: string[]
  moreCut?: number
} & Page
export type SearchQuery = {
  text?: string
  kind?: string
  block?: string
  cursor?: string
}
export type SearchResult = {
  ok: true
  revision: number
  rows: { tree: TreeRef; id: string; kind: string; text?: string }[]
} & Page

// ---- limits. Every bound is a serialised length: `JSON.stringify(value).length`, never a count of characters.
/** A preview of a node's text in a row. */
const PREVIEW = 60
/** A name, title, slug or kind in a row. */
const LABEL = 100
/** The site's name in the header of `siteOutline`. */
const SITE_NAME = 200
/** A style, font or language name in the header. */
const NAME = 80
/** Names listed per style list and fonts listed; the rest is counted. */
const LISTED = 50
/** Languages listed. */
const LANGUAGES = 20
/** The header of `siteOutline` (everything but the paged rows). */
const HEADER = 4000
/** A string of `readNode` longer than this is cut. */
const FIELD = 2000
/** An id or kind of the node `readNode` returns. */
const ID = 200
/** The node of `readNode`, without its runs, may be this long. */
const NODE_BUDGET = READ_CAP / 2
/** A run of `readNode` without its `text` may be this long. */
const SKELETON = 2000
/** Paths listed in `cutFields`, and their length. */
const CUT_LISTED = 50
const CUT_PATH = 80

export const len = (v: unknown) => JSON.stringify(v)?.length ?? 0

const LAYOUTS: readonly Layout[] = ['desktop', 'tablet', 'phone']
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const isNode = (v: unknown): v is Node => isObj(v) && typeof v.id === 'string'
const str = (v: unknown) => (typeof v === 'string' ? v : '')

/**
 * The longest prefix of `s` whose JSON form (quotes included) is at most `budget` characters, so a string of quotes or control
 * characters comes out shorter than a plain one. Never ends inside a surrogate pair. Reads no further than the budget.
 */
export function cut(s: string, budget: number): string {
  let cost = 2
  let i = 0
  while (i < s.length) {
    const c = s.charCodeAt(i)
    let w = 1
    let step = 1
    if (c === 34 || c === 92) w = 2
    else if (c < 32)
      w = c === 8 || (c >= 9 && c <= 10) || c === 12 || c === 13 ? 2 : 6
    else if (c >= 0xd800 && c <= 0xdbff) {
      const d = s.charCodeAt(i + 1)
      if (d >= 0xdc00 && d <= 0xdfff) {
        w = 2
        step = 2
      } else w = 6
    } else if (c >= 0xdc00 && c <= 0xdfff) w = 6
    if (cost + w > budget) break
    cost += w
    i += step
  }
  return i >= s.length ? s : s.slice(0, i)
}

/** The marker for a value that is too big to show. Its size is bounded and it never needs shrinking. */
export const marker = (v: unknown) => ({ cut: len(v) })

/** A reply that is over the cap is never returned; it would be a mistake in the reads. */
export function capped<R>(r: R | Refusal): R | Refusal {
  return (r as { ok?: unknown }).ok === true && len(r) > READ_CAP
    ? refuse('RESOURCE_LIMIT_EXCEEDED', 'The reply could not be made to fit.')
    : r
}

/** The text of a node: its runs joined, a line break as a space; at most `limit` characters are collected. */
function textOf(n: Node, limit = Infinity): string {
  const runs = isObj(n.props) ? n.props.runs : undefined
  let out = ''
  for (const r of arr(runs)) {
    if (!isObj(r)) continue
    if (r.br === true) out += ' '
    else if (typeof r.text === 'string') out += r.text
    if (out.length >= limit) break
  }
  return out
}

type Ctx = {
  parent: string | null
  index: number
  depth: number
  form?: Node
  /** The block the node belongs to: its own `origin.block`, else that of the nearest ancestor that has one. */
  block?: string
}
const rootCtx: Ctx = { parent: null, index: 0, depth: 0 }

/** Depth-first, document order. `fn` returns false to leave a node's children out. What is not a node is skipped. */
function walk(
  n: unknown,
  ctx: Ctx,
  fn: (n: Node, ctx: Ctx) => boolean | void,
): void {
  if (!isNode(n)) return
  const own = isObj(n.origin) ? n.origin.block : undefined
  const here = typeof own === 'string' ? { ...ctx, block: own } : ctx
  if (fn(n, here) === false) return
  const next: Ctx = {
    parent: n.id,
    index: 0,
    depth: ctx.depth + 1,
    form: n.kind === 'form' ? n : ctx.form,
    block: here.block,
  }
  for (const c of arr(n.children))
    if (isNode(c)) walk(c, { ...next, index: next.index++ }, fn)
}

/** A tree reference for a row: a page or component id longer than ID (only in an invalid document) is cut, so a row stays small. */
const shortTree = (tree: TreeRef): TreeRef =>
  typeof tree === 'string'
    ? tree
    : 'page' in tree
      ? { page: cut(tree.page, ID) }
      : { component: cut(tree.component, ID) }

const count = (root: unknown) => {
  let n = 0
  walk(root, rootCtx, () => void n++)
  return n
}

function checkHead(site: unknown): Refusal | undefined {
  if (
    !isObj(site) ||
    !isObj(site.doc) ||
    !Number.isSafeInteger(site.revision) ||
    (site.revision as number) < 0
  )
    return bad('The site must be { doc, revision }.', { path: 'site' })
  return undefined
}

function rootFor(doc: SiteDocument, tree: unknown): Node | Refusal {
  const root = rootOf(doc, tree as TreeRef)
  return isNode(root) ? root : bad('No such tree.', { path: 'tree' })
}
const isRefusal = (v: unknown): v is Refusal =>
  isObj(v) && v.ok === false && 'problems' in v

/** Options: absent or an object; each given key checked by `ok`. */
function optionsOf(
  options: unknown,
  checks: Record<string, (v: unknown) => boolean>,
): Record<string, unknown> | Refusal {
  if (options === undefined) return {}
  if (!isObj(options))
    return bad('Options must be an object.', { path: 'options' })
  for (const [k, ok] of Object.entries(checks))
    if (options[k] !== undefined && !ok(options[k]))
      return bad(`Option "${k}" is not valid.`, { path: k })
  return options
}

/**
 * No read throws: whatever goes wrong inside on input of the wrong shape is a refusal. The refusal has no detail, so a programming
 * error in a read is hidden by it too; the tests call every read with hostile input to find such errors.
 */
function safe<A extends unknown[], R>(f: (...a: A) => R) {
  return (...a: A): R | Refusal => {
    try {
      return f(...a)
    } catch {
      return bad('The input is not in the shape the read expects.')
    }
  }
}

// ---- siteOutline

const names = (list: unknown) =>
  arr(list).flatMap(x =>
    isObj(x) && typeof x.name === 'string' ? [cut(x.name, NAME)] : [],
  )

/**
 * A summary of the site that fits in one reply: the header (name, languages, text range, counts, style and font names) is in
 * every page of the reply and is bounded; the paged rows are the pages, then the components with the number of instances of each.
 */
export const siteOutline = safe(function siteOutline(
  site: Head,
  options?: { cursor?: string },
): SiteOutline | Refusal {
  const h = checkHead(site)
  if (h) return h
  const o = optionsOf(options, { cursor: v => typeof v === 'string' })
  if (isRefusal(o)) return o
  const doc = site.doc as unknown as Record<string, unknown>
  const pages = arr(doc.pages).filter(isObj)
  const comps = arr(doc.components).filter(isObj)
  const styles = isObj(doc.styles) ? doc.styles : {}
  const range = styles.textRange
  const used = new Map<string, number>()
  for (const { root } of trees(site.doc))
    walk(root, rootCtx, n => {
      if (n.kind === 'instance' && typeof n.component === 'string')
        used.set(n.component, (used.get(n.component) ?? 0) + 1)
    })
  // The lists, each cut to its limit; the rest is counted. Then entries leave from the end of the longest list until the header fits.
  const lists = {
    colors: names(styles.colors),
    text: names(styles.text),
    shadows: names(styles.shadows),
    fonts: arr(doc.fonts).flatMap(f =>
      typeof f === 'string' ? [cut(f, NAME)] : [],
    ),
    languages: arr(doc.languages).flatMap(l =>
      isObj(l) && typeof l.code === 'string'
        ? [
            {
              code: cut(l.code, NAME),
              ...(l.dir === 'rtl' ? { dir: 'rtl' as const } : {}),
            },
          ]
        : [],
    ),
  }
  type Key = keyof typeof lists
  const keys = Object.keys(lists) as Key[]
  const total = Object.fromEntries(
    keys.map(k => [k, lists[k].length]),
  ) as Record<Key, number>
  const limit: Record<Key, number> = {
    colors: LISTED,
    text: LISTED,
    shadows: LISTED,
    fonts: LISTED,
    languages: LANGUAGES,
  }
  for (const k of keys) lists[k].length = Math.min(total[k], limit[k])
  const fixed = {
    name: cut(str(doc.name), SITE_NAME),
    ...(isObj(range) &&
    typeof range.min === 'number' &&
    typeof range.max === 'number'
      ? {
          textRange: {
            min: range.min,
            max: range.max,
            ...(typeof range.displayMax === 'number'
              ? { displayMax: range.displayMax }
              : {}),
          },
        }
      : {}),
    required: requiredRefs(site.doc).length,
    header: count(doc.header),
    footer: count(doc.footer),
  }
  const build = () => {
    const left = (k: Key) => total[k] - lists[k].length
    const more = {
      ...(left('colors') ? { colors: left('colors') } : {}),
      ...(left('text') ? { text: left('text') } : {}),
      ...(left('shadows') ? { shadows: left('shadows') } : {}),
    }
    return {
      ...fixed,
      languages: lists.languages as { code: string; dir?: 'rtl' }[],
      ...(left('languages') ? { languagesMore: left('languages') } : {}),
      styles: {
        colors: lists.colors as string[],
        text: lists.text as string[],
        shadows: lists.shadows as string[],
        ...(Object.keys(more).length ? { more } : {}),
      },
      fonts: lists.fonts as string[],
      ...(left('fonts') ? { fontsMore: left('fonts') } : {}),
    }
  }
  while (len(build()) > HEADER) {
    const longest = keys.reduce((a, k) =>
      len(lists[k]) > len(lists[a]) ? k : a,
    )
    if (!lists[longest].length) break
    lists[longest].pop()
  }
  const header = build()
  const rows: SiteOutline['rows'] = [
    ...pages.flatMap(p =>
      typeof p.id === 'string'
        ? [
            {
              page: cut(p.id, ID),
              title: cut(str(p.title), LABEL),
              slug: cut(str(p.slug), LABEL),
              on: p.on === true,
              nodes: count(p.root),
            },
          ]
        : [],
    ),
    ...comps.flatMap(c =>
      typeof c.id === 'string'
        ? [
            {
              component: cut(c.id, ID),
              name: cut(str(c.name), LABEL),
              uses: used.get(c.id) ?? 0,
            },
          ]
        : [],
    ),
  ]
  return capped(
    paged(
      rows,
      site.revision,
      o.cursor as string | undefined,
      tagOf('siteOutline'),
      (page, cutIt, cursor) => ({
        ok: true as const,
        revision: site.revision,
        cut: cutIt,
        ...(cursor ? { cursor } : {}),
        ...header,
        rows: page,
      }),
    ) as SiteOutline | Refusal,
  )
})

// ---- pageOutline

/**
 * One row per node in depth-first document order. `depth` counts from the outlined root (0 is the root alone), `from` outlines the
 * subtree of that node. `hidden` lists the layouts where the node's own `hide` is set.
 */
export const pageOutline = safe(function pageOutline(
  site: Head,
  tree: TreeRef,
  options?: { depth?: number; from?: string; cursor?: string },
): PageOutline | Refusal {
  const h = checkHead(site)
  if (h) return h
  const o = optionsOf(options, {
    depth: v => Number.isSafeInteger(v) && (v as number) >= 0,
    from: v => typeof v === 'string',
    cursor: v => typeof v === 'string',
  })
  if (isRefusal(o)) return o
  const root = rootFor(site.doc, tree)
  if (isRefusal(root)) return root
  let start: { node: Node; ctx: Ctx } | undefined = { node: root, ctx: rootCtx }
  if (o.from !== undefined) {
    start = undefined
    walk(root, rootCtx, (n, c) => {
      if (!start && n.id === o.from) start = { node: n, ctx: c }
      return !start
    })
    if (!start)
      return bad('No such node.', { path: 'from', nodeId: String(o.from) })
  }
  const found = start as { node: Node; ctx: Ctx }
  const rows: OutlineRow[] = []
  const base = found.ctx.depth
  walk(found.node, { ...found.ctx, block: undefined }, (n, c) => {
    const own =
      isObj(n.origin) && typeof n.origin.block === 'string'
        ? n.origin.block
        : undefined
    const preview = cut(textOf(n, PREVIEW), PREVIEW)
    const name = cut(str(n.name), LABEL)
    const label = (KINDS as Record<string, { label?: string } | undefined>)[
      str(n.kind)
    ]?.label
    const hidden = LAYOUTS.filter(l => isObj(n.hide) && n.hide[l] === true)
    const kids = arr(n.children).filter(isNode).length
    rows.push({
      id: cut(n.id, ID),
      kind: cut(str(n.kind), LABEL),
      depth: c.depth - base,
      ...(name !== cut(n.id, ID) && name !== label && name !== ''
        ? { name }
        : {}),
      ...(hidden.length ? { hidden } : {}),
      ...(own ? { block: own } : {}),
      ...(isRequired(n, c.form) ? { required: true as const } : {}),
      ...(preview ? { text: preview } : {}),
      ...(kids ? { children: kids } : {}),
    })
    return o.depth === undefined || c.depth - base < (o.depth as number)
  })
  return capped(
    paged(
      rows,
      site.revision,
      o.cursor as string | undefined,
      tagOf('pageOutline', tree, o.from ?? null, o.depth ?? null),
      (page, cutIt, cursor) => ({
        ok: true as const,
        revision: site.revision,
        cut: cutIt,
        ...(cursor ? { cursor } : {}),
        rows: page,
      }),
    ) as PageOutline | Refusal,
  )
})

// ---- search

/**
 * Nodes that match every given condition, in the order header, footer, pages, components, each in document order. `text` is a
 * case-insensitive substring of the node's whole text or of its name; `kind` is exact; `block` is exact and matches the node's
 * block of origin: the block root (its `origin.block`) and every node below it, down to a nested block root of another block.
 * A row shows the first 80 characters of the text. In an invalid document an id longer than 200 characters is cut in a row (also the
 * page or component id of its `tree`), so one such id cannot make a reply too big to return.
 */
export const search = safe(function search(
  site: Head,
  query: SearchQuery,
): SearchResult | Refusal {
  const h = checkHead(site)
  if (h) return h
  if (!isObj(query))
    return bad('The query must be an object.', { path: 'query' })
  const q: Record<string, unknown> = query
  for (const k of ['text', 'kind', 'block', 'cursor'])
    if (q[k] !== undefined && typeof q[k] !== 'string')
      return bad(`"${k}" must be a string.`, { path: k })
  if (!query.text && !query.kind && !query.block)
    return bad('Give at least one of text, kind and block.', { path: 'query' })
  const needle = query.text?.toLowerCase()
  const rows: SearchResult['rows'] = []
  for (const { tree, root } of trees(site.doc))
    walk(root, rootCtx, (n, c) => {
      if (query.kind !== undefined && n.kind !== query.kind) return
      if (query.block !== undefined && c.block !== query.block) return
      const full = textOf(n)
      if (
        needle &&
        !full.toLowerCase().includes(needle) &&
        !str(n.name).toLowerCase().includes(needle)
      )
        return
      const preview = cut(full, PREVIEW)
      rows.push({
        tree: shortTree(tree),
        id: cut(n.id, ID),
        kind: cut(str(n.kind), LABEL),
        ...(preview ? { text: preview } : {}),
      })
    })
  return capped(
    paged(
      rows,
      site.revision,
      query.cursor,
      tagOf(
        'search',
        query.text ?? null,
        query.kind ?? null,
        query.block ?? null,
      ),
      (page, cutIt, cursor) => ({
        ok: true as const,
        revision: site.revision,
        cut: cutIt,
        ...(cursor ? { cursor } : {}),
        rows: page,
      }),
    ) as SearchResult | Refusal,
  )
})

// ---- readNode

type Cuts = string[]
/**
 * A copy of `v` in which every string longer than FIELD (serialised) is cut; the dotted path of each cut is added to `cuts`.
 * A value nested deeper than 64 levels is returned as it is, uncut: the size budget of the fixed part replaces a field that is still too big by a marker.
 */
function clip(v: unknown, path: string, cuts: Cuts, depth = 0): unknown {
  if (typeof v === 'string') {
    const c = cut(v, FIELD)
    if (c !== v) cuts.push(path)
    return c
  }
  if (typeof v !== 'object' || v === null || depth > 64) return v
  if (Array.isArray(v))
    return v.map((x, i) => clip(x, `${path}.${i}`, cuts, depth + 1))
  return Object.fromEntries(
    Object.entries(v).map(([k, x]) => [
      k,
      clip(x, `${path}.${k}`, cuts, depth + 1),
    ]),
  )
}

/** The style layers that hold something. */
function layersOf(style: unknown): Record<string, unknown> | undefined {
  if (!isObj(style)) return undefined
  const out: Record<string, unknown> = {}
  for (const k of STATES) {
    const d = style[k]
    if (isObj(d) && Object.keys(d).length) out[k] = d
  }
  if (Array.isArray(style.when) && style.when.length) out.when = style.when
  return Object.keys(out).length ? out : undefined
}

/**
 * Replaces the largest fields of `o` with markers, largest first, until `total` (the serialised length of what `o` is part of)
 * is at most `budget`. Each field is measured once and `total` is kept as a running sum. Returns the keys replaced and the new total.
 */
function shrink(
  o: Record<string, unknown>,
  skip: (k: string) => boolean,
  total: number,
  budget: number,
): { keys: string[]; total: number } {
  const sized = Object.keys(o)
    .filter(k => !skip(k))
    .map(k => ({ k, n: len(o[k]) }))
    .sort((a, b) => b.n - a.n)
  const keys: string[] = []
  for (const { k, n } of sized) {
    if (total <= budget) break
    const m = marker(o[k])
    const gain = n - len(m)
    if (gain <= 0) break // the rest are smaller still
    o[k] = m
    total -= gain
    keys.push(k)
  }
  return { keys, total }
}

/** `"<revision>:<run>:<char>:<tag>"`, the tag being `tagOf` of the read's name, the tree and the id of the node. */
function runCursor(
  cursor: string,
  revision: number,
  tag: string,
  runs: unknown[],
): { run: number; char: number } | Refusal {
  const m = /^(\d+):(\d+):(\d+):([0-9a-z]+)$/.exec(cursor)
  const [rev, run, char] = m ? [m[1], m[2], m[3]].map(Number) : []
  if (!m || ![rev, run, char].every(Number.isSafeInteger))
    return bad('Cursor must be "<revision>:<run>:<char>:<tag>".', {
      path: 'cursor',
    })
  if (m[4] !== tag) return bad(FOREIGN_CURSOR, { path: 'cursor' })
  if (rev !== revision)
    return refuse(
      'REVISION_CONFLICT',
      `The cursor was made for revision ${rev}, not ${revision}.`,
      { path: 'cursor' },
    )
  const r = runs[run]
  const t = isObj(r) && typeof r.text === 'string' ? r.text.length : 0
  if (run >= runs.length || char > t || (char > 0 && char === t))
    return bad('The cursor is past the end.', { path: 'cursor' })
  return { run, char }
}

/**
 * A node without its children (their ids instead) and with only the style layers that hold something, plus, for a block's root,
 * `settings` when a registry is given.
 *
 * Every reply carries the node's other fields, so any page alone is usable, and one page of `props.runs`. The runs are paged: a run
 * is returned whole while it fits; one that does not fit whole is deferred to the next page unless it could not fit a page of its
 * own, and is then cut by characters, the next page continuing it (same fields, the next slice of `text`). The cursor is
 * `"<revision>:<run>:<char>:<tag>"`; the tag binds it to this node, so the cursor of another node is refused.
 *
 * Every bound is a serialised length. A string longer than 2,000 anywhere but a run's `text` is cut and its dotted path listed in
 * `cutFields` (at most 50 paths of at most 80, `moreCut` counts the rest). If the node without its runs (with `settings`) is still
 * over half the cap, its largest fields (a top-level field, one key of `props`, or `settings`) are replaced by `{ cut: <length> }`,
 * largest first, and listed too; `props` as a whole, then the whole node but `id` and `kind`, are the last resorts. When `props` is replaced, the runs of the reply still come, beside the marker: `props` is then `{ cut, runs }`. A run without
 * its `text` is held to 2,000 the same way (`props.runs.<i>.<field>`), so a page always has room for text. A field that was cut is
 * not available through a read; a cut `children` is recovered with `pageOutline` and `from`.
 */
export const readNode = safe(function readNode(
  site: Head,
  tree: TreeRef,
  id: string,
  options?: { cursor?: string },
  registry?: Registry,
): NodeRead | Refusal {
  const h = checkHead(site)
  if (h) return h
  const o = optionsOf(options, { cursor: v => typeof v === 'string' })
  if (isRefusal(o)) return o
  const root = rootFor(site.doc, tree)
  if (isRefusal(root)) return root
  if (typeof id !== 'string')
    return bad('The id must be a string.', { path: 'id' })
  let node: Node | undefined
  walk(root, rootCtx, n => {
    if (!node && n.id === id) node = n
    return !node
  })
  if (!node) return bad('No such node.', { path: 'id', nodeId: id })
  const found: Node = node
  const cuts: Cuts = []

  const props = isObj(found.props) ? found.props : undefined
  const rawRuns =
    props && Array.isArray(props.runs) ? (props.runs as unknown[]) : undefined
  const runs = rawRuns?.map((r, i) => {
    const at = `props.runs.${i}`
    if (!isObj(r)) {
      const v = clip(r, at, cuts)
      if (len(v) <= SKELETON) return v
      cuts.push(at)
      return marker(v)
    }
    // A `text` that is not a string is no text to page: it stays a field of the skeleton and is cut like one.
    const { text: t, ...rest } =
      typeof r.text === 'string' ? r : { ...r, text: undefined }
    const skeleton = clip(
      typeof r.text === 'string' ? rest : r,
      at,
      cuts,
    ) as Record<string, unknown>
    const total = len(skeleton)
    if (total > SKELETON) {
      const s = shrink(skeleton, () => false, total, SKELETON)
      for (const k of s.keys) cuts.push(`${at}.${k}`)
      if (s.total > SKELETON) {
        // Too many small fields: keep the text, give up the rest.
        cuts.push(at)
        return { ...(typeof t === 'string' ? { text: t } : {}), cut: total }
      }
    }
    return typeof t === 'string' ? { ...skeleton, text: t } : skeleton
  })

  const body: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(found)) {
    if (k === 'children')
      body.children = arr(v)
        .filter(isNode)
        .map(c => c.id)
    else if (k === 'style') {
      const s = layersOf(v)
      if (s) body.style = clip(s, 'style', cuts)
    } else if (k === 'props') {
      if (props)
        body.props = clip(
          Object.fromEntries(
            Object.entries(props).filter(([p]) => p !== 'runs' || !rawRuns),
          ),
          'props',
          cuts,
        )
    } else if (k === 'id' || k === 'kind') {
      const c = typeof v === 'string' ? cut(v, ID) : v
      if (c !== v) cuts.push(k)
      body[k] = c
    } else body[k] = clip(v, k, cuts)
  }
  if (body.children === undefined && 'children' in found) body.children = []
  const fixed: { node: Record<string, unknown>; settings?: unknown } = {
    node: body,
  }
  if (registry && isObj(found.origin))
    fixed.settings = clip(readSettings(registry, found), 'settings', cuts)

  // Keep the fixed part under half the cap, measuring each field once.
  let total = len(fixed)
  if (total > NODE_BUDGET) {
    const p = isObj(body.props) ? body.props : undefined
    const slots = [
      ...Object.keys(body)
        .filter(k => k !== 'id' && k !== 'kind' && k !== 'props')
        .map(k => ({ path: k, host: body, key: k })),
      ...Object.keys(p ?? {}).map(k => ({
        path: `props.${k}`,
        host: p!,
        key: k,
      })),
      ...(fixed.settings === undefined
        ? []
        : [
            {
              path: 'settings',
              host: fixed as Record<string, unknown>,
              key: 'settings',
            },
          ]),
    ]
      .map(s => ({ ...s, n: len(s.host[s.key]) }))
      .sort((a, b) => b.n - a.n)
    for (const s of slots) {
      if (total <= NODE_BUDGET) break
      const m = marker(s.host[s.key])
      const gain = s.n - len(m)
      if (gain <= 0) break
      s.host[s.key] = m
      total -= gain
      cuts.push(s.path)
    }
    if (total > NODE_BUDGET && p) {
      body.props = marker(p)
      cuts.push('props')
      total = len(fixed)
    }
    if (total > NODE_BUDGET) {
      fixed.node = { id: body.id, kind: body.kind }
      delete fixed.settings
      cuts.push('*')
    }
  }

  const note = {
    ...(cuts.length
      ? { cutFields: cuts.slice(0, CUT_LISTED).map(p => cut(p, CUT_PATH)) }
      : {}),
    ...(cuts.length > CUT_LISTED ? { moreCut: cuts.length - CUT_LISTED } : {}),
  }
  const withRuns = (page: unknown[] | undefined): Record<string, unknown> =>
    page === undefined
      ? fixed.node
      : {
          ...fixed.node,
          props: {
            ...(isObj(fixed.node.props) ? fixed.node.props : {}),
            runs: page,
          },
        }
  const reply = (
    page: unknown[] | undefined,
    cutIt: boolean,
    cursor?: string,
  ): NodeRead => ({
    ok: true,
    revision: site.revision,
    cut: cutIt,
    ...(cursor ? { cursor } : {}),
    node: withRuns(page),
    ...(fixed.settings === undefined
      ? {}
      : { settings: fixed.settings as NodeRead['settings'] }),
    ...note,
  })
  if (!runs) {
    if (o.cursor !== undefined)
      return bad('This node has no runs to continue.', { path: 'cursor' })
    return capped(reply(undefined, false))
  }

  const tag = tagOf('readNode', tree, id)
  let i = 0
  let c = 0
  if (o.cursor !== undefined) {
    const at = runCursor(o.cursor as string, site.revision, tag, runs)
    if (isRefusal(at)) return at
    ;({ run: i, char: c } = at)
  }
  const textOfRun = (r: unknown) =>
    isObj(r) && typeof r.text === 'string' ? r.text : undefined
  const longest = runs.reduce<number>(
    (m, r) => Math.max(m, textOfRun(r)?.length ?? 0),
    0,
  )
  // The reply with no runs and the longest cursor is the least room any reply has.
  const room =
    READ_CAP -
    len(reply([], true, `${site.revision}:${runs.length}:${longest}:${tag}`))
  let left = room
  const page: unknown[] = []
  while (i < runs.length) {
    const run = runs[i]
    const txt = textOfRun(run)
    const piece = c > 0 ? { ...(run as object), text: txt!.slice(c) } : run
    const n = len(piece) + 1
    if (n <= left) {
      page.push(piece)
      left -= n
      i++
      c = 0
      continue
    }
    if (page.length && n <= room) break // fits a page of its own: the next one
    if (!txt || c >= txt.length) {
      // Nothing to cut. It is at most a skeleton, so this is only reached when the room is already gone.
      if (!page.length) {
        page.push(piece)
        i++
        c = 0
      }
      break
    }
    const rest = txt.slice(c)
    const fit = (p: number) =>
      len({ ...(run as object), text: rest.slice(0, p) }) + 1 <= left
    let lo = 0
    let hi = rest.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (fit(mid)) lo = mid
      else hi = mid - 1
    }
    let p = lo
    if (p === 0 && page.length) break
    if (p === 0) p = 1
    const last = rest.charCodeAt(p - 1)
    if (last >= 0xd800 && last <= 0xdbff && p < rest.length)
      p = p > 1 ? p - 1 : p + 1
    page.push({ ...(run as object), text: rest.slice(0, p) })
    c += p
    break
  }
  const more = i < runs.length
  return capped(
    reply(page, more, more ? `${site.revision}:${i}:${c}:${tag}` : undefined),
  )
})
