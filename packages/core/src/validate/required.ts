import {
  hiddenAt,
  hiddenIndex,
  isRequired,
  textSizes,
  trees,
  walkWithAncestors,
  type HiddenWhy,
} from '../document/required.ts'
import type {
  ComponentProp,
  Node,
  Problem,
  SiteDocument,
} from '../document/index.ts'
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

const runHas = (r: unknown) =>
  isObj(r) && ((typeof r.text === 'string' && r.text !== '') || isObj(r.bind))

/** A text has content when a run has text or a binding. */
const hasContent = (n: Node) => {
  const runs = isObj(n.props) ? n.props.runs : undefined
  return Array.isArray(runs) && runs.some(runHas)
}

/** Whether an instance gives a property a value, as `expand` applies it: a binding, a non-empty `set`, or (when not set) a non-empty default. */
const supplies = (inst: Node, p: ComponentProp) => {
  if (isObj(inst.bind) && isObj(inst.bind[p.key])) return true
  if (isObj(inst.set) && Object.hasOwn(inst.set, p.key))
    return typeof inst.set[p.key] === 'string' && inst.set[p.key] !== ''
  return typeof p.default === 'string' && p.default !== ''
}

/** A required node that is hidden, and a required text with no content. Assumes a well-formed tree. */
export function checkRequired(doc: SiteDocument): Problem[] {
  const out: Problem[] = []
  const ix = hiddenIndex(doc)
  for (const [tree, root] of trees(doc)) {
    const cid =
      typeof tree === 'object' && 'component' in tree
        ? tree.component
        : undefined
    const comp = cid !== undefined
    // A component's parts count only when an instance uses it.
    const uses = cid === undefined ? undefined : ix.uses.get(cid)
    if (comp && !uses) continue
    const textProps = comp
      ? (ix.components.get(cid ?? '')?.props ?? []).filter(
          p => isObj(p) && p.field === 'text' && p.part,
        )
      : []
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
      if (n.kind !== 'text') return
      const mine = textProps.filter(p => p.part === n.id)
      if (!mine.length) {
        if (!hasContent(n))
          out.push(
            policy(
              'required',
              'This text must keep some text or a data field.',
              { nodeId: n.id, path: 'props.runs' },
            ),
          )
        return
      }
      // A property fills the part (or one run of it): each instance must give it a value unless the master already has one.
      const runs =
        isObj(n.props) && Array.isArray(n.props.runs) ? n.props.runs : []
      for (const p of mine) {
        const own = p.run === undefined ? hasContent(n) : runHas(runs[p.run])
        if (own) continue
        for (const u of uses ?? []) {
          const inst = u.path[u.path.length - 1]
          if (!supplies(inst, p))
            out.push(
              policy(
                'required',
                `The text "${n.id}" of the component "${cid}" must keep some text, and this use gives its property "${p.key}" none.`,
                { nodeId: inst.id, path: `set.${p.key}` },
              ),
            )
        }
      }
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
