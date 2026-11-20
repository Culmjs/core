import {
  hiddenAt,
  hiddenIndex,
  isRequired,
  textSizes,
  trees,
  walkWithAncestors,
  type HiddenWhy,
} from '../document/required.ts'
import type { Node, Problem, SiteDocument } from '../document/index.ts'
import { isObj } from '../document/rules.ts'

const policy = (
  rule: string,
  message: string,
  p: Partial<Problem>,
): Problem => ({
  code: 'POLICY_VIOLATION',
  message,
  rule,
  ...p,
})

/** Where the hiding is written, relative to the node that carries it. A reason from an override or a variant names no single path. */
const pathOf = (w: HiddenWhy) =>
  w.how === 'hide'
    ? `hide.${w.where}`
    : w.how === 'hidden'
      ? w.where === 'when'
        ? 'style.when'
        : `style.${w.where}.hidden`
      : undefined

/** A text has content when a run has text or a binding. */
const hasContent = (n: Node) => {
  const runs = isObj(n.props) ? n.props.runs : undefined
  return (
    Array.isArray(runs) &&
    runs.some(
      r =>
        isObj(r) &&
        ((typeof r.text === 'string' && r.text !== '') || isObj(r.bind)),
    )
  )
}

/** A required node that is hidden, and a required text with no content. Assumes a well-formed tree. */
export function checkRequired(doc: SiteDocument): Problem[] {
  const out: Problem[] = []
  const ix = hiddenIndex(doc)
  for (const [tree, root] of trees(doc)) {
    const comp = typeof tree === 'object' && 'component' in tree
    // A component's parts count only when an instance uses it; a part that a component prop fills supplies its text from there.
    let filled = new Set<string>()
    if (comp) {
      if (!ix.uses.has(tree.component)) continue
      filled = new Set(
        (ix.components.get(tree.component)?.props ?? [])
          .filter(p => p?.field === 'text')
          .flatMap(p => (p.part ? [p.part] : [])),
      )
    }
    walkWithAncestors(root, (n, up) => {
      let form: Node | undefined
      for (let i = up.length - 1; i >= 0 && !form; i--)
        if (up[i].kind === 'form') form = up[i]
      if (!isRequired(n, form)) return
      const why = hiddenAt(ix, tree, [...up, n])
      if (why) {
        const path = pathOf(why)
        out.push(
          policy(
            'required',
            `This block must stay on the page, but it is hidden${why.by === n.id ? '' : ` by "${why.by}"`}.`,
            { nodeId: n.id, ...(path ? { path } : {}) },
          ),
        )
      }
      if (n.kind === 'text' && !hasContent(n) && !filled.has(n.id))
        out.push(
          policy('required', 'This text must keep some text or a data field.', {
            nodeId: n.id,
            path: 'props.runs',
          }),
        )
    })
  }
  return out
}

/** Every text size outside the site's `textRange`; nothing when no range is set. */
export function checkTextRange(doc: SiteDocument): Problem[] {
  const r = doc.styles?.textRange
  if (!r) return []
  const out: Problem[] = []
  for (const s of textSizes(doc))
    if (s.size < r.min || s.size > r.max)
      out.push(
        policy(
          'textRange',
          `A text size of ${s.size} is outside the site's range of ${r.min} to ${r.max}.`,
          {
            ...(s.nodeId === undefined ? {} : { nodeId: s.nodeId }),
            path: s.path,
            allowed: [String(r.min), String(r.max)],
          },
        ),
      )
  return out
}
