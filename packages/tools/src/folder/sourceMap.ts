import type { Problem, TreeRef } from '@culmjs/core'
import type { JsonPath, Place } from './jsonc.ts'
import type { ShaderFiles } from './shaders.ts'

export type Origin = {
  file: string
  path: JsonPath
  form: 'node' | 'short' | 'in-short' | 'use' | 'in-piece'
  /** the id is in the file */
  written: boolean
}
type Spot = { file: string; line: number; column: number }
export type SourceMap = {
  origin(tree: TreeRef, id: string): Origin | undefined
  locate(tree: TreeRef, id: string, field?: string): Spot | undefined
  locateProblem<P extends Problem>(p: P): P & Partial<Omit<Spot, never>>
  pageFile(pageId: string): string | undefined
  pieceFile(componentId: string): string | undefined
}

export const treeKey = (t: TreeRef): string =>
  typeof t === 'string'
    ? t
    : 'page' in t
      ? `page:${t.page}`
      : `component:${t.component}`

const steps = (dotted: string): JsonPath =>
  dotted.split('.').map(s => (/^\d+$/.test(s) ? +s : s))
const SITE_KEYS = [
  'name',
  'look',
  'fonts',
  'styles',
  'languages',
  'centreMaxWidth',
  'customEffects',
]

/** What the loader recorded, as the lookups of {@link SourceMap}. `at` finds a place in a parsed file. */
export type Recorded = {
  origins: Map<string, Origin>
  /** node id -> its trees; document trees come before components */
  trees: Map<string, TreeRef[]>
  /** page id -> file, in the order of the pages list */
  pages: Map<string, string>
  pieces: Map<string, string>
  shaders?: ShaderFiles[]
  at(file: string, path: JsonPath): Place | undefined
}

export function makeSourceMap(r: Recorded): SourceMap {
  const origin = (tree: TreeRef, id: string) =>
    r.origins.get(`${treeKey(tree)}|${id}`)
  // The nearest place that exists: a path the file lacks falls back to its parent.
  const spot = (file: string, path: JsonPath): Spot => {
    for (let n = path.length; n >= 0; n--) {
      const p = r.at(file, path.slice(0, n))
      if (p) return { file, line: p.line, column: p.column }
    }
    return { file, line: 1, column: 1 }
  }
  // A part of an instance (`visit1.line`) has no entry of its own: the outermost instance is where it comes from.
  const find = (tree: TreeRef, id: string) => {
    const own = origin(tree, id)
    if (own) return { o: own, exact: true }
    const segs = id.split('.')
    for (let k = 1; k < segs.length; k++) {
      const o = origin(tree, segs.slice(0, k).join('.'))
      if (o?.form === 'use') return { o, exact: false }
    }
    return undefined
  }
  const locate: SourceMap['locate'] = (tree, id, field) => {
    const hit = find(tree, id)
    if (!hit) return undefined
    const { o, exact } = hit
    if (!exact || o.form === 'in-short' || !field) return spot(o.file, o.path)
    return spot(
      o.file,
      o.form === 'short' || o.form === 'use'
        ? [...o.path, field]
        : [...o.path, ...steps(field)],
    )
  }
  // Ids are expected unique across header, footer and pages, though duplicates are preserved to avoid clobbering.
  const treesOf = (id: string): TreeRef[] => {
    const segs = id.split('.')
    for (let k = segs.length; k >= 1; k--) {
      const list = r.trees.get(segs.slice(0, k).join('.'))
      if (list?.length) return list
    }
    return []
  }
  const hintedTree = (
    path?: string,
  ): { tree: TreeRef; rest?: string } | undefined => {
    if (!path) return undefined
    const segs = path.split('.')
    if (segs[0] === 'header' || segs[0] === 'footer')
      return { tree: segs[0], rest: segs.slice(1).join('.') || undefined }
    if (segs[0] === 'pages' && segs[1] !== undefined) {
      const pageId = /^\d+$/.test(segs[1])
        ? [...r.pages.keys()][+segs[1]]
        : segs[1]
      if (pageId)
        return {
          tree: { page: pageId },
          rest: segs.slice(2).join('.') || undefined,
        }
    }
    return undefined
  }
  return {
    origin,
    locate,
    pageFile: id => r.pages.get(id),
    pieceFile: id => r.pieces.get(id),
    locateProblem(p) {
      if (p.nodeId !== undefined) {
        const candidates = treesOf(p.nodeId)
        const hint = hintedTree(p.path)
        const tree =
          (hint && candidates.find(c => treeKey(c) === treeKey(hint.tree))) ??
          candidates[0]
        const rawField =
          hint &&
          tree === candidates.find(c => treeKey(c) === treeKey(hint?.tree))
            ? hint.rest
            : p.path
        const where =
          tree &&
          locate(
            tree,
            p.nodeId,
            rawField?.startsWith('parts.') ? undefined : rawField,
          )
        return where ? { ...p, ...where } : p
      }
      const segs = p.path?.split('.') ?? []
      if (segs[0] === 'customEffects' && segs[1] !== undefined) {
        const origin = r.shaders?.[Number(segs[1])]
        if (origin) {
          if (segs[2] === 'source')
            return {
              ...p,
              file: origin.source,
              line: p.shaderLine ?? 1,
              column: 1,
            }
          return { ...p, ...spot(origin.descriptor, segs.slice(2)) }
        }
      }
      if (SITE_KEYS.includes(segs[0] ?? ''))
        return { ...p, ...spot('site.json', steps(p.path!)) }
      if (segs[0] === 'pages' && segs[1] !== undefined) {
        const file = /^\d+$/.test(segs[1])
          ? [...r.pages.values()][+segs[1]]
          : r.pages.get(segs[1])
        if (file)
          return {
            ...p,
            ...spot(
              file,
              steps(segs.slice(2).join('.')).filter(s => s !== ''),
            ),
          }
      }
      return p
    },
  }
}
