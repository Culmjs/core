import type { Node, SiteDocument } from '../document/index.ts'
import type { Registry } from '../registry/index.ts'
import { unrollEnv, unrollInstances } from '../validate/unroll.ts'

/** The page's root (when the page exists), the header and the footer, each with its component instances unrolled: the trees the page is drawn from. */
export function unrolledTrees(
  doc: SiteDocument,
  pageId: string,
  registry?: Registry,
): Node[] {
  const env = unrollEnv(doc, registry?.kinds() ?? new Map())
  const page = doc.pages.find(p => p.id === pageId)?.root
  return [page, doc.header, doc.footer]
    .filter((r): r is Node => !!r)
    .map(r => unrollInstances(r, doc.components, env))
}
