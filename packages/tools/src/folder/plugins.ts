import { readFileSync, realpathSync } from 'node:fs'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  checkRows,
  createRegistry,
  emptySite,
  validateSite,
} from '@culmjs/core'
import type {
  BlockDef,
  DataSource,
  Node,
  Plugin,
  Problem,
  Registry,
  Row,
} from '@culmjs/core'
import { ID_RE, PLAIN, SOURCES, isObj } from '../shared.ts'
import { parseFile, type JsonPath } from './jsonc.ts'

/** The files loadPlugins reads, and so owns the problems of: culm.json and the top-level blocks/ and data/ files. */
export const readByPlugins = (file: string): boolean =>
  /^(culm\.json|(blocks|data)\/[^/]+\.json)$/.test(file)

const LOCAL = {
  name: 'local',
  version: 1,
  api: [1],
  runs: ['load', 'edit', 'build'],
  trust: 'declarative',
} as const satisfies Plugin
/** Project sources: an output folder may not be one of these or lie inside one. */
export const RESERVED = new RegExp(
  `^(${SOURCES.map(n => n.replace('.', '\\.')).join('|')})([\\\\/]|$)`,
  'i',
)
const NAME_RE = /^(@[a-z0-9._~-]+\/)?[a-z0-9._~-]+$/
const SCALARS = ['text', 'number', 'boolean', 'list']
const validType = (t: unknown): boolean =>
  SCALARS.includes(t as string) ||
  (isObj(t) && isObj(t.rows) && Object.values(t.rows).every(validType))

const SETTING_TYPES = [
  'number',
  'switch',
  'select',
  'text',
  'textarea',
  'color',
  'link',
  'asset',
]
const optional = (v: unknown, type: string) =>
  v === undefined || typeof v === type
const strings = (v: unknown) =>
  Array.isArray(v) && v.every(x => typeof x === 'string')
const pathOk = (v: unknown) =>
  typeof v === 'string' || (strings(v) && (v as unknown[]).length > 0)
/** What an action lacks, by the shape core's `Action` and its readers expect; undefined when it is fine. */
function actionProblem(a: unknown): string | undefined {
  if (!isObj(a)) return 'is an object'
  switch (a.do) {
    case 'set':
      return pathOk(a.path) &&
        optional(a.unsetWhenEmpty, 'boolean') &&
        (a.as === undefined ||
          (isObj(a.as) &&
            ['px', '%', 'ch', 'vh', 'vw'].includes(a.as.unit as string))) &&
        (a.readWhen === undefined ||
          (isObj(a.readWhen) && typeof a.readWhen.path === 'string'))
        ? undefined
        : 'is a "set" with a "path" (text or a list of text), and "as" and "readWhen" in their shapes'
    case 'choose':
      return isObj(a.options) &&
        typeof a.default === 'string' &&
        Object.values(a.options).every(
          o =>
            isObj(o) &&
            (o.write === undefined || isObj(o.write)) &&
            (o.remove === undefined || strings(o.remove)),
        )
        ? undefined
        : 'is a "choose" with "options" (each with "write" an object, "remove" a list of text) and a "default"'
    case 'show':
      return strings(a.nodes) &&
        (a.when === undefined || strings(a.when)) &&
        (a.emptyIs === undefined ||
          a.emptyIs === 'hidden' ||
          a.emptyIs === 'shown')
        ? undefined
        : 'is a "show" with "nodes" (a list of text), and "when" and "emptyIs" in their shapes'
    case 'filter':
      return pathOk(a.list) &&
        typeof a.field === 'string' &&
        (a.empty === undefined ||
          a.empty === 'remove' ||
          (isObj(a.empty) && 'is' in a.empty))
        ? undefined
        : 'is a "filter" with a "list" (text or a list of text), a "field" and "empty" in its shape'
    default:
      return 'has "do" set, choose, show or filter'
  }
}

/** What a declarative setting lacks, by the shape core's `Setting` and its readers expect: [what, path inside the setting]. */
function settingProblems(s: Record<string, unknown>): [string, JsonPath][] {
  const out: [string, JsonPath][] = []
  const need = (ok: boolean, what: string, path: JsonPath) => {
    if (!ok) out.push([what, path])
  }
  need(typeof s.key === 'string' && s.key !== '', 'a "key"', ['key'])
  need(typeof s.label === 'string', 'a "label"', ['label'])
  need(
    SETTING_TYPES.includes(s.type as string),
    `a "type" (${SETTING_TYPES.join(', ')})`,
    ['type'],
  )
  need(
    optional(s.min, 'number') && optional(s.max, 'number'),
    '"min" and "max" as numbers',
    ['min'],
  )
  need(optional(s.invert, 'boolean'), '"invert" as true or false', ['invert'])
  need(
    s.type !== 'select' ||
      (Array.isArray(s.options) &&
        s.options.every(
          o =>
            isObj(o) &&
            typeof o.label === 'string' &&
            typeof o.value === 'string',
        )),
    '"options" as a list of labels and values',
    ['options'],
  )
  if (!Array.isArray(s.actions)) need(false, '"actions" as a list', ['actions'])
  else
    for (const [j, a] of s.actions.entries()) {
      const what = actionProblem(a)
      if (what) out.push([`an action that ${what}`, ['actions', j]])
    }
  return out
}

// Same registry, plus the project's own data sources, so a block can repeat over them.
const withSources = (r: Registry, local: DataSource[]): Registry => ({
  ...r,
  source: n => r.source(n) ?? local.find(x => x.name === n),
  sources: () => [...r.sources(), ...local],
})

// First of import, node, default; nested condition objects allowed.
function pick(target: unknown): string | undefined {
  if (typeof target === 'string') return target
  if (!isObj(target)) return undefined
  for (const c of ['import', 'node', 'default']) {
    const t = pick(target[c])
    if (t !== undefined) return t
  }
  return undefined
}

/** The file to import for a package installed in `<dir>/node_modules`; never looks in a parent folder. */
function entryOf(dir: string, name: string): string | { error: string } {
  if (
    !NAME_RE.test(name) ||
    name.startsWith('.') ||
    name.split('/').some(part => /^@?\.{1,2}$/.test(part))
  )
    return { error: `"${name}" is not a package name.` }
  const root = join(dir, 'node_modules', name)
  let pkg: unknown
  try {
    pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  } catch {
    return { error: `package ${name} is not installed in node_modules` }
  }
  const p = isObj(pkg) ? pkg : {}
  const ex = p.exports
  const fromExports =
    isObj(ex) && '.' in ex
      ? ex['.']
      : isObj(ex) && !Object.keys(ex).some(k => k.startsWith('.'))
        ? ex
        : typeof ex === 'string'
          ? ex
          : undefined
  const rel =
    ex !== undefined
      ? pick(fromExports)
      : typeof p.main === 'string'
        ? p.main
        : 'index.js'
  if (rel === undefined)
    return { error: `package ${name} has no entry for import` }
  try {
    const real = realpathSync(resolve(root, rel))
    const inside = relative(realpathSync(root), real)
    if (inside.startsWith('..') || isAbsolute(inside))
      return { error: `package ${name} has an entry outside its folder` }
    return real
  } catch {
    return { error: `package ${name} has no entry for import` }
  }
}

export type Located = Problem & {
  file?: string
  line?: number
  column?: number
}
export type ProjectConfig = { plugins: string[]; out: string }

export async function loadPlugins(
  dir: string,
  files: ReadonlyMap<string, string>,
): Promise<{ registry: Registry; config: ProjectConfig; problems: Located[] }> {
  let registry = createRegistry()
  const config: ProjectConfig = { plugins: [], out: 'dist' }
  const problems: Located[] = []

  // Reads one JSON file; every problem it reports carries the file and, where the path is known, the line.
  const read = (file: string) => {
    const f = parseFile(files.get(file) ?? '')
    const bad = (
      code: Problem['code'],
      message: string,
      path: JsonPath = [],
    ) => {
      const at = f.at(path)
      problems.push({ code, message, file, line: at?.line, column: at?.column })
    }
    // one problem for a file: the first error
    const e = f.errors[0]
    if (e)
      problems.push({
        code: 'INVALID_DOCUMENT',
        message: `Invalid JSON: ${e.message}.`,
        file,
        line: e.line,
        column: e.column,
      })
    return { value: f.value, bad, at: f.at }
  }

  if (!files.has('culm.json'))
    problems.push({
      code: 'INVALID_DOCUMENT',
      message: 'culm.json is missing.',
      file: 'culm.json',
    })
  else {
    const syntax = problems.length
    const { value, bad } = read('culm.json')
    if (problems.length > syntax) {
      // a broken culm.json is one problem; its recovered fields are not used
    } else if (!isObj(value))
      bad('INVALID_DOCUMENT', 'culm.json must be an object.')
    else {
      const { plugins, out } = value
      if (value.features !== undefined) {
        const f = value.features
        if (!isObj(f))
          bad('INVALID_DOCUMENT', 'features must be an object.', ['features'])
        else {
          for (const key of Object.keys(f))
            if (key !== 'gpu')
              bad('INVALID_DOCUMENT', 'Unknown feature.', ['features', key])
          if (f.gpu === true)
            registry = createRegistry({ gpu: { enabled: true } })
          else if (f.gpu !== undefined && f.gpu !== false)
            bad('INVALID_DOCUMENT', 'features.gpu must be a boolean.', [
              'features',
              'gpu',
            ])
        }
      }
      if (plugins !== undefined && !Array.isArray(plugins))
        bad('INVALID_DOCUMENT', '"plugins" must be a list of package names.', [
          'plugins',
        ])
      else
        for (const [i, name] of (plugins ?? ([] as unknown[])).entries()) {
          if (typeof name !== 'string' || !name) {
            bad('INVALID_DOCUMENT', 'A plug-in must be a package name.', [
              'plugins',
              i,
            ])
            continue
          }
          config.plugins.push(name)
          const found = entryOf(dir, name)
          if (typeof found !== 'string') {
            bad('INVALID_DOCUMENT', found.error, ['plugins', i])
            continue
          }
          try {
            const mod = (await import(pathToFileURL(found).href)) as {
              default?: Plugin
            }
            registry.use(mod.default as Plugin)
          } catch (e) {
            bad(
              'INVALID_DOCUMENT',
              `Plug-in "${name}" was refused: ${e instanceof Error ? e.message : String(e)}`,
              ['plugins', i],
            )
          }
        }
      if (out !== undefined) {
        const ok =
          typeof out === 'string' &&
          !isAbsolute(out) &&
          !/^(\.\.([\\/]|$))/.test(relative(dir, resolve(dir, out))) &&
          relative(dir, resolve(dir, out)) !== '' &&
          !RESERVED.test(relative(dir, resolve(dir, out)))
        if (ok) config.out = out as string
        else
          bad(
            'POLICY_VIOLATION',
            '"out" must be a folder inside the project.',
            ['out'],
          )
      }
    }
  }

  // The local plug-in: blocks/*.json and the fields of data/*.json.
  const names = (dirName: 'blocks' | 'data') =>
    [...files.keys()]
      .filter(k => k.startsWith(`${dirName}/`) && readByPlugins(k))
      .sort()
  const sources: DataSource[] = []
  // A data file that failed is already one problem; the blocks that name its source are not told again.
  let lostSource = false
  for (const file of names('data')) {
    const syntax = problems.length
    const { value, bad } = read(file)
    if (problems.length > syntax) {
      lostSource = true
      continue
    }
    if (!isObj(value) || !isObj(value.fields)) {
      bad('INVALID_DOCUMENT', 'A data file needs "fields".')
      lostSource = true
      continue
    }
    const types = Object.entries(value.fields).filter(([, t]) => !validType(t))
    for (const [k] of types)
      bad('INVALID_DOCUMENT', `Field "${k}" has an unknown type.`, [
        'fields',
        k,
      ])
    if (types.length) {
      lostSource = true
      continue
    }
    const source: DataSource = {
      name: basename(file, '.json'),
      fields: value.fields as DataSource['fields'],
      sample: [],
    }
    const rows = value.rows ?? []
    // The rows are the loader's to report (loadFiles); a source whose rows fail is declared without them.
    sources.push({
      ...source,
      sample: checkRows(source, rows).length ? [] : (rows as Row[]),
    })
  }
  const blocks: BlockDef[] = []
  const owner = new Map<string, string>()
  for (const file of names('blocks')) {
    const before = problems.length
    const { value, bad, at } = read(file)
    if (problems.length > before) continue
    if (!isObj(value)) {
      bad('INVALID_DOCUMENT', 'A block file must be an object.')
      continue
    }
    if ('onInsert' in value)
      bad(
        'POLICY_VIOLATION',
        'A block file cannot name a function: "onInsert".',
        ['onInsert'],
      )
    if (Array.isArray(value.settings))
      for (const [i, s] of value.settings.entries()) {
        const here: JsonPath = ['settings', i]
        if (!isObj(s)) {
          bad('INVALID_DOCUMENT', 'A setting must be an object.', here)
        } else if ('fn' in s)
          bad(
            'POLICY_VIOLATION',
            'A block file cannot name a function: "fn".',
            [...here, 'fn'],
          )
        else
          for (const [what, path] of settingProblems(s))
            bad('INVALID_DOCUMENT', `A setting needs ${what}.`, [
              ...here,
              ...(path[0]! in s ? path : []),
            ])
      }
    const need = (ok: boolean, what: string, path: JsonPath) => {
      if (!ok) bad('INVALID_DOCUMENT', `A block needs ${what}.`, path)
    }
    need(
      typeof value.id === 'string' && ID_RE.test(value.id),
      'an "id" of 1 to 20 lower-case letters and digits',
      ['id'],
    )
    need(
      Number.isInteger(value.version) && (value.version as number) >= 1,
      'a positive integer "version"',
      ['version'],
    )
    need(typeof value.name === 'string' && value.name !== '', 'a "name"', [
      'name',
    ])
    need(typeof value.category === 'string', 'a "category"', ['category'])
    need(Array.isArray(value.settings), '"settings" as a list', ['settings'])
    if (!Array.isArray(value.looks) || !value.looks.length)
      bad('INVALID_DOCUMENT', 'A block needs "looks" as a non-empty list.', [
        'looks',
      ])
    else
      for (const [i, l] of value.looks.entries()) {
        const here: JsonPath = ['looks', i]
        if (!isObj(l) || typeof l.id !== 'string' || !isObj(l.tree)) {
          bad('INVALID_DOCUMENT', 'A look needs an "id" and a "tree".', here)
          continue
        }
        const doc = emptySite('x', PLAIN)
        doc.pages[0]!.root = l.tree as Node
        for (const p of validateSite(doc, withSources(registry, sources))) {
          if (lostSource && p.code === 'UNKNOWN_SOURCE') continue
          const rest = (p.path ?? '')
            .replace(/^pages\.0\.root\.?/, '')
            .split('.')
            .filter(Boolean)
          const path: JsonPath = [
            ...here,
            'tree',
            ...rest.map(x => (/^\d+$/.test(x) ? +x : x)),
          ]
          bad(p.code, `${p.message}`, at(path) ? path : [...here, 'tree'])
        }
      }
    if (problems.length > before) continue
    const id = (value as unknown as BlockDef).id
    const taken = owner.get(id)
    if (taken || registry.block(id)) {
      bad(
        'INVALID_DOCUMENT',
        `Block "${id}" is already defined${taken ? ` in ${taken}` : ' by a plug-in'}.`,
        ['id'],
      )
      continue
    }
    owner.set(id, file)
    blocks.push(value as unknown as BlockDef)
  }
  try {
    registry.use({
      ...LOCAL,
      blocks,
      sources,
    })
  } catch (e) {
    problems.push({
      code: 'INVALID_DOCUMENT',
      message: `Local blocks and data were refused: ${e instanceof Error ? e.message : String(e)}`,
    })
  }
  return { registry, config, problems }
}
