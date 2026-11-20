import type {
  Layout,
  Node,
  Problem,
  PropValue,
  SiteDocument,
} from '../document/index.ts'
import { STATES } from '../document/layers.ts'
import { isRequired, requiredRefs } from '../document/required.ts'
import { readSettings } from '../registry/block.ts'
import type { Registry } from '../registry/index.ts'
import { READ_CAP, paged } from './cap.ts'
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
  textRange?: { min: number; max: number }
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
export type OutlineRow = {
  id: string
  kind: string
  name: string
  parent: string | null
  index: number
  hidden: Layout[]
  block?: string
  required: boolean
  text?: string
  children: number
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
  /** Dotted paths of the fields that were cut or replaced by `{ cut: <characters> }`. */
  cutFields?: string[]
  cutFieldsMore?: number
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

// ---- limits (every row and every header field is bounded; `paged` always takes one row)
/** Characters of a node's text shown in a row. */
const PREVIEW = 80
/** Characters of a name, title or slug in a row. */
const LABEL = 80
/** Characters of the site's name in the header of `siteOutline`. */
const SITE_NAME = 200
/** Characters of a style or font name in the header. */
const NAME = 32
/** Names listed per style list and fonts listed; the rest is counted. */
const LISTED = 50
/** Languages listed. */
const LANGUAGES = 20
/** A string of `readNode` longer than this is cut. */
const FIELD = 2000
/** The node of `readNode`, without its runs, may be this long. */
const NODE_BUDGET = READ_CAP / 2
/** Paths listed in `cutFields`, and their length. */
const CUT_LISTED = 50
const CUT_PATH = 100

const LAYOUTS: readonly Layout[] = ['desktop', 'tablet', 'phone']
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const isNode = (v: unknown): v is Node => isObj(v) && typeof v.id === 'string'
const str = (v: unknown) => (typeof v === 'string' ? v : '')

/** The first `n` characters, never ending inside a surrogate pair. */
function cut(s: string, n: number): string {
  if (s.length <= n) return s
  const c = s.charCodeAt(n - 1)
  return s.slice(0, c >= 0xd800 && c <= 0xdbff ? n - 1 : n)
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

/** No read throws: whatever goes wrong inside on input of the wrong shape is a refusal. */
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

const names = (list: unknown, n = LISTED) => {
  const all = arr(list).flatMap(x =>
    isObj(x) && typeof x.name === 'string' ? [cut(x.name, NAME)] : [],
  )
  return { listed: all.slice(0, n), more: Math.max(0, all.length - n) }
}

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
  const colors = names(styles.colors)
  const text = names(styles.text)
  const shadows = names(styles.shadows)
  const fonts = arr(doc.fonts).filter((f): f is string => typeof f === 'string')
  const langs = arr(doc.languages).flatMap(l =>
    isObj(l) && typeof l.code === 'string'
      ? [
          {
            code: cut(l.code, NAME),
            ...(l.dir === 'rtl' ? { dir: 'rtl' as const } : {}),
          },
        ]
      : [],
  )
  const more = {
    ...(colors.more ? { colors: colors.more } : {}),
    ...(text.more ? { text: text.more } : {}),
    ...(shadows.more ? { shadows: shadows.more } : {}),
  }
  const header = {
    name: cut(str(doc.name), SITE_NAME),
    languages: langs.slice(0, LANGUAGES),
    ...(langs.length > LANGUAGES
      ? { languagesMore: langs.length - LANGUAGES }
      : {}),
    ...(isObj(range) &&
    typeof range.min === 'number' &&
    typeof range.max === 'number'
      ? { textRange: { min: range.min, max: range.max } }
      : {}),
    required: requiredRefs(site.doc).length,
    header: count(doc.header),
    footer: count(doc.footer),
    styles: {
      colors: colors.listed,
      text: text.listed,
      shadows: shadows.listed,
      ...(Object.keys(more).length ? { more } : {}),
    },
    fonts: fonts.slice(0, LISTED).map(f => cut(f, NAME)),
    ...(fonts.length > LISTED ? { fontsMore: fonts.length - LISTED } : {}),
  }
  const rows: SiteOutline['rows'] = [
    ...pages.flatMap(p =>
      typeof p.id === 'string'
        ? [
            {
              page: p.id,
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
              component: c.id,
              name: cut(str(c.name), LABEL),
              uses: used.get(c.id) ?? 0,
            },
          ]
        : [],
    ),
  ]
  return paged(
    rows,
    site.revision,
    o.cursor as string | undefined,
    (page, cutIt, cursor) => ({
      ok: true as const,
      revision: site.revision,
      cut: cutIt,
      ...(cursor ? { cursor } : {}),
      ...header,
      rows: page,
    }),
  ) as SiteOutline | Refusal
})

// ---- pageOutline

/**
 * One row per node in depth-first document order. `depth` counts from the outlined root (0 is the root alone), `from` outlines the
 * subtree of that node (its `parent` and `index` are the real ones). `hidden` lists the layouts where the node's own `hide` is set.
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
    rows.push({
      id: n.id,
      kind: str(n.kind),
      name: cut(str(n.name), LABEL),
      parent: c.parent,
      index: c.index,
      hidden: LAYOUTS.filter(l => isObj(n.hide) && n.hide[l] === true),
      ...(own ? { block: own } : {}),
      required: isRequired(n, c.form),
      ...(preview ? { text: preview } : {}),
      children: arr(n.children).filter(isNode).length,
    })
    return o.depth === undefined || c.depth - base < (o.depth as number)
  })
  return paged(
    rows,
    site.revision,
    o.cursor as string | undefined,
    (page, cutIt, cursor) => ({
      ok: true as const,
      revision: site.revision,
      cut: cutIt,
      ...(cursor ? { cursor } : {}),
      rows: page,
    }),
  ) as PageOutline | Refusal
})

// ---- search

/**
 * Nodes that match every given condition, in the order header, footer, pages, components, each in document order. `text` is a
 * case-insensitive substring of the node's whole text or of its name; `kind` is exact; `block` is exact and matches the node's
 * block of origin: the block root (its `origin.block`) and every node below it, down to a nested block root of another block.
 * A row shows the first 80 characters of the text.
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
        tree,
        id: n.id,
        kind: str(n.kind),
        ...(preview ? { text: preview } : {}),
      })
    })
  return paged(rows, site.revision, query.cursor, (page, cutIt, cursor) => ({
    ok: true as const,
    revision: site.revision,
    cut: cutIt,
    ...(cursor ? { cursor } : {}),
    rows: page,
  })) as SearchResult | Refusal
})

// ---- readNode

type Cuts = string[]
/** A copy of `v` in which every string longer than FIELD is cut; the dotted path of each cut is added to `cuts`. */
function clip(v: unknown, path: string, cuts: Cuts, depth = 0): unknown {
  if (typeof v === 'string') {
    if (v.length <= FIELD) return v
    cuts.push(path)
    return cut(v, FIELD)
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

const len = (v: unknown) => JSON.stringify(v)?.length ?? 0

/** `"<revision>:<run>:<char>"`. */
function runCursor(
  cursor: string,
  revision: number,
  runs: unknown[],
): { run: number; char: number } | Refusal {
  const m = /^(\d+):(\d+):(\d+)$/.exec(cursor)
  const [rev, run, char] = m ? [m[1], m[2], m[3]].map(Number) : []
  if (!m || ![rev, run, char].every(Number.isSafeInteger))
    return bad('Cursor must be "<revision>:<run>:<char>".', { path: 'cursor' })
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
 * `"<revision>:<run>:<char>"`.
 *
 * The rest is bounded: a string longer than 2,000 characters anywhere but a run's `text` is cut to 2,000 and its dotted path listed
 * in `cutFields`; if the node without its runs is still longer than half the cap, its largest fields (a top-level field, or one
 * key of `props`, or `settings`) are replaced one by one by `{ cut: <characters> }` and listed too, until it fits.
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
  const rawRuns = props && Array.isArray(props.runs) ? props.runs : undefined
  const runs = rawRuns?.map((r, i) =>
    isObj(r)
      ? Object.fromEntries(
          Object.entries(r).map(([k, v]) => [
            k,
            k === 'text' && typeof v === 'string'
              ? v
              : clip(v, `props.runs.${i}.${k}`, cuts),
          ]),
        )
      : clip(r, `props.runs.${i}`, cuts),
  )
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
    } else body[k] = clip(v, k, cuts)
  }
  if (body.children === undefined && 'children' in found) body.children = []
  let settings: Record<string, unknown> | undefined
  if (registry && isObj(found.origin))
    settings = clip(
      readSettings(registry, found),
      'settings',
      cuts,
    ) as typeof settings

  // Keep the fixed part of every reply under half the cap.
  const marked = (v: unknown) => isObj(v) && Object.keys(v).join() === 'cut'
  const fixed = { node: body, ...(settings ? { settings } : {}) }
  const cutNote = () => ({
    ...(cuts.length
      ? { cutFields: cuts.slice(0, CUT_LISTED).map(p => cut(p, CUT_PATH)) }
      : {}),
    ...(cuts.length > CUT_LISTED
      ? { cutFieldsMore: cuts.length - CUT_LISTED }
      : {}),
  })
  if (len({ ...fixed, ...cutNote() }) > NODE_BUDGET) {
    type Slot = { path: string; get: () => unknown; set: (v: unknown) => void }
    const slots: Slot[] = []
    for (const k of Object.keys(body))
      if (k === 'props' && isObj(body.props)) {
        const p = body.props
        for (const pk of Object.keys(p))
          slots.push({
            path: `props.${pk}`,
            get: () => p[pk],
            set: v => void (p[pk] = v),
          })
      } else if (k !== 'id' && k !== 'kind')
        slots.push({
          path: k,
          get: () => body[k],
          set: v => void (body[k] = v),
        })
    if (settings)
      slots.push({
        path: 'settings',
        get: () => fixed.settings,
        set: v => void (fixed.settings = v as typeof settings),
      })
    const sized = slots
      .map(s => ({ s, n: len(s.get()) }))
      .sort((a, b) => b.n - a.n)
    for (const { s, n } of sized) {
      if (len({ ...fixed, ...cutNote() }) <= NODE_BUDGET) break
      if (marked(s.get())) continue
      s.set({ cut: n })
      cuts.push(s.path)
    }
  }

  const note = cutNote()
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
    ...(fixed.settings
      ? { settings: fixed.settings as NodeRead['settings'] }
      : {}),
    ...note,
  })
  if (!runs) {
    if (o.cursor !== undefined)
      return bad('This node has no runs to continue.', { path: 'cursor' })
    return reply(undefined, false)
  }

  let i = 0
  let c = 0
  if (o.cursor !== undefined) {
    const at = runCursor(o.cursor as string, site.revision, runs)
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
    len(reply([], true, `${site.revision}:${runs.length}:${longest}`))
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
    if (txt === undefined) {
      // not splittable: take it if the page is empty, so there is progress
      if (!page.length) {
        page.push(piece)
        i++
      }
      break
    }
    if (page.length && n <= room) break // fits a page of its own: the next one
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
    if (last >= 0xd800 && last <= 0xdbff) p = p > 1 ? p - 1 : p + 1
    page.push({ ...(run as object), text: rest.slice(0, p) })
    c += p
    break
  }
  const more = i < runs.length
  return reply(page, more, more ? `${site.revision}:${i}:${c}` : undefined)
})
