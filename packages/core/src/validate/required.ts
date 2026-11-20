import {
  isRequired,
  nodeSizes,
  reasonOf,
  textSizes,
  walkWithAncestors,
} from '../document/required.ts'
import type {
  Component,
  Node,
  Problem,
  SiteDocument,
} from '../document/index.ts'
import { isObj } from '../document/rules.ts'
import { resolvePart } from '../document/tree.ts'
import type { Registry } from '../registry/index.ts'
import { stylesOf } from '../style/siteStyles.ts'
import { unrollInstances } from './unroll.ts'

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

/** A run counts as content when it has a binding or some text that is not only whitespace. */
const runHas = (r: unknown) =>
  isObj(r) &&
  ((typeof r.text === 'string' && r.text.trim() !== '') || isObj(r.bind))

/** A text has content when a run has text or a binding. */
const hasContent = (n: Node) => {
  const runs = isObj(n.props) ? n.props.runs : undefined
  return Array.isArray(runs) && runs.some(runHas)
}

/** Where `hide` or `hidden: true` sits on a node, or nothing. */
function hiddenPath(n: Node): string | undefined {
  const r = reasonOf(n)
  if (!r) return undefined
  if (r.how === 'hide') return `hide.${r.where}`
  if (r.where !== 'when') return `style.${r.where}.hidden`
  const i = (n.style?.when ?? []).findIndex(w => w?.decl?.hidden === true)
  return `style.when.${i}.hidden`
}

/**
 * Required content and the text range, judged on the trees the page is built from: the header, the footer and each page with
 * every instance unrolled by `unrollInstances`, as compile does. Whatever an instance, its properties, its looks and the
 * instances around it do to a part is already in that tree, so a node is hidden when it or an ancestor carries `hide` or
 * `hidden: true` there. A component nobody uses is in no tree and is not judged. Assumes a well-formed document.
 *
 * A node the document holds under its own id (a page node, or the root of an unrolled instance, which keeps the instance's
 * id) is reported at that id. A part of an instance (`<instance>.<part>`, at any depth) is reported at the outermost
 * instance, with the path `parts.<the rest of the id>.<where on the part>`.
 */
export function checkShown(doc: SiteDocument, registry: Registry): Problem[] {
  const required: Problem[] = []
  const sizes: Problem[] = []
  const seen = new Set<string>()
  const add = (out: Problem[], p: Problem) => {
    const k = JSON.stringify([p.rule, p.nodeId, p.path])
    if (!seen.has(k)) {
      seen.add(k)
      out.push(p)
    }
  }
  const range = doc.styles?.textRange
  const allowed = range ? [String(range.min), String(range.max)] : []
  const outside = (s: number) => !!range && (s < range.min || s > range.max)
  const env = {
    fonts: doc.fonts,
    styles: stylesOf(doc),
    kinds: registry.kinds(),
  }
  const byId = new Map<string, Component>(doc.components.map(c => [c.id, c]))
  /** Whether a tree holds required content: a required node, or an instance (at any depth) of a component that holds some. */
  const memo = new Map<string, boolean>()
  const holds = (root: Node, stack: readonly string[] = []): boolean => {
    let found = false
    walkWithAncestors(root, (n, up) => {
      if (found) return
      const form = [...up].reverse().find(a => a.kind === 'form')
      if (isRequired(n, form)) found = true
      else if (n.kind === 'instance' && typeof n.component === 'string') {
        const c = byId.get(n.component)
        if (!c || stack.includes(c.id)) return
        if (!memo.has(c.id)) memo.set(c.id, holds(c.root, [...stack, c.id]))
        found = memo.get(c.id)!
      }
    })
    return found
  }
  const roots: [string, Node][] = [
    ...doc.pages.map(p => [`pages.${p.id}`, p.root] as [string, Node]),
    ['header', doc.header],
    ['footer', doc.footer],
  ]
  for (const [where, root] of roots) {
    // The instances of this tree by id: an unrolled instance root keeps the instance's id, but not its `required` mark.
    const own = new Map<string, Node>()
    walkWithAncestors(root, x => void own.set(x.id, x))
    const state = { n: 0, over: false }
    const tree = unrollInstances(root, doc.components, env, state)
    // Past `MAX_NODES` the unroll stops adding, and compile builds the page cut. A cut tree is not judged as if it were whole:
    // one problem when it holds required content, which the cut may leave out; none otherwise (stage 1 keeps it valid).
    if (state.over) {
      if (!holds(root)) continue
      add(required, {
        code: 'RESOURCE_LIMIT_EXCEEDED',
        message: `The ${where === 'header' || where === 'footer' ? where : 'page'} is cut at the element limit once its components are filled in, and it holds required content that may be cut.`,
        rule: 'required',
        path: where,
      })
      continue
    }
    /** The instance's own `required: true`, for the root of an unrolled instance at any depth. */
    const marked = (id: string) => {
      const [top, ...rest] = id.split('.')
      const inst = own.get(top)
      if (!rest.length)
        return inst?.kind === 'instance' && inst.required === true
      const comp = inst && byId.get(inst.component as string)
      const src = comp && resolvePart(byId, comp, rest.join('.'))
      return src?.kind === 'instance' && src.required === true
    }
    /** `nodeId` and `path` for a value at `rel` on `at`, reported for the required node `n`. */
    const place = (n: Node, at: Node, rel: string) => {
      const top = n.id.split('.')[0]
      return {
        nodeId: top,
        path: at.id.startsWith(`${top}.`)
          ? `parts.${at.id.slice(top.length + 1)}.${rel}`
          : rel,
      }
    }
    const what = (n: Node) => {
      const i = n.id.indexOf('.')
      return i < 0
        ? 'This block'
        : `The part "${n.id.slice(i + 1)}" of "${n.id.slice(0, i)}"`
    }
    walkWithAncestors(tree, (n, up) => {
      for (const s of nodeSizes(n))
        if (outside(s.size))
          add(
            sizes,
            policy(
              'textRange',
              `A text size of ${s.size} is outside the site's range of ${range!.min} to ${range!.max}${n.id.includes('.') ? ` (the part "${n.id}")` : ''}.`,
              { ...place(n, n, s.path), allowed },
            ),
          )
      let form: Node | undefined
      for (let i = up.length - 1; i >= 0 && !form; i--)
        if (up[i].kind === 'form') form = up[i]
      if (!isRequired(n, form) && !marked(n.id)) return
      const by = [n, ...[...up].reverse()].find(a => hiddenPath(a))
      if (by)
        add(
          required,
          policy(
            'required',
            `${what(n)} must stay on the page, but it is hidden${by === n ? '' : ` by "${by.id}"`}.`,
            place(n, by, hiddenPath(by)!),
          ),
        )
      if (n.kind === 'text' && !hasContent(n))
        add(
          required,
          policy(
            'required',
            `${what(n)} must keep some text or a data field.`,
            place(n, n, 'props.runs'),
          ),
        )
    })
  }
  // Named text styles are not in any tree.
  for (const s of textSizes(doc))
    if (s.nodeId === undefined && outside(s.size))
      add(
        sizes,
        policy(
          'textRange',
          `A text size of ${s.size} is outside the site's range of ${range!.min} to ${range!.max}.`,
          { path: s.path, allowed },
        ),
      )
  return [...required, ...sizes]
}
