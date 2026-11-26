import { canonicalJson, sha256 } from '../document/hash.ts'
import type { Node, SiteDocument } from '../document/index.ts'
import type { Data } from '../data/query.ts'
import type { GpuEffectDef, Registry } from '../registry/index.ts'
import { decodeBase64, sha256BytesHex } from '../registry/sha256.ts'

function collectUsedGpu(doc: SiteDocument): {
  active: boolean
  names: Set<string>
} {
  const names = new Set<string>()
  let active = (doc.customEffects?.length ?? 0) > 0
  const seen = new Set<unknown>()
  function walk(node: Node | undefined) {
    if (!node || typeof node !== 'object' || seen.has(node)) return
    seen.add(node)
    const m = (node as { motion?: { gpu?: string } }).motion
    if (m && typeof m === 'object' && 'gpu' in m && typeof m.gpu === 'string') {
      active = true
      names.add(m.gpu)
    }
    if (Array.isArray(node.children)) for (const c of node.children) walk(c)
  }
  for (const p of doc.pages ?? []) walk(p?.root)
  walk(doc.header)
  walk(doc.footer)
  for (const c of Object.values(doc.components ?? {})) walk(c?.root)
  return { active, names }
}

function gpuIdentity(doc: SiteDocument, registry: Registry) {
  const cap = registry.gpu
  if (!cap?.enabled) return undefined
  const { active, names } = collectUsedGpu(doc)
  if (!active) return undefined
  const registered = registry
    .effects()
    .filter((e): e is GpuEffectDef => e.tier === 3 && names.has(e.name))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map(e => {
      let modHash: string | null = null
      if (e.wasm) {
        try {
          modHash = sha256BytesHex(decodeBase64(e.wasm.bytesBase64))
        } catch {
          modHash = null
        }
      }
      return [e.name, modHash, cap.isReviewed(e)]
    })
  const custom = [...(doc.customEffects ?? [])]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map(c => [c.name, cap.isReviewed(c)])
  return [registered, custom]
}

/** The framework version; a test holds it equal to the version in package.json. */
export const FRAMEWORK_VERSION = '0.0.0'

/**
 * One SHA-256 (lower-case hex) over the document, the rows and values, the framework version, every plug-in's name and version in name order, and the
 * font and asset files passed (sorted by path, then by hash, so the same set of pairs in any order is the same build). Pass the same rows the compiler
 * gets: they are hashed as given, so the same rows in another order are another build.
 *
 * What is hashed is the JSON form of the rows and values (`canonicalJson`), not the values themselves, so a value JSON cannot represent does not tell
 * two builds apart: a function or `undefined` in an object is left out, a `Date` is its ISO text, a `Map` or a `Set` is `{}`, and `values: null` is the
 * same as no `values`. Rows are the caller's and are not checked. A value that cannot be written as JSON at all (a cycle, a BigInt, nesting thousands
 * deep) rejects with an Error.
 */
export async function buildIdentity(
  doc: SiteDocument,
  data: Data,
  registry: Registry,
  files?: readonly { path: string; sha256: string }[],
): Promise<string> {
  const plugins = registry.plugins().map(p => [p.name, p.version])
  const sorted = files
    ?.map(f => [f.path, f.sha256])
    .sort(([a, x], [b, y]) =>
      a < b ? -1 : a > b ? 1 : x < y ? -1 : x > y ? 1 : 0,
    )
  const gpu = gpuIdentity(doc, registry)
  let text: string
  try {
    text = canonicalJson([
      doc,
      data.rows,
      data.values ?? null,
      FRAMEWORK_VERSION,
      plugins,
      sorted ?? null,
      ...(gpu ? [gpu] : []),
    ])
  } catch {
    throw new Error(
      'The build identity cannot be hashed: the document, rows or values cannot be written as JSON.',
    )
  }
  return sha256(text)
}
