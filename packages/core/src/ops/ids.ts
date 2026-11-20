import type { Node, SiteDocument } from '../document/index.ts'
import { rootOf, trees } from './trees.ts'
import type { TreeRef } from './types.ts'

const collect = (n: Node, into: Set<string>) => {
  into.add(n.id)
  for (const c of n.children ?? []) collect(c, into)
}

/** The lowest `n<k>` ids unused in the id space of `tree`: header, footer and pages share one, a component has its own. */
export function nextIds(
  doc: SiteDocument,
  tree: TreeRef,
  count: number,
): string[] {
  const used = new Set<string>()
  if (typeof tree === 'object' && tree !== null && 'component' in tree) {
    const root = rootOf(doc, tree)
    if (root) collect(root, used)
  } else
    for (const t of trees(doc))
      if (typeof t.tree === 'string' || 'page' in t.tree) collect(t.root, used)
  const out: string[] = []
  for (let k = 1; out.length < count; k++)
    if (!used.has(`n${k}`)) out.push(`n${k}`)
  return out
}
