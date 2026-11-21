import { createRequire } from 'node:module'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRegistry } from '@culmjs/core'
import type { BlockDef, DataSource, Problem, Registry } from '@culmjs/core'
import { parseFile, type JsonPath } from './jsonc.ts'

export type Located = Problem & {
  file?: string
  line?: number
  column?: number
}
export type ProjectConfig = { plugins: string[]; out: string }

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

export async function loadPlugins(
  dir: string,
  files: ReadonlyMap<string, string>,
): Promise<{ registry: Registry; config: ProjectConfig; problems: Located[] }> {
  const registry = createRegistry()
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
    for (const e of f.errors)
      problems.push({
        code: 'INVALID_DOCUMENT',
        message: `Invalid JSON: ${e.message}.`,
        file,
        line: e.line,
        column: e.column,
      })
    return { value: f.value, bad }
  }

  if (!files.has('culm.json'))
    problems.push({
      code: 'INVALID_DOCUMENT',
      message: 'culm.json is missing.',
      file: 'culm.json',
    })
  else {
    const { value, bad } = read('culm.json')
    if (!isObj(value)) bad('INVALID_DOCUMENT', 'culm.json must be an object.')
    else {
      const { plugins, out } = value
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
          try {
            const path = createRequire(join(dir, 'package.json')).resolve(name)
            const mod = (await import(pathToFileURL(path).href)) as {
              default?: never
            }
            registry.use(mod.default as never)
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
          relative(dir, resolve(dir, out)) !== ''
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
  const names = (dirName: string) =>
    [...files.keys()]
      .filter(k => new RegExp(`^${dirName}/[^/]+\\.json$`).test(k))
      .sort()
  const blocks: BlockDef[] = []
  for (const file of names('blocks')) {
    const { value, bad } = read(file)
    if (!isObj(value)) {
      bad('INVALID_DOCUMENT', 'A block file must be an object.')
      continue
    }
    let ok = true
    if ('onInsert' in value) {
      bad(
        'POLICY_VIOLATION',
        'A block file cannot name a function: "onInsert".',
        ['onInsert'],
      )
      ok = false
    }
    if (Array.isArray(value.settings))
      for (const [i, s] of value.settings.entries())
        if (isObj(s) && 'fn' in s) {
          bad(
            'POLICY_VIOLATION',
            'A block file cannot name a function: "fn".',
            ['settings', i, 'fn'],
          )
          ok = false
        }
    if (ok) blocks.push(value as unknown as BlockDef)
  }
  const sources: DataSource[] = []
  for (const file of names('data')) {
    const { value, bad } = read(file)
    if (!isObj(value) || !isObj(value.fields)) {
      bad(
        'INVALID_DOCUMENT',
        'A data file needs "fields".',
        isObj(value) ? [] : [],
      )
      continue
    }
    sources.push({
      name: basename(file, '.json'),
      fields: value.fields as DataSource['fields'],
      sample: Array.isArray(value.rows) ? value.rows : [],
    })
  }
  try {
    registry.use({
      name: 'local',
      version: 1,
      api: [1],
      runs: ['load', 'edit', 'build'],
      trust: 'declarative',
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
