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
import { find, resolvePart } from '../document/tree.ts'
import type { Registry } from '../registry/index.ts'
import { dropSamples } from '../document/samples.ts'
import { unrollEnv, unrollInstances } from './unroll.ts'

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

/**
 * Known characters that the letter, number, punctuation and symbol classes include but that draw nothing: the Hangul fillers
 * (U+115F, U+1160, U+3164, U+FFA0), the Braille blank (U+2800) and the musical null notehead (U+1D159). A list of the ones
 * known, not a claim that there are no others.
 */
const INVISIBLE = '\u115F\u1160\u3164\uFFA0\u2800\u{1D159}'
/** A character a reader sees: a letter, a number, punctuation or a symbol, other than `INVISIBLE`. Combining marks alone, format, control and private-use characters do not count. */
const VISIBLE = new RegExp(`(?![${INVISIBLE}])[\\p{L}\\p{N}\\p{P}\\p{S}]`, 'u')

/** A run counts as content when it has a binding or a character a reader sees in its `text`. A `math` run never counts: whether the compiler draws it is decided by its parser, in the compile layer. */
const runHas = (r: unknown) =>
  isObj(r) &&
  ((typeof r.text === 'string' && VISIBLE.test(r.text)) || isObj(r.bind))

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
  return `style.when.${i}.decl.hidden`
}

/** Where an unrolled node sits: `top`, a node of the source tree (the node itself, or the outermost instance it is a part of), and `rest`, the part's id inside it. */
type Loc = { top: string; rest: string }

/** `nodeId` and `path` for a node at `l`, and the field `rel` on it when the value sits there. */
const place = (l: Loc, rel?: string) => {
  const path = l.rest ? `parts.${l.rest}${rel ? `.${rel}` : ''}` : rel
  return { nodeId: l.top, ...(path === undefined ? {} : { path }) }
}

/**
 * The header, the footer and each page, unrolled as compile unrolls them (no data): `over` when the unroll stopped at
 * `MAX_NODES`, `own` the source tree's nodes by id, and `required(n, up)` for an unrolled node and its ancestors: `isRequired`
 * with the enclosing form, or the instance's own `required: true` (an unrolled root keeps the instance's id but not its mark).
 */
function* views(doc: SiteDocument, registry: Registry) {
  const env = unrollEnv(doc, registry.kinds())
  const byId = new Map<string, Component>(doc.components.map(c => [c.id, c]))
  const roots: [string, Node][] = [
    ...doc.pages.map(p => [`pages.${p.id}`, p.root] as [string, Node]),
    ['header', doc.header],
    ['footer', doc.footer],
  ]
  for (const [where, root] of roots) {
    const own = new Map<string, Node>()
    walkWithAncestors(root, x => void own.set(x.id, x))
    const state = { n: 0, over: false }
    const tree = unrollInstances(root, doc.components, env, state)
    // A block's parts are page nodes with dotted ids (`b1.title`), so a part of an instance is found by the shortest prefix of its id that is an instance of the source tree.
    const locate = (id: string): Loc => {
      if (own.has(id)) return { top: id, rest: '' }
      const segs = id.split('.')
      for (let k = 1; k < segs.length; k++) {
        const top = segs.slice(0, k).join('.')
        if (own.get(top)?.kind === 'instance')
          return { top, rest: segs.slice(k).join('.') }
      }
      return { top: id, rest: '' }
    }
    const marked = (id: string) => {
      const { top, rest } = locate(id)
      const inst = own.get(top)
      if (!rest) return inst?.kind === 'instance' && inst.required === true
      const comp = inst && byId.get(inst.component as string)
      const src = comp && resolvePart(byId, comp, rest)
      return src?.kind === 'instance' && src.required === true
    }
    const required = (n: Node, up: readonly Node[]) => {
      let form: Node | undefined
      for (let i = up.length - 1; i >= 0 && !form; i--)
        if (up[i].kind === 'form') form = up[i]
      return isRequired(n, form) || marked(n.id)
    }
    yield { where, root, tree, over: state.over, own, required, locate }
  }
}

/**
 * Required content and the text range, judged on the trees the page is built from: the header, the footer and each page with
 * every instance unrolled by `unrollInstances`, as compile does. Whatever an instance, its properties, its looks and the
 * instances around it do to a part is already in that tree, so a node is hidden when it or an ancestor carries `hide` or
 * `hidden: true` there. A component nobody uses is in no tree and is not judged. Assumes a well-formed document.
 *
 * A node the document holds under its own id (a page node, or the root of an unrolled instance, which keeps the instance's
 * id) is reported at that id. A part of an instance (`<instance>.<part>`, at any depth) is reported at the outermost
 * instance, with the path `parts.<the rest of the id>`. A `path` is always on the node named: it ends in the field only when
 * the value sits on the node itself; for a hiding on an ancestor the message names the ancestor.
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
  for (const { where, root, tree, over, own, required: isReq, locate } of views(
    doc,
    registry,
  )) {
    // Past `MAX_NODES` the unroll stops adding, and compile builds the page cut. A cut tree is not judged as if it were whole:
    // one problem when it holds required content, which the cut may leave out; none otherwise (stage 1 keeps it valid).
    if (over) {
      if (!holds(root)) continue
      add(required, {
        code: 'RESOURCE_LIMIT_EXCEEDED',
        message: `The ${where === 'header' || where === 'footer' ? where : 'page'} is cut at the element limit once its components are filled in, and it holds required content that may be cut.`,
        rule: 'required',
        path: where,
      })
      continue
    }
    /** The component master that writes the hiding `rel` the unrolled node `h` shows, when the master part itself carries it. */
    const writtenIn = (h: Node, rel: string) => {
      const l = locate(h.id)
      const inst = own.get(l.top)
      const rest = l.rest ? l.rest.split('.') : []
      // an instance's own `hide` is the use's, never the master's (the unroll keeps only the use's)
      if (!rest.length && rel.startsWith('hide.')) return undefined
      let c =
        inst?.kind === 'instance'
          ? byId.get(inst.component as string)
          : undefined
      let x = c?.root
      for (const seg of rest) {
        if (x?.kind === 'instance') {
          c = byId.get(x.component as string)
          x = c?.root
        }
        x = c && x && find(c.root, seg)
      }
      // the root of a nested use is the inner master's root, but its own `hide` is written on the use
      if (x?.kind === 'instance' && !rel.startsWith('hide.')) {
        c = byId.get(x.component as string)
        x = c?.root
      }
      return c && x && hiddenPath(x) === rel ? { c, x } : undefined
    }
    const what = (n: Node) => {
      const l = locate(n.id)
      return l.rest ? `The part "${l.rest}" of "${l.top}"` : 'This block'
    }
    walkWithAncestors(tree, (n, up) => {
      for (const s of nodeSizes(n))
        if (outside(s.size))
          add(
            sizes,
            policy(
              'textRange',
              `A text size of ${s.size} is outside the site's range of ${range!.min} to ${range!.max}${locate(n.id).rest ? ` (the part "${n.id}")` : ''}.`,
              { ...place(locate(n.id), s.path), allowed },
            ),
          )
      if (!isReq(n, up)) return
      const by = [n, ...[...up].reverse()].find(a => hiddenPath(a))
      if (by) {
        const rel = hiddenPath(by)!
        const m = writtenIn(by, rel)
        add(
          required,
          policy(
            'required',
            `${what(n)} must stay on the page, but it is hidden${by === n ? '' : ` by "${by.id}"`}.${
              m
                ? ` The hiding is written in the component itself (components.${m.c.id}, the part "${m.x.id}", ${rel}), so changing it there fixes every use.`
                : ''
            }`,
            place(locate(n.id), by === n ? rel : undefined),
          ),
        )
      }
      if (n.kind === 'text' && !hasContent(n))
        add(
          required,
          policy(
            'required',
            `${what(n)} must keep some text or a data field.`,
            place(locate(n.id), 'props.runs'),
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

/** The required nodes of each uncut tree, and those of them the live page keeps (`dropSamples`), as `<tree>|<unrolled id>`. */
function liveRequired(doc: SiteDocument, registry: Registry) {
  const required = new Map<string, { l: Loc; text: boolean }>()
  const kept = new Set<string>()
  for (const v of views(doc, registry)) {
    // a cut tree is refused by `checkShown` when it holds required content
    if (v.over) continue
    const mine = new Set<string>()
    walkWithAncestors(v.tree, (n, up) => {
      if (!v.required(n, up)) return
      mine.add(n.id)
      required.set(`${v.where}|${n.id}`, {
        l: v.locate(n.id),
        text: n.kind === 'text',
      })
    })
    walkWithAncestors(dropSamples(v.tree), n => {
      if (mine.has(n.id)) kept.add(`${v.where}|${n.id}`)
    })
  }
  return { required, kept }
}

/**
 * The first node that was required and kept on the live page in `before` and, still required in `after`, is left out of it
 * by `dropSamples`: a text marked as a sample or as the block's own wording, or a box that holds a sample and nothing the
 * owner put there. One check for every operation, so no reading of what the marks mean is repeated here.
 */
export function droppedRequired(
  before: SiteDocument,
  after: SiteDocument,
  registry: Registry,
): Problem | undefined {
  let was: Set<string>
  let now: ReturnType<typeof liveRequired>
  try {
    was = liveRequired(before, registry).kept
    now = liveRequired(after, registry)
  } catch {
    // a document that cannot be unrolled is not the expected shape: validation reports it, and there is nothing to compare
    return undefined
  }
  for (const k of was)
    if (now.required.has(k) && !now.kept.has(k)) {
      const { l, text } = now.required.get(k)!
      const id = k.slice(k.indexOf('|') + 1)
      return policy(
        'required',
        text
          ? `"${id}" must stay on the live page, but after this change the page would leave it out as sample text. Write its words again with setText in the same batch, or through a block setting that reads them.`
          : `"${id}" must stay on the live page, but after this change it would hold only sample text, which the live page leaves out with it. Give it content that is not a placeholder in the same batch (write one of the sample texts in it with setText). For a form or field, a person can also opt it out with setRequired false.`,
        place(l),
      )
    }
  return undefined
}
