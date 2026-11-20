import { canonicalJson, sha256 } from '../document/hash.ts'
import type { SiteDocument } from '../document/index.ts'
import type { Data } from '../data/query.ts'
import type { Registry } from '../registry/index.ts'

/** The framework version; a test holds it equal to the version in package.json. */
export const FRAMEWORK_VERSION = '0.0.0'

/**
 * One SHA-256 (lower-case hex) over the document, the rows and values, the framework version, every plug-in's name and version in name order, and the
 * font and asset files passed (sorted by path here). Pass the same rows the compiler gets: they are hashed as given, so the same rows in another order
 * are another build. Rows and values must be JSON values; ones that cannot be written as JSON (a cycle, a BigInt, nesting thousands deep) reject with an Error.
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
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  let text: string
  try {
    text = canonicalJson([
      doc,
      data.rows,
      data.values ?? null,
      FRAMEWORK_VERSION,
      plugins,
      sorted ?? null,
    ])
  } catch {
    throw new Error(
      'The build identity cannot be hashed: the document, rows or values cannot be written as JSON.',
    )
  }
  return sha256(text)
}
