import { posix } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { findNodeAtLocation, parseTree, type ParseError } from 'jsonc-parser'
import {
  applySetting,
  defaultSiteStyles,
  insertBlock,
  kindSpec,
  readSettings,
} from '@culmjs/core'
import type { Node, Note, Page, Registry, SiteDocument } from '@culmjs/core'
import { derivedId } from './ids.ts'
import { editFile, parseFile, removeAt, type JsonPath } from './jsonc.ts'
import { defaultSlot, type Loaded } from './load.ts'
import type { Located } from './plugins.ts'
import { isObj } from '../shared.ts'

type Raw = Record<string, unknown>
/** The value as JSON holds it: no `undefined`, no key order that matters. */
const norm = (v: unknown): unknown =>
  v === undefined ? undefined : JSON.parse(JSON.stringify(v))
const eq = (a: unknown, b: unknown) => isDeepStrictEqual(norm(a), norm(b))
const omit = (o: object, ...keys: string[]): Raw =>
  Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)))
const strip = (n: Node): Raw => omit(n, 'children')

/** A short form's tree, as the loader builds it. */
function simulate(
  registry: Registry,
  raw: Raw,
  id: string,
  parentKind: string | undefined,
): Node | undefined {
  const block = registry.block(String(raw.block))
  const look = typeof raw.look === 'string' ? raw.look : block?.looks[0]?.id
  const made = insertBlock(registry, String(raw.block), look ?? '', id)
  if (!made.ok) return undefined
  let root = made.root
  for (const [k, v] of Object.entries(raw)) {
    if (k === 'block' || k === 'look' || k === 'id') continue
    const r = applySetting(registry, root, k, v as never)
    if (!r.ok) return undefined
    root = r.root
  }
  root.slot = defaultSlot(parentKind)
  return root
}

const at = (value: unknown, path: JsonPath): unknown => {
  let v = value
  for (const s of path) {
    if (typeof v !== 'object' || v === null) return undefined
    v = (v as Record<string | number, unknown>)[s]
  }
  return v
}

/**
 * Rewrites one short form as nodes: the tree the loader makes from it, with every id written. The rest of the file is untouched.
 * `file` only feeds the derived id of a short form that has no `id`. Returns undefined when there is no short form at `path`
 * or the edit cannot be made.
 */
export function expandShortForm(
  text: string,
  path: JsonPath,
  registry: Registry,
  file = '',
): string | undefined {
  const parsed = parseFile(text)
  if (parsed.errors.length) return undefined
  const raw = at(parsed.value, path)
  if (!isObj(raw) || typeof raw.block !== 'string') return undefined
  const up =
    path.length >= 2 && path[path.length - 2] === 'children'
      ? at(parsed.value, path.slice(0, -2))
      : undefined
  const id =
    typeof raw.id === 'string' && raw.id ? raw.id : derivedId(file, path)
  const tree = simulate(
    registry,
    raw,
    id,
    isObj(up) && typeof up.kind === 'string' ? up.kind : undefined,
  )
  return tree ? editFile(text, path, norm(tree)) : undefined
}

const indentOf = (text: string) => {
  const m = /^([ \t]+)(?![*]|\/[/*])\S/m.exec(text)
  return m ? (m[1]!.startsWith('\t') ? '\t' : m[1]!.length) : 2
}
const whole = (value: unknown, like: string) => {
  const eol = like.includes('\r\n') ? '\r\n' : '\n'
  return JSON.stringify(value, null, indentOf(like)).replace(/\n/g, eol) + eol
}

export type FileEdits = {
  write: Record<string, string>
  remove: string[]
  notes: Note[]
  /** An edit that could not be made. When there is one, `write`, `remove` and `notes` are empty. */
  problems: Located[]
}

/**
 * The files that hold `after` where they held `before`, edited in place: comments, key order, line endings and indentation of
 * every untouched part stay. A new page or piece is written whole; a removed one is in `remove`.
 * ponytail: a node that moves is rewritten from the document, so comments inside it are lost.
 */
export function fileEdits(
  before: SiteDocument,
  after: SiteDocument,
  loaded: Loaded,
  registry: Registry,
): FileEdits {
  const orig = new Map(loaded.files.map(f => [f.path, f.text]))
  const texts = new Map(orig)
  const removed = new Set<string>()
  const notes: Note[] = []
  const problems: Located[] = []
  const poisoned = new Set<string>()
  const map = loaded.map

  const bad = (file: string, path: JsonPath, message: string) => {
    if (poisoned.has(file)) return
    poisoned.add(file)
    const t = texts.get(file)
    let place: { line: number; column: number } | undefined
    if (t) {
      const p = parseFile(t)
      for (let n = path.length; n >= 0 && !place; n--)
        place = p.at(path.slice(0, n))
    }
    problems.push({
      code: 'INVALID_OPERATION',
      message,
      file,
      line: place?.line ?? 1,
      column: place?.column ?? 1,
    })
  }
  const rawAt = (file: string, path: JsonPath): unknown => {
    const t = texts.get(file)
    if (t === undefined) return undefined
    const p = parseFile(t)
    return p.errors.length ? undefined : at(p.value, path)
  }
  const put = (
    file: string,
    path: JsonPath,
    value: unknown,
    insert = false,
  ) => {
    if (poisoned.has(file)) return
    const t = texts.get(file)
    const n =
      t === undefined ? undefined : editFile(t, path, norm(value), { insert })
    if (n === undefined)
      bad(file, path, `${file} cannot take a change at ${path.join('.')}.`)
    else texts.set(file, n)
  }
  const drop = (file: string, path: JsonPath) => {
    if (poisoned.has(file)) return
    const t = texts.get(file)
    const n = t === undefined ? undefined : removeAt(t, path)
    if (n === undefined)
      bad(file, path, `${file} has nothing to remove at ${path.join('.')}.`)
    else texts.set(file, n)
  }

  /** Edits the JSON at `path` from `a` to `b`, one leaf at a time. */
  function sync(file: string, path: JsonPath, a: unknown, b: unknown): void {
    a = norm(a)
    b = norm(b)
    if (isDeepStrictEqual(a, b)) return
    if (isObj(a) && isObj(b)) {
      for (const k of Object.keys(a)) if (!(k in b)) drop(file, [...path, k])
      for (const k of Object.keys(b))
        if (!(k in a)) put(file, [...path, k], b[k])
        else sync(file, [...path, k], a[k], b[k])
    } else if (Array.isArray(a) && Array.isArray(b)) {
      const n = Math.min(a.length, b.length)
      for (let i = 0; i < n; i++) sync(file, [...path, i], a[i], b[i])
      for (let i = a.length - 1; i >= n; i--) drop(file, [...path, i])
      for (let i = n; i < b.length; i++) put(file, [...path, i], b[i])
    } else put(file, path, b)
  }

  /**
   * The text of the list element at `path`, and the comment on its line after it; the whole-line comments above it (`//` lines and
   * a `/* ... *\/` block) are cut out of the file and returned with the element. The element itself stays for `drop`.
   * Undefined when the text cannot be sliced; the caller then re-serialises the value.
   */
  function cutOut(
    file: string,
    path: JsonPath,
  ): { slice: string; tail: string } | undefined {
    const whole = texts.get(file)
    if (whole === undefined || poisoned.has(file)) return undefined
    const bom = whole.startsWith('\uFEFF') ? '\uFEFF' : ''
    const t = whole.slice(bom.length)
    const errs: ParseError[] = []
    const tree = parseTree(t, errs, { allowTrailingComma: true })
    const node =
      !errs.length && tree ? findNodeAtLocation(tree, path) : undefined
    if (!node) return undefined
    const end = node.offset + node.length
    const tail = /^[ \t]*,?[ \t]*(\/\/[^\r\n]*)/.exec(t.slice(end))?.[1]
    const lineStart = t.lastIndexOf('\n', node.offset - 1) + 1
    let from = node.offset
    if (/^[ \t]*$/.test(t.slice(lineStart, node.offset))) {
      let ls = lineStart
      while (ls > 0) {
        const ps = t.lastIndexOf('\n', ls - 2) + 1
        const line = t.slice(ps, ls)
        if (/^\s*\/\//.test(line)) ls = ps
        else if (/\*\/\s*$/.test(line)) {
          const close = ps + line.lastIndexOf('*/')
          const open = t.lastIndexOf('/*', close)
          const os = t.lastIndexOf('\n', open - 1) + 1
          if (open < 0 || !/^[ \t]*$/.test(t.slice(os, open))) break
          ls = os
        } else break
      }
      if (ls < lineStart) {
        from = ls + /^[ \t]*/.exec(t.slice(ls))![0].length
        texts.set(file, bom + t.slice(0, ls) + t.slice(lineStart))
      }
    }
    return { slice: t.slice(from, end), tail: tail ? ' ' + tail : '' }
  }

  /** Positions of one longest increasing run of `xs`: the elements of a list that need not move. */
  const stay = (xs: number[]): Set<number> => {
    const tails: number[] = []
    const prev: number[] = []
    xs.forEach((v, i) => {
      let lo = 0
      let hi = tails.length
      while (lo < hi) {
        const m = (lo + hi) >> 1
        if (xs[tails[m]!]! < v) lo = m + 1
        else hi = m
      }
      prev[i] = lo ? tails[lo - 1]! : -1
      tails[lo] = i
    })
    const keep = new Set<number>()
    for (
      let i = tails.length ? tails[tails.length - 1]! : -1;
      i >= 0;
      i = prev[i]!
    )
      keep.add(i)
    return keep
  }

  /**
   * Makes the list at `path` hold `aKeys` in order: removes, inserts, and moves only the elements outside one longest run that keeps
   * its order. A moved element goes as its own text with its comments above it, so nothing in it or beside it is rewritten.
   */
  function seq(
    file: string,
    path: JsonPath,
    bKeys: string[],
    aKeys: string[],
    make: (key: string) => unknown,
  ): void {
    for (let j = bKeys.length - 1; j >= 0; j--)
      if (!aKeys.includes(bKeys[j]!)) drop(file, [...path, j])
    const cur = bKeys.filter(k => aKeys.includes(k))
    const keep = stay(cur.map(k => aKeys.indexOf(k)))
    const moved = new Map<
      string,
      { cut?: { slice: string; tail: string }; value: unknown }
    >()
    for (let m = cur.length - 1; m >= 0; m--) {
      if (keep.has(m)) continue
      const value = rawAt(file, [...path, m])
      moved.set(cur[m]!, { value, cut: cutOut(file, [...path, m]) })
      drop(file, [...path, m])
      cur.splice(m, 1)
    }
    aKeys.forEach((k, i) => {
      if (cur[i] !== k) {
        const mv = moved.get(k)
        if (mv?.cut === undefined)
          put(file, [...path, i], mv ? mv.value : make(k), true)
        else {
          put(file, [...path, i], HOLE, true)
          const t = texts.get(file)
          const cut = mv.cut
          if (t !== undefined && !poisoned.has(file))
            texts.set(
              file,
              t.replace(
                new RegExp(JSON.stringify(HOLE) + '(,?)'),
                (_, comma: string) => cut.slice + comma + cut.tail,
              ),
            )
        }
        cur.splice(i, 0, k)
      }
    })
  }
  const HOLE = '__culm_moved_element__'

  // ---- files of pieces and pages: where each lives, including the ones this batch creates
  const pieceFiles = new Map<string, string>()
  for (const c of after.components)
    pieceFiles.set(c.id, map.pieceFile(c.id) ?? `pieces/${c.id}.json`)
  const taken = new Set(orig.keys())
  const pageName = (p: Page) => {
    const stem = p.slug === '/' ? 'home' : p.slug.slice(1).replace(/\//g, '-')
    let name = `${stem}.json`
    for (let n = 2; taken.has(`pages/${name}`); n++) name = `${stem}-${n}.json`
    taken.add(`pages/${name}`)
    return name
  }

  // ---- nodes, as a file writes them
  function shortRaw(n: Node, parent: Node | undefined): Raw | undefined {
    if (!n.origin || !registry.block(n.origin.block)) return undefined
    const raw: Raw = { block: n.origin.block, look: n.origin.look, id: n.id }
    for (const [k, v] of Object.entries(readSettings(registry, n)))
      if (!['block', 'look', 'id'].includes(k)) raw[k] = v
    const ok = (r: Raw) => {
      const sim = simulate(registry, r, n.id, parent?.kind)
      return sim !== undefined && eq(sim, n)
    }
    if (!ok(raw)) return undefined
    for (const k of Object.keys(raw)) {
      if (['block', 'look', 'id'].includes(k)) continue
      if (ok(omit(raw, k))) delete raw[k]
    }
    return raw
  }
  // a piece that declares a setting called `name` keeps that key of a use for the setting
  const declaresName = (component: string | undefined) =>
    after.components
      .find(c => c.id === component)
      ?.props.some(p => p.key === 'name') ?? false
  const useLabel = () =>
    kindSpec('instance', registry.kinds())?.label ?? 'Component'
  function rawNew(n: Node, parent: Node | undefined, file: string): Raw {
    const pf = n.component ? pieceFiles.get(n.component) : undefined
    const { id, slot, set, name } = n
    const extra = omit(n, 'id', 'kind', 'name', 'slot', 'component', 'set')
    if (
      pf &&
      n.kind === 'instance' &&
      (n.name === useLabel() || !declaresName(n.component)) &&
      !Object.keys(extra).length &&
      eq(slot, defaultSlot(parent?.kind))
    )
      return {
        use: posix.relative(posix.dirname(file), pf),
        id,
        ...(name === useLabel() ? {} : { name }),
        ...(set ?? {}),
      }
    const short = shortRaw(n, parent)
    if (short && eq(n.slot, defaultSlot(parent?.kind))) return short
    return {
      ...strip(n),
      ...(n.children
        ? { children: n.children.map(c => rawNew(c, n, file)) }
        : {}),
    }
  }

  /** Writes the id of the node and of every node under it that has none, so a move of its place does not change them. */
  function pin(file: string, path: JsonPath, b: Node): void {
    const raw = rawAt(file, path)
    if (!isObj(raw)) return
    if (raw.id === undefined) put(file, [...path, 'id'], b.id)
    if (!('block' in raw) && !('use' in raw))
      (b.children ?? []).forEach((c, i) =>
        pin(file, [...path, 'children', i], c),
      )
  }

  function syncPlain(file: string, path: JsonPath, b: Node, a: Node, raw: Raw) {
    const now = omit(raw, 'children')
    const next = strip(a)
    // id, name and slot may be left out of a file: a change then writes the whole value, not a part of it
    for (const k of ['id', 'name', 'slot'] as const)
      if (raw[k] === undefined) {
        if (!eq(b[k], a[k])) put(file, [...path, k], a[k])
        delete next[k]
      }
    sync(file, path, now, next)
  }

  function syncChildren(file: string, path: JsonPath, b: Node, a: Node) {
    const cp = [...path, 'children']
    if (a.children === undefined) {
      if (b.children !== undefined) drop(file, cp)
      return
    }
    if (b.children === undefined) {
      put(
        file,
        cp,
        a.children.map(c => rawNew(c, a, file)),
      )
      return
    }
    if (eq(b.children, a.children)) return
    const raw = rawAt(file, cp)
    if (!Array.isArray(raw) || raw.length !== b.children.length)
      return bad(
        file,
        cp,
        `${file} does not hold the children of ${b.id} as loaded.`,
      )
    const bIds = b.children.map(c => c.id)
    const aIds = a.children.map(c => c.id)
    b.children.forEach((c, j) => {
      const k = aIds.indexOf(c.id)
      if (k >= 0 && k !== j) pin(file, [...cp, j], c)
    })
    seq(file, cp, bIds, aIds, id =>
      rawNew(
        a.children!.find(c => c.id === id)!,
        a,
        file,
      ),
    )
    a.children.forEach((c, i) => {
      const was = b.children!.find(x => x.id === c.id)
      if (was) syncNode(file, [...cp, i], was, c, a)
    })
  }

  function syncNode(
    file: string,
    path: JsonPath,
    b: Node,
    a: Node,
    parent: Node | undefined,
  ): void {
    if (eq(b, a)) return
    const raw = rawAt(file, path)
    if (!isObj(raw))
      return bad(file, path, `${file} has no node at ${path.join('.')}.`)
    if (b.id !== a.id)
      return bad(file, path, `${b.id} cannot be renamed to ${a.id} in a file.`)
    if (b.kind !== a.kind) return put(file, path, rawNew(a, parent, file))
    if ('use' in raw) return syncUse(file, path, b, a, parent, raw)
    if ('block' in raw) return syncShort(file, path, b, a, parent, raw)
    syncPlain(file, path, b, a, raw)
    syncChildren(file, path, b, a)
  }

  function syncUse(
    file: string,
    path: JsonPath,
    b: Node,
    a: Node,
    parent: Node | undefined,
    raw: Raw,
  ) {
    const fixed = (n: Node) => omit(n, 'id', 'set', 'name')
    if (!eq(fixed(b), fixed(a)) || !eq(a.slot, defaultSlot(parent?.kind)))
      return bad(
        file,
        path,
        `${a.id} is a use of a piece: a file holds only the values of its settings there.`,
      )
    const next: Raw = { use: raw.use }
    if (raw.id !== undefined) next.id = raw.id
    if (a.name !== useLabel())
      if (declaresName(a.component))
        return bad(
          file,
          path,
          `${a.id} is a use of a piece that has a setting called name, so a use cannot carry a node name.`,
        )
      else next.name = a.name
    Object.assign(next, a.set ?? {})
    sync(file, path, raw, next)
  }

  function syncShort(
    file: string,
    path: JsonPath,
    b: Node,
    a: Node,
    parent: Node | undefined,
    raw: Raw,
  ) {
    if (
      b.origin &&
      a.origin &&
      b.origin.block === a.origin.block &&
      registry.block(b.origin.block)
    ) {
      const sb = readSettings(registry, b)
      const sa = readSettings(registry, a)
      const next: Raw = { ...raw }
      for (const k of new Set([...Object.keys(sb), ...Object.keys(sa)]))
        if (!eq(sb[k], sa[k]))
          if (sa[k] === undefined) delete next[k]
          else next[k] = sa[k]
      if (a.origin.look !== b.origin.look) next.look = a.origin.look
      const sim = simulate(registry, next, a.id, parent?.kind)
      if (sim && eq(sim, a)) return sync(file, path, raw, next)
    }
    const out = expandShortForm(texts.get(file)!, path, registry, file)
    if (out === undefined || poisoned.has(file))
      return bad(file, path, `${a.id} cannot be written as nodes.`)
    texts.set(file, out)
    notes.push({
      kind: 'expanded',
      ids: [a.id],
      text: `${a.id} was written as nodes: the change reaches inside the block, which a short form cannot hold.`,
    })
    const now = rawAt(file, path)
    if (!isObj(now))
      return bad(file, path, `${file} has no node at ${path.join('.')}.`)
    syncPlain(file, path, b, a, now)
    syncChildren(file, path, b, a)
  }

  // ---- the site file
  const SITE = 'site.json'
  const siteKey = (k: 'name' | 'look' | 'fonts' | 'languages') => {
    if (eq(before[k], after[k])) return
    const rv = rawAt(SITE, [k])
    if (after[k] === undefined) {
      if (rv !== undefined) drop(SITE, [k])
    } else if (rv === undefined) put(SITE, [k], after[k])
    else sync(SITE, [k], rv, after[k])
  }
  for (const k of ['name', 'look', 'fonts', 'languages'] as const) siteKey(k)
  if (!eq(before.styles, after.styles)) {
    const rv = rawAt(SITE, ['styles'])
    if (after.styles === undefined) {
      if (rv !== undefined) drop(SITE, ['styles'])
    } else if (!isObj(rv)) put(SITE, ['styles'], after.styles)
    else if (!eq(before.look, after.look))
      sync(SITE, ['styles'], rv, after.styles)
    else
      sync(
        SITE,
        ['styles'],
        { ...defaultSiteStyles(before.look), ...rv },
        after.styles,
      )
  }
  for (const k of ['header', 'footer'] as const) {
    if (eq(before[k], after[k])) continue
    if (rawAt(SITE, [k]) === undefined)
      put(SITE, [k], rawNew(after[k], undefined, SITE))
    else syncNode(SITE, [k], before[k], after[k], undefined)
  }

  // ---- pieces
  const bComps = new Map(before.components.map(c => [c.id, c]))
  const aComps = new Map(after.components.map(c => [c.id, c]))
  for (const id of bComps.keys())
    if (!aComps.has(id)) {
      const f = map.pieceFile(id)
      if (f) removed.add(f)
    }
  const likeSite = orig.get(SITE) ?? ''
  const schemaFor = (file: string) => {
    const s = (parseFile(likeSite).value as Raw | undefined)?.$schema
    return typeof s === 'string'
      ? { $schema: posix.relative(posix.dirname(file), posix.join('.', s)) }
      : {}
  }
  for (const [id, c] of aComps) {
    const was = bComps.get(id)
    const file = pieceFiles.get(id)!
    if (!was) {
      texts.set(
        file,
        whole(
          {
            ...schemaFor(file),
            id: c.id,
            name: c.name,
            settings: c.props,
            root: rawNew(c.root, undefined, file),
          },
          likeSite,
        ),
      )
      continue
    }
    if (!eq(was.props, c.props)) {
      const rs = rawAt(file, ['settings'])
      if (rs === undefined) put(file, ['settings'], c.props)
      else sync(file, ['settings'], rs, c.props)
    }
    syncNode(file, ['root'], was.root, c.root, undefined)
  }

  // ---- pages
  const bPages = new Map(before.pages.map(p => [p.id, p]))
  const aPages = new Map(after.pages.map(p => [p.id, p]))
  const names = rawAt(SITE, ['pages'])
  const oldNames = Array.isArray(names) ? (names as string[]) : []
  const nameOf = new Map<string, string>()
  before.pages.forEach(
    (p, i) => oldNames[i] !== undefined && nameOf.set(p.id, oldNames[i]!),
  )
  for (const p of before.pages)
    if (!aPages.has(p.id)) {
      const f = map.pageFile(p.id)
      if (f) removed.add(f)
    }
  for (const p of after.pages) {
    const was = bPages.get(p.id)
    if (!was) {
      const name = pageName(p)
      const file = `pages/${name}`
      nameOf.set(p.id, name)
      const { root, ...fields } = p as Page & Raw
      texts.set(
        file,
        whole(
          {
            ...schemaFor(file),
            ...fields,
            root: rawNew(root, undefined, file),
          },
          likeSite,
        ),
      )
      continue
    }
    const file = map.pageFile(p.id)
    if (!file) {
      bad(SITE, ['pages'], `The file of the page ${p.id} is not known.`)
      continue
    }
    const raw = rawAt(file, [])
    if (!isObj(raw)) {
      bad(file, [], `${file} cannot be read.`)
      continue
    }
    const own = omit(raw, 'root', '$schema')
    const { root: bRoot, ...bFields } = was
    const { root: aRoot, ...aFields } = p
    if (!eq(bFields, aFields))
      sync(
        file,
        [],
        { icon: '', on: true, inMenu: true, inFooter: false, ...own },
        aFields,
      )
    syncNode(file, ['root'], bRoot, aRoot, undefined)
  }
  if (
    oldNames.length === before.pages.length &&
    (before.pages.some(p => !aPages.has(p.id)) ||
      after.pages.some(p => !bPages.has(p.id)) ||
      !eq(
        before.pages.map(p => p.id),
        after.pages.map(p => p.id),
      ))
  ) {
    const bKeys = oldNames
    const aKeys = after.pages.map(p => nameOf.get(p.id)!)
    seq(SITE, ['pages'], bKeys, aKeys, k => k)
  }

  if (problems.length) return { write: {}, remove: [], notes: [], problems }
  const write: Record<string, string> = {}
  for (const [f, t] of texts)
    if (!removed.has(f) && orig.get(f) !== t) write[f] = t
  return { write, remove: [...removed].sort(), notes, problems }
}
