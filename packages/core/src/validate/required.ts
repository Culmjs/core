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
  Component,
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

/**
 * The runs the page shows for a part of `comp` in one `inst`. The order is the one `unrollInstances` (data/bind.ts) follows;
 * validate cannot import it, so keep the two in step (a test in required.spec.ts compares them):
 * master runs, property defaults, matching variants' patches, the instance's `set`, its `bind`, its `overrides`.
 */
function shownRuns(part: Node, comp: Component, inst: Node): unknown[] {
  let runs: unknown[] =
    isObj(part.props) && Array.isArray(part.props.runs) ? part.props.runs : []
  const props = (comp.props ?? []).filter(isObj)
  const mine = props.filter(p => p.field === 'text' && p.part === part.id)
  const set = isObj(inst.set) ? inst.set : {}
  const bind = isObj(inst.bind) ? inst.bind : {}
  const text = (p: ComponentProp, v: unknown) => {
    if (typeof v !== 'string') return
    if (p.run === undefined) runs = [{ text: v }]
    else if (isObj(runs[p.run])) {
      const r = { ...(runs[p.run] as Record<string, unknown>) }
      delete r.bind
      delete r.bindHref
      runs = runs.map((x, i) => (i === p.run ? { ...r, text: v } : x))
    }
  }
  for (const p of mine) if (p.default !== undefined) text(p, p.default)
  const values: Record<string, unknown> = {}
  for (const p of props) {
    const given = Object.hasOwn(set, p.key) ? set[p.key] : undefined
    values[p.key] =
      p.type === 'choice'
        ? typeof given === 'string' && p.options?.includes(given)
          ? given
          : (p.default ?? p.options?.[0])
        : (given ?? p.default)
  }
  const patched = (o: unknown) =>
    isObj(o) && isObj(o.props) && Array.isArray(o.props.runs)
      ? (o.props.runs as unknown[])
      : undefined
  for (const v of comp.variants ?? [])
    if (
      isObj(v) &&
      isObj(v.when) &&
      Object.entries(v.when).every(([k, val]) => values[k] === val)
    )
      runs = patched(isObj(v.patch) ? v.patch[part.id] : undefined) ?? runs
  for (const p of mine) if (Object.hasOwn(set, p.key)) text(p, set[p.key])
  for (const p of mine) {
    const ref = bind[p.key]
    if (!isObj(ref)) continue
    if (p.run === undefined) runs = [{ text: '', bind: ref }]
    else if (isObj(runs[p.run]))
      runs = runs.map((x, i) =>
        i === p.run ? { ...(x as object), text: '', bind: ref } : x,
      )
  }
  const over = isObj(inst.overrides) ? inst.overrides[part.id] : undefined
  return patched(over) ?? runs
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
    // A component's parts count only when an instance uses it.
    const uses = cid === undefined ? undefined : ix.uses.get(cid)
    if (cid !== undefined && !uses) continue
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
      const owner = cid === undefined ? undefined : ix.components.get(cid)
      if (!owner) {
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
      // Judged by the text each use of the component shows.
      const key = (owner.props ?? []).find(
        p => isObj(p) && p.field === 'text' && p.part === n.id,
      )?.key
      for (const u of uses ?? []) {
        const inst = u.path[u.path.length - 1]
        if (!shownRuns(n, owner, inst).some(runHas))
          out.push(
            policy(
              'required',
              `The text "${n.id}" of the component "${cid}" must keep some text, and this use shows none.`,
              {
                nodeId: inst.id,
                path:
                  key === undefined
                    ? `overrides.${n.id}.props.runs`
                    : `set.${key}`,
              },
            ),
          )
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
