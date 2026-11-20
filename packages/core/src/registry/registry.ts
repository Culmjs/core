import { KINDS } from '../document/index.ts'
import type { KindSpec } from '../document/index.ts'
import type { BlockDef, SettingFn } from './block.ts'
import { checkDeclaration } from './declaration.ts'
import type { Declaration } from './declaration.ts'
import type { DataSource } from './dataSource.ts'
import type { Rule } from './rule.ts'

export type Plugin = Declaration & {
  blocks?: BlockDef[]
  sources?: DataSource[]
  rules?: Rule[]
  kinds?: Record<string, KindSpec>
  settingFns?: Record<string, SettingFn>
}

export type Registry = {
  use(plugin: Plugin): void
  block(id: string): BlockDef | undefined
  blocks(): BlockDef[]
  source(name: string): DataSource | undefined
  sources(): DataSource[]
  rules(): Rule[]
  kinds(): ReadonlyMap<string, KindSpec>
  settingFn(name: string): SettingFn | undefined
  /** Each registered plug-in's name and version, in name order. */
  plugins(): { name: string; version: number }[]
}

const GUIDE_MAX = 500

export function createRegistry(): Registry {
  const plugins = new Map<string, number>()
  const blocks = new Map<string, BlockDef>()
  const sources = new Map<string, DataSource>()
  const rules = new Map<string, Rule>()
  const kinds = new Map<string, KindSpec>()
  const fns = new Map<string, SettingFn>()

  // Collects a plug-in's entries, refusing a name taken in `into`, in the core kinds, or earlier in the same plug-in.
  function stage<T>(
    what: string,
    into: Map<string, T>,
    entries: [string, T][],
    reserved?: object,
  ): Map<string, T> {
    const add = new Map<string, T>()
    for (const [name, v] of entries) {
      if (
        into.has(name) ||
        add.has(name) ||
        (reserved && Object.hasOwn(reserved, name))
      )
        throw new Error(`Duplicate ${what} "${name}".`)
      add.set(name, v)
    }
    return add
  }

  return {
    use(p) {
      const problems = checkDeclaration(p)
      if (problems.length)
        throw new Error(
          `Plug-in refused: ${problems.map(x => x.message).join(' ')}`,
        )
      if (plugins.has(p.name)) throw new Error(`Duplicate plug-in "${p.name}".`)
      // Stage everything first so a refused plug-in registers nothing.
      for (const [what, name, guide] of [
        ...(p.blocks ?? []).map(x => ['Block', x.id, x.guide] as const),
        ...(p.sources ?? []).map(x => ['Source', x.name, x.guide] as const),
      ])
        if (
          guide !== undefined &&
          (typeof guide !== 'string' || guide.length > GUIDE_MAX)
        )
          throw new Error(
            `${what} "${name}" has a guide that is not a string of at most ${GUIDE_MAX} characters.`,
          )
      const b = stage(
        'block',
        blocks,
        (p.blocks ?? []).map(x => [x.id, x]),
      )
      const s = stage(
        'source',
        sources,
        (p.sources ?? []).map(x => [x.name, x]),
      )
      const r = stage(
        'rule',
        rules,
        (p.rules ?? []).map(x => [x.name, x]),
      )
      const k = stage('kind', kinds, Object.entries(p.kinds ?? {}), KINDS)
      const f = stage(
        'setting function',
        fns,
        Object.entries(p.settingFns ?? {}),
      )
      plugins.set(p.name, p.version)
      for (const [m, add] of [
        [blocks, b],
        [sources, s],
        [rules, r],
        [kinds, k],
        [fns, f],
      ] as const)
        for (const [name, v] of add) (m as Map<string, unknown>).set(name, v)
    },
    block: id => blocks.get(id),
    blocks: () => [...blocks.values()],
    source: name => sources.get(name),
    sources: () => [...sources.values()],
    rules: () => [...rules.values()],
    kinds: () => new Map(kinds),
    settingFn: name => fns.get(name),
    plugins: () =>
      [...plugins]
        .map(([name, version]) => ({ name, version }))
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
  }
}
