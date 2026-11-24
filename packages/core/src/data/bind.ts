import {
  MAX_NODES,
  walk,
  type Component,
  type FontRef,
  type KindSpec,
  type Node,
  type Ref,
  type Run,
  type SiteStyles,
} from '../document/index.ts'
import { UNSAFE_FIELDS, isObj } from '../document/rules.ts'
import { retarget, templateIndex } from '../document/tree.ts'
import type { Row } from '../registry/index.ts'
import {
  DEPTH_GUARD,
  unrollInstances,
  type Budget,
} from '../validate/unroll.ts'
import { readRef, rowsOf, textOf, type Data } from './query.ts'

export { unrollInstances }

// ponytail: `isObj` refuses arrays; expand has always taken an array in these places as an object whose keys are its indexes (unvalidated input only), so the sites that read keys or spread keep `|| Array.isArray`.

/** A bound value as a setting: a string, a finite number or a boolean as it is; anything else is an empty text. */
const scalar = (v: unknown): string | number | boolean =>
  typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))
    ? v
    : textOf(v)

const empty = (v: unknown) =>
  v === '' || v == null || (Array.isArray(v) && v.length === 0)
/** A show condition is false at an empty value; for a value the caller supplies, also at `false` and 0, so a block can hide over a flag or an empty count. */
const hidden = (r: Ref, v: unknown) =>
  empty(v) || (r.from === 'site' && (v === false || v === 0))

function suffix(w: Node, n: number) {
  const inside = new Set<string>()
  walk(w, x => void inside.add(x.id))
  // A button that opens a layer in the same copy follows it to the copy's new id.
  walk(w, x => {
    const o = x.props?.opens
    if (typeof o === 'string' && inside.has(o)) x.props!.opens = `${o}~${n}`
  })
  const renamed = new Map([...inside].map(id => [id, `${id}~${n}`]))
  walk(w, x => retarget(x, renamed))
  walk(w, x => void (x.id = `${x.id}~${n}`))
  return w
}

type Pass = {
  data: Data
  values: Record<string, unknown>
  /** The enclosing rows, innermost first. */
  items: readonly Row[]
  seen: Budget
}

function node(w: Node, c: Pass, depth: number): Node | null {
  if (depth > DEPTH_GUARD) return ((c.seen.over = true), null)
  const scope = { items: c.items, values: c.values }
  // `showIf` and `showIfAny` together read as "or": the node goes when every one of those fields is empty.
  const conds = [
    w.showIf,
    ...(Array.isArray(w.showIfAny) ? w.showIfAny : []),
  ].filter((r): r is Ref => isObj(r) || Array.isArray(r))
  if (
    c.seen.over ||
    (conds.length && conds.every(r => hidden(r, readRef(r, scope))))
  )
    return null
  // Count each node as it is built, so nested repeats cannot grow past the limit before it is noticed.
  if (++c.seen.n > MAX_NODES) return ((c.seen.over = true), null)
  const out: Node = { ...w }
  delete out.repeat
  delete out.bind
  delete out.showIfAny
  if (w.props) out.props = { ...w.props }
  // Internal targets are renamed per copy, so each copy owns its programs.
  if (w.on) out.on = structuredClone(w.on)
  if (w.motion) out.motion = structuredClone(w.motion)
  if (isObj(w.bind) || Array.isArray(w.bind))
    for (const [k, ref] of Object.entries(w.bind)) {
      if (UNSAFE_FIELDS.includes(k) || k === 'runs') continue
      const v = readRef(ref, scope)
      ;(out.props ??= {})[k] = (
        k === 'link' ? { url: textOf(v) } : scalar(v)
      ) as never
      // a label or summary that comes from data is never a sample, whatever mark the stored node carries
      if ((k === 'label' || k === 'summary') && out.props.sample === true)
        out.props.sample = false
    }
  // A text with a connected value is data, whatever mark it carries.
  if (
    out.props?.sample === true &&
    Array.isArray(out.props.runs) &&
    (out.props.runs as Run[]).some(r => isObj(r) && (r.bind || r.bindHref))
  )
    out.props.sample = false
  if (out.props && Array.isArray(out.props.runs))
    out.props.runs = (out.props.runs as Run[]).map(run => {
      if (!(isObj(run) || Array.isArray(run))) return run
      const { bind: b, bindHref: bh, ...r } = run
      if (b) {
        r.text = textOf(readRef(b, scope))
        r.fromData = true
      }
      const url = bh ? readRef(bh, scope) : undefined
      if (typeof url === 'string' && url) r.link = { url }
      return r
    })
  const kids = Array.isArray(w.children) ? w.children : []
  const build = (list: Node[]) =>
    list.map(k => node(k, c, depth + 1)).filter((k): k is Node => !!k)
  const repeat = w.repeat
  if (!repeat) {
    if (Array.isArray(w.children)) out.children = build(kids)
    return out
  }
  if (repeat.marker && out.props?.marker === undefined)
    (out.props ??= {}).marker = repeat.marker
  // A table repeats its last row and keeps earlier rows as headers; otherwise the first child repeats.
  const at = templateIndex(w)
  const tpl = kids[at]
  out.children = build(kids.slice(0, at))
  if (tpl) {
    const source =
      typeof repeat.source === 'string'
        ? Object.hasOwn(c.data.rows, repeat.source)
          ? c.data.rows[repeat.source]
          : []
        : readRef(repeat.source, scope)
    const rows = rowsOf(source as unknown[], repeat, scope)
    // One bounded copy at a time; the multiplied template list is never built.
    for (let n = 0; n < rows.length && !c.seen.over; n++) {
      if (c.seen.n >= MAX_NODES) {
        c.seen.over = true
        break
      }
      const copy = node(tpl, { ...c, items: [rows[n], ...c.items] }, depth + 1)
      if (copy) out.children.push(suffix(copy, n))
    }
  }
  return out
}

/**
 * Contract: `root` and `ctx.components` have passed `validateSite`; behaviour on other input is undefined, except that a missing
 * component and a component cycle expand to nothing and that recursion is bounded: no input overflows the stack, and nesting past
 * `DEPTH_GUARD` stops with `over: true`. `ctx.kinds` are the registry's plug-in kinds.
 *
 * Unrolls instances, drops nodes whose `showIf` fields are empty, writes bound values into props and runs, and repeats list and table
 * templates over the caller's rows (ids of copies take `~n`). Stops adding nodes at `MAX_NODES` and says so in `over`.
 * Rows come from `data.rows`, and a `site` reference reads `data.values` by its whole dotted name.
 */
export function expand(
  root: Node,
  ctx: {
    kinds?: ReadonlyMap<string, KindSpec>
    data: Data
    components: Component[]
    fonts: FontRef[]
    styles: SiteStyles
  },
): { tree: Node; count: number; depth: number; over: boolean } {
  const seen: Budget = { n: 0, over: false }
  const unroll: Budget = { n: 0, over: false }
  const unrolled = unrollInstances(
    root,
    ctx.components,
    { fonts: ctx.fonts, styles: ctx.styles, kinds: ctx.kinds },
    unroll,
  )
  const top: Node = { ...unrolled }
  delete top.showIf
  delete top.showIfAny
  const tree = node(
    top,
    {
      data: ctx.data,
      values: ctx.data.values ?? {},
      items: [],
      seen,
    },
    1,
  )!
  seen.over ||= unroll.over
  let count = 0
  let depth = 0
  walk(tree, (_w, _p, d) => {
    count++
    depth = Math.max(depth, d + 1)
  })
  return { tree, count, depth, over: seen.over }
}
