import type { Node, SiteDocument } from '../document/index.ts'
import type { NodeRef, TreeRef } from './types.ts'

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

const replaceFirst = <T>(list: T[], is: (x: T) => boolean, to: (x: T) => T) => {
  const i = list.findIndex(is)
  return i < 0 ? list.slice() : list.map((x, j) => (j === i ? to(x) : x))
}

/** A new document with one root replaced (the first of two pages or components that share an id, the one `rootOf` reads); the rest is shared. An unknown tree returns the document unchanged. */
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
      pages: replaceFirst(
        doc.pages,
        p => p.id === tree.page,
        p => ({ ...p, root }),
      ),
    }
  if ('component' in tree)
    return {
      ...doc,
      components: replaceFirst(
        doc.components,
        c => c.id === tree.component,
        c => ({ ...c, root }),
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

/** A tree as a text: a page's id, `header`, `footer` or `component:<id>`. */
export const treeKey = (tree: TreeRef): string =>
  typeof tree === 'string'
    ? tree
    : 'page' in tree
      ? tree.page
      : `component:${tree.component}`

/**
 * The created nodes whose parent was not created in the same tree, each once as `"<tree>:<id>"`, in document order. A created
 * node that is no longer in the document (a later operation removed it) is left out.
 */
export function createdRoots(doc: SiteDocument, created: NodeRef[]): string[] {
  const made = new Set(created.map(c => `${treeKey(c.tree)}:${c.id}`))
  const out: string[] = []
  const go = (key: string, n: Node, parentMade: boolean) => {
    const here = made.has(`${key}:${n.id}`)
    if (here && !parentMade) out.push(`${key}:${n.id}`)
    for (const c of n.children ?? []) go(key, c, here)
  }
  for (const t of trees(doc)) go(treeKey(t.tree), t.root, false)
  return out
}
