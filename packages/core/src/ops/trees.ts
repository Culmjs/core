import type { Node, SiteDocument } from '../document/index.ts'
import type { TreeRef } from './types.ts'

/** An object with exactly one key, `page` or `component`. */
const oneKey = (
  tree: unknown,
): tree is { page: string } | { component: string } => {
  if (typeof tree !== 'object' || tree === null) return false
  const k = Object.keys(tree)
  return k.length === 1 && (k[0] === 'page' || k[0] === 'component')
}

/** The root of a tree; undefined for an unknown page or component and for anything that is not one of the four forms. */
export function rootOf(doc: SiteDocument, tree: TreeRef): Node | undefined {
  if (tree === 'header') return doc.header
  if (tree === 'footer') return doc.footer
  if (!oneKey(tree)) return undefined
  if ('page' in tree) return doc.pages.find(p => p.id === tree.page)?.root
  if ('component' in tree)
    return doc.components.find(c => c.id === tree.component)?.root
  return undefined
}

/** A new document with one root replaced; the rest is shared. An unknown tree returns the document unchanged. */
export function withRoot(
  doc: SiteDocument,
  tree: TreeRef,
  root: Node,
): SiteDocument {
  if (tree === 'header') return { ...doc, header: root }
  if (tree === 'footer') return { ...doc, footer: root }
  if (!oneKey(tree)) return doc
  if ('page' in tree)
    return {
      ...doc,
      pages: doc.pages.map(p => (p.id === tree.page ? { ...p, root } : p)),
    }
  if ('component' in tree)
    return {
      ...doc,
      components: doc.components.map(c =>
        c.id === tree.component ? { ...c, root } : c,
      ),
    }
  return doc
}

/** Header, footer, pages in order, components in order. */
export function trees(doc: SiteDocument): { tree: TreeRef; root: Node }[] {
  return [
    { tree: 'header', root: doc.header },
    { tree: 'footer', root: doc.footer },
    ...doc.pages.map(p => ({ tree: { page: p.id }, root: p.root })),
    ...doc.components.map(c => ({
      tree: { component: c.id },
      root: c.root,
    })),
  ]
}
