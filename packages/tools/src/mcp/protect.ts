import {
  find,
  isRequired,
  type Node,
  type Problem,
  type SiteDocument,
} from '@culmjs/core'
import type { Allow } from '@culmjs/core/ops'

const veto = (message: string, rule: string, more: Partial<Problem> = {}) =>
  ({ code: 'POLICY_VIOLATION', message, rule, ...more }) as Problem

/** The root of a tree of `doc`, or undefined. */
function rootOf(doc: SiteDocument, tree: unknown): Node | undefined {
  if (tree === 'header' || tree === 'footer') return doc[tree]
  const t = tree as { page?: string; component?: string } | null
  if (typeof t?.page === 'string')
    return doc.pages?.find(p => p.id === t.page)?.root
  if (typeof t?.component === 'string')
    return doc.components?.find(c => c.id === t.component)?.root
  return undefined
}

/** Whether the node `id` of `root` is required, by core's rule (`isRequired`, with its enclosing form). */
function required(root: Node, id: string): boolean {
  let out = false
  const go = (n: Node, form?: Node): void => {
    if (n.id === id) out = isRequired(n, form)
    for (const c of n.children ?? []) go(c, n.kind === 'form' ? n : form)
  }
  go(root)
  return out
}

/**
 * The default guard (`allow`): the mark `required` cannot be taken off a node that has it, and the site's text size range cannot be
 * removed or widened. Everything else, `restore` included, is allowed; core already refuses removing or hiding a required node.
 */
export const protect: Allow = (op, doc) => {
  if (op.op === 'setRequired' && op.required !== true) {
    const root = rootOf(doc, op.tree)
    if (root && find(root, op.id) && required(root, op.id))
      return veto(
        `"${op.id}" is required; its mark cannot be taken off.`,
        'protected',
        { nodeId: op.id, path: 'required' },
      )
  }
  if (
    op.op === 'setSiteStyles' &&
    typeof op.styles === 'object' &&
    op.styles !== null &&
    'textRange' in op.styles
  ) {
    const was = doc.styles?.textRange
    const now = op.styles.textRange
    if (was && (now === null || now === undefined || typeof now !== 'object'))
      return veto('The text size range cannot be removed.', 'textRange', {
        path: 'styles.textRange',
      })
    if (
      was &&
      ((now?.min ?? was.min) < was.min || (now?.max ?? was.max) > was.max)
    )
      return veto(
        `The text size range ${was.min} to ${was.max} cannot be widened.`,
        'textRange',
        { path: 'styles.textRange' },
      )
  }
  return undefined
}
