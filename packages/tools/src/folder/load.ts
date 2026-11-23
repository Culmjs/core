import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { posix } from 'node:path'
import { ID_RE, PLAIN, isObj } from '../shared.ts'
import { refusal, walkFiles } from './files.ts'
import {
  SCHEMA_VERSION,
  applySetting,
  checkRows,
  defaultSiteStyles,
  insertBlock,
  kindSpec,
  validateSite,
  walk,
} from '@culmjs/core'
import type {
  Component,
  ComponentProp,
  Data,
  DataSource,
  Look,
  Node,
  Page,
  Problem,
  PropValue,
  Registry,
  Row,
  SiteDocument,
  Slot,
  TreeRef,
} from '@culmjs/core'
import { derivedId } from './ids.ts'
import { parseFile, type JsonPath } from './jsonc.ts'
import { readByPlugins, type Located } from './plugins.ts'
import { makeSourceMap, treeKey } from './sourceMap.ts'
import type { Origin, SourceMap } from './sourceMap.ts'

export type { Origin, SourceMap } from './sourceMap.ts'

export type LoadOptions = {
  /**
   * The caller holds the problems of `loadPlugins` (culm.json, blocks/, the fields of data/), so a syntax error in one of those files
   * is not reported again; the load still returns no document. Alone, `loadFiles` reports every broken file once.
   */
  alreadyReported?: boolean
}

export type Loaded = {
  /** Absent when a file could not be read into a document; present, with problems, when only validation failed. */
  doc: SiteDocument | undefined
  map: SourceMap
  data: Data
  /** every file read, project-relative, in path order */
  files: { path: string; sha256: string; text: string }[]
  notices: Located[]
  problems: Located[]
}

// ---------------------------------------------------------------- reading

type Scan = {
  files: Map<string, string>
  refused: Map<string, string>
  /** The folder could not be read at all: the one problem, and no files. */
  unreadable?: Located
}

/** Reads the project's JSON files. A symbolic link that leaves the folder is not read; it is listed in `refused`. */
export async function readFolder(dir: string): Promise<Scan> {
  let walked
  try {
    walked = await walkFiles(
      dir,
      ['culm.json', 'site.json', 'pages', 'pieces', 'blocks', 'data'],
      rel => rel.endsWith('.json'),
    )
  } catch (e) {
    return {
      files: new Map(),
      refused: new Map(),
      unreadable: {
        code: 'INVALID_DOCUMENT',
        message: `The folder "${dir}" cannot be read: ${e instanceof Error ? e.message : String(e)}`,
      },
    }
  }
  const { files, refused } = walked
  const read = await Promise.all(
    [...files].map(
      async ([rel, abs]) => [rel, await readFile(abs, 'utf8')] as const,
    ),
  )
  return {
    files: new Map(read.sort(([a], [b]) => (a < b ? -1 : 1))),
    refused,
  }
}

/** culm.json, site.json, pages/, pieces/, blocks/ and data/, as project-relative paths to text. Never reads outside the folder. */
export async function readProject(dir: string): Promise<Map<string, string>> {
  return (await readFolder(dir)).files
}

// ---------------------------------------------------------------- loading

export const defaultSlot = (parent: string | undefined): Slot =>
  parent === 'free'
    ? { x: 0, y: 0, w: 6, h: 4, z: 0 }
    : parent === 'row' || parent === 'column'
      ? { grow: 0, align: 'stretch' }
      : parent === 'grid'
        ? { cols: 1, rows: 1 }
        : {}

const TARGET_KEYS = ['scrollTo', 'open', 'close', 'play', 'pause']

async function build(
  files: ReadonlyMap<string, string>,
  registry: Registry,
  refused: ReadonlyMap<string, string>,
  opts: LoadOptions,
): Promise<Loaded> {
  const problems: Located[] = []
  const notices: Located[] = []
  const parsed = new Map<string, ReturnType<typeof parseFile>>()
  const parse = (file: string) => {
    let f = parsed.get(file)
    if (!f) parsed.set(file, (f = parseFile(files.get(file) ?? '')))
    return f
  }
  const origins = new Map<string, Origin>()
  const trees = new Map<string, TreeRef>()
  const pageFiles = new Map<string, string>()
  const pieceFiles = new Map<string, string>()
  const map = makeSourceMap({
    origins,
    trees,
    pages: pageFiles,
    pieces: pieceFiles,
    at: (file, path) => parse(file).at(path),
  })
  const record = (tree: TreeRef, id: string, o: Origin) => {
    origins.set(`${treeKey(tree)}|${id}`, o)
    if (typeof tree !== 'string' && 'component' in tree) {
      if (!trees.has(id)) trees.set(id, tree)
    } else trees.set(id, tree)
  }

  const say = (
    list: Located[],
    code: Problem['code'],
    message: string,
    file: string,
    path: JsonPath,
    more: Partial<Problem> = {},
  ) => {
    const at = parse(file).at(path)
    list.push({
      code,
      message,
      ...more,
      file,
      // a problem about a whole file is at line 1
      line: at?.line ?? (path.length ? undefined : 1),
      column: at?.column ?? (path.length ? undefined : 1),
    })
  }
  const bad = (
    message: string,
    file: string,
    path: JsonPath,
    code: Problem['code'] = 'INVALID_DOCUMENT',
    more: Partial<Problem> = {},
  ) => say(problems, code, message, file, path, more)

  const finish = (
    doc: SiteDocument | undefined,
    data: Data = { rows: {} },
  ): Loaded => ({
    doc,
    map,
    data,
    files: [...files]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([path, text]) => ({
        path,
        text,
        sha256: createHash('sha256').update(text).digest('hex'),
      })),
    notices,
    problems,
  })

  // A JSON syntax error in any file means no document. Each file has one owner of its problems: loadPlugins reports
  // the files readByPlugins names; this reports every other file (and the rows of data/).
  let broken = false
  for (const [file] of files) {
    const e = parse(file).errors[0]
    if (!e) continue
    broken = true
    if (!opts.alreadyReported || !readByPlugins(file))
      problems.push({
        code: 'INVALID_DOCUMENT',
        message: `Invalid JSON: ${e.message}.`,
        file,
        line: e.line,
        column: e.column,
      })
  }
  if (broken) return finish(undefined)

  // data/*.json -> rows
  const data: Data = { rows: {} }
  for (const file of files.keys()) {
    const m = /^data\/([^/]+)\.json$/.exec(file)
    if (!m) continue
    const v = parse(file).value
    if (!isObj(v) || !isObj(v.fields)) continue // loadPlugins reports a data file without fields
    const source: DataSource = {
      name: m[1]!,
      fields: v.fields as DataSource['fields'],
      sample: [],
    }
    const rows = v.rows ?? []
    const found = checkRows(source, rows)
    for (const p of found) {
      // "<name>.<row>.<field>" -> ['rows', row, field]
      const rest = (p.path ?? '').split('.').slice(1)
      const path: JsonPath = [
        'rows',
        ...rest.map(x => (/^\d+$/.test(x) ? +x : x)),
      ]
      bad(p.message, file, parse(file).at(path) ? path : ['rows'], p.code)
    }
    if (!found.length) data.rows[source.name] = rows as Row[]
  }

  // symbolic links the reader refused: reported where something refers to them, or at the link
  const refusalOf = (rel: string) => {
    for (const [p, why] of refused)
      if (rel === p || rel.startsWith(p + '/'))
        return [p, `${p} is refused: ${why}.`] as const
    return undefined
  }
  const reported = new Set<string>()
  const refer = (rel: string, file: string, path: JsonPath): boolean => {
    const hit = refusalOf(rel)
    if (!hit) return false
    reported.add(hit[0])
    bad(hit[1], file, path, 'POLICY_VIOLATION')
    return true
  }

  const written = (
    file: string,
    path: JsonPath,
    raw: Record<string, unknown>,
  ) => {
    if (raw.id === undefined) return undefined
    if (typeof raw.id === 'string' && raw.id !== '') return raw.id
    bad('"id" must be text.', file, [...path, 'id'])
    return undefined
  }
  const noted = (id: string, file: string, path: JsonPath) =>
    say(
      notices,
      'INVALID_NODE',
      `Node ${id} has no written id; its id is derived from its place in the file.`,
      file,
      path,
      { nodeId: id },
    )

  const pieces = new Map<string, Component>()
  const stack: string[] = []

  function useOf(
    file: string,
    path: JsonPath,
    raw: Record<string, unknown>,
    parent: string | undefined,
    tree: TreeRef,
  ): Node | undefined {
    const target = raw.use
    const key = [...path, 'use']
    if (typeof target !== 'string' || target === '') {
      bad('"use" must be the path of a piece file.', file, key)
      return undefined
    }
    const rel = posix.normalize(posix.join(posix.dirname(file), target))
    if (posix.isAbsolute(target) || rel === '..' || rel.startsWith('../')) {
      bad(`"${target}" is outside the project.`, file, key, 'POLICY_VIOLATION')
      return undefined
    }
    if (refer(rel, file, key)) return undefined
    if (!files.has(rel)) {
      bad(`The piece file ${rel} is missing.`, file, key)
      return undefined
    }
    if (stack.includes(rel)) {
      bad(
        `${rel} uses itself: ${[...stack.slice(stack.indexOf(rel)), rel].join(' > ')}.`,
        file,
        key,
      )
      return undefined
    }
    let comp = pieces.get(rel)
    if (!comp) {
      const v = parse(rel).value
      let id = derivedId(rel, [])
      if (!isObj(v) || !isObj(v.root)) {
        bad('A piece file needs a "root".', rel, [])
        return undefined
      }
      if (v.id !== undefined) {
        if (typeof v.id === 'string' && ID_RE.test(v.id)) id = v.id
        else {
          bad('A piece "id" is 1 to 20 lowercase letters and digits.', rel, [
            'id',
          ])
          return undefined
        }
      }
      const twin = [...pieces.entries()].find(([, c]) => c.id === id)
      if (twin) {
        bad(`The piece id "${id}" is also used by ${twin[0]}.`, rel, ['id'])
        bad(`The piece id "${id}" is also used by ${rel}.`, twin[0], ['id'])
        return undefined
      }
      comp = {
        id,
        name: typeof v.name === 'string' && v.name ? v.name : rel,
        root: undefined as unknown as Node,
        props: Array.isArray(v.settings) ? (v.settings as ComponentProp[]) : [],
        variants: [],
      }
      pieceFiles.set(id, rel)
      stack.push(rel)
      const root = nodeOf(rel, ['root'], v.root, undefined, { component: id })
      stack.pop()
      if (!root) return undefined
      comp.root = root
      pieces.set(rel, comp)
    }
    const id = written(file, path, raw)
    const nodeId = id ?? derivedId(file, path)
    const set: Record<string, PropValue> = {}
    let useName: string | undefined
    for (const [k, v] of Object.entries(raw)) {
      if (k === 'use' || k === 'id') continue
      if (k === 'name' && !comp.props.some(p => p.key === 'name')) {
        if (typeof v === 'string' && v) useName = v
        else bad('"name" must be text.', file, [...path, k])
        continue
      }
      if (!comp.props.some(p => p.key === k)) {
        bad(
          `${rel} has no setting "${k}".`,
          file,
          [...path, k],
          'INVALID_NODE',
          {
            nodeId,
            allowed: comp.props.map(p => p.key),
          },
        )
        continue
      }
      set[k] = v as PropValue
    }
    record(tree, nodeId, { file, path, form: 'use', written: id !== undefined })
    if (id === undefined) noted(nodeId, file, path)
    return {
      id: nodeId,
      kind: 'instance',
      name:
        useName ?? kindSpec('instance', registry.kinds())?.label ?? 'Component',
      slot: defaultSlot(parent),
      component: comp.id,
      ...(Object.keys(set).length ? { set } : {}),
    }
  }

  function shortOf(
    file: string,
    path: JsonPath,
    raw: Record<string, unknown>,
    parent: string | undefined,
    tree: TreeRef,
  ): Node | undefined {
    const id = written(file, path, raw)
    const rootId = id ?? derivedId(file, path)
    const blockId = String(raw.block)
    const block = registry.block(blockId)
    const lookId = typeof raw.look === 'string' ? raw.look : block?.looks[0]?.id
    const made = insertBlock(registry, blockId, lookId ?? '', rootId)
    if (!made.ok) {
      for (const p of made.problems)
        bad(p.message, file, [...path, block ? 'look' : 'block'], p.code, {
          allowed: p.allowed,
        })
      return undefined
    }
    let root = made.root
    for (const [k, v] of Object.entries(raw)) {
      if (k === 'block' || k === 'look' || k === 'id') continue
      const r = applySetting(registry, root, k, v as PropValue)
      if (r.ok) root = r.root
      else
        for (const p of r.problems)
          bad(p.message, file, [...path, k], p.code, {
            nodeId: rootId,
            allowed: p.allowed,
          })
    }
    root.slot = defaultSlot(parent)
    walk(root, (n, p) =>
      record(tree, n.id, {
        file,
        path,
        form: p ? 'in-short' : 'short',
        written: !p && id !== undefined,
      }),
    )
    if (id === undefined) noted(rootId, file, path)
    return root
  }

  function nodeOf(
    file: string,
    path: JsonPath,
    raw: unknown,
    parent: string | undefined,
    tree: TreeRef,
  ): Node | undefined {
    if (!isObj(raw)) {
      bad('A node must be an object.', file, path)
      return undefined
    }
    if ('block' in raw) return shortOf(file, path, raw, parent, tree)
    if ('use' in raw) return useOf(file, path, raw, parent, tree)
    if (typeof raw.kind !== 'string') {
      bad('A node needs a "kind", a "block" or a "use".', file, path)
      return undefined
    }
    const id = written(file, path, raw)
    const nodeId = id ?? derivedId(file, path)
    const { name, slot, children } = raw
    const rest = { ...raw }
    for (const k of ['id', 'kind', 'name', 'slot', 'children']) delete rest[k]
    const node: Node = {
      id: nodeId,
      kind: raw.kind,
      name:
        typeof name === 'string'
          ? name
          : (kindSpec(raw.kind, registry.kinds())?.label ?? raw.kind),
      slot: (isObj(slot) ? slot : defaultSlot(parent)) as Slot,
      ...(rest as object),
    }
    if (Array.isArray(children))
      node.children = children.flatMap(
        (c, i) =>
          nodeOf(file, [...path, 'children', i], c, raw.kind as string, tree) ??
          [],
      )
    else if (children !== undefined)
      bad('"children" must be a list.', file, [...path, 'children'])
    const isPiece = typeof tree !== 'string' && 'component' in tree
    record(tree, nodeId, {
      file,
      path,
      form: isPiece ? 'in-piece' : 'node',
      written: id !== undefined,
    })
    if (id === undefined) noted(nodeId, file, path)
    return node
  }

  // ---- site.json
  if (!files.has('site.json')) {
    if (!refer('site.json', 'site.json', []))
      bad('site.json is missing.', 'site.json', [])
    return finish(undefined, data)
  }
  const site = parse('site.json').value
  if (!isObj(site)) {
    bad('site.json must be an object.', 'site.json', [])
    return finish(undefined, data)
  }

  const names = Array.isArray(site.pages) ? site.pages : []
  if (site.pages !== undefined && !Array.isArray(site.pages))
    bad('"pages" must be a list of file names.', 'site.json', ['pages'])
  const listed = new Set<string>()
  const pages: Page[] = []
  for (const [i, name] of names.entries()) {
    const at: JsonPath = ['pages', i]
    if (typeof name !== 'string') {
      bad('A page must be a file name.', 'site.json', at)
      continue
    }
    const file = posix.normalize(posix.join('pages', name))
    if (!file.startsWith('pages/')) {
      bad(
        `"${name}" is outside the pages folder.`,
        'site.json',
        at,
        'POLICY_VIOLATION',
      )
      continue
    }
    listed.add(file)
    if (refer(file, 'site.json', at)) continue
    if (!files.has(file)) {
      bad(`The page file ${file} is missing.`, 'site.json', at)
      continue
    }
    const v = parse(file).value
    if (!isObj(v)) {
      bad('A page file must be an object.', file, [])
      continue
    }
    const id = typeof v.id === 'string' ? v.id : ''
    const tree: TreeRef = { page: id }
    pageFiles.set(id, file)
    const root = nodeOf(file, ['root'], v.root, undefined, tree)
    if (!root) continue
    const fields = { ...v }
    delete fields.$schema
    delete fields.root
    pages.push({
      icon: '',
      on: true,
      inMenu: true,
      inFooter: false,
      ...fields,
      root,
    } as Page)
  }
  for (const file of files.keys())
    if (
      /^pages\/.+\.json$/.test(file) &&
      !listed.has(file) &&
      !refused.has(file)
    )
      bad(`${file} is not in the "pages" list of site.json.`, file, [])

  const chrome = (key: 'header' | 'footer', label: string): Node => {
    if (site[key] === undefined)
      return {
        id: key,
        kind: 'column',
        name: label,
        slot: {},
      }
    return (
      nodeOf('site.json', [key], site[key], undefined, key) ??
      ({ id: key, kind: 'column', name: label, slot: {} } as Node)
    )
  }
  const header = chrome('header', 'Header')
  const footer = chrome('footer', 'Footer')

  for (const rel of refused.keys())
    if (!reported.has(rel)) problems.push(refusal(rel, refused.get(rel)!))

  // ---- a trigger or an opens that names a node whose id is not written in the file
  const docTrees: [TreeRef, Node][] = [
    ...pages.map(p => [{ page: p.id }, p.root] as [TreeRef, Node]),
    ['header', header],
    ['footer', footer],
    ...[...pieces.values()].map(
      c => [{ component: c.id }, c.root] as [TreeRef, Node],
    ),
  ]
  for (const [tree, root] of docTrees)
    walk(root, n => {
      const here = origins.get(`${treeKey(tree)}|${n.id}`)
      if (!here || (here.form !== 'node' && here.form !== 'in-piece')) return
      const refs: [string, JsonPath][] = []
      if (typeof n.props?.opens === 'string')
        refs.push([n.props.opens, ['props', 'opens']])
      for (const [i, t] of (Array.isArray(n.on) ? n.on : []).entries()) {
        const d = (t?.do ?? {}) as Record<string, unknown>
        const k = TARGET_KEYS.find(x => typeof d[x] === 'string')
        if (k) refs.push([d[k] as string, ['on', i, 'do', k]])
      }
      for (const [target, rel] of refs) {
        const there = origins.get(`${treeKey(tree)}|${target}`)
        if (there && there.form !== 'in-short' && !there.written)
          bad(
            `${n.id} refers to ${target}, which has no written id; write an "id" on it.`,
            here.file,
            [...here.path, ...rel],
            'INVALID_NODE',
            { nodeId: n.id },
          )
      }
    })

  if (problems.length) return finish(undefined, data)

  // ---- the document
  const look = (isObj(site.look) ? site.look : PLAIN) as Look
  const doc: SiteDocument = {
    schemaVersion: SCHEMA_VERSION,
    name: typeof site.name === 'string' ? site.name : '',
    pages,
    header,
    footer,
    components: [...pieces.values()],
    fonts: (Array.isArray(site.fonts)
      ? site.fonts
      : [
          ...new Set([look.headingFont, look.bodyFont]),
        ]) as SiteDocument['fonts'],
    look,
    ...(isObj(site.styles)
      ? { styles: { ...defaultSiteStyles(look), ...site.styles } }
      : {}),
    ...(site.centreMaxWidth === true ? { centreMaxWidth: true } : {}),
    ...(Array.isArray(site.languages)
      ? { languages: site.languages as SiteDocument['languages'] }
      : {}),
  }
  for (const p of validateSite(doc, registry))
    problems.push(map.locateProblem(p))
  return finish(doc, data)
}

export const loadFiles = (
  files: ReadonlyMap<string, string>,
  registry: Registry,
  opts: LoadOptions = {},
  refused: ReadonlyMap<string, string> = new Map(),
): Promise<Loaded> => build(files, registry, refused, opts)

export async function loadFolder(
  dir: string,
  registry: Registry,
  opts: LoadOptions = {},
): Promise<Loaded> {
  const { files, refused, unreadable } = await readFolder(dir)
  const loaded = await build(files, registry, refused, opts)
  if (unreadable) loaded.problems.unshift(unreadable)
  return loaded
}
