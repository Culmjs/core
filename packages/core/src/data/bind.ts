import {
  MAX_NODES,
  walk,
  type Component,
  type ComponentProp,
  type FontRef,
  type KindSpec,
  type Node,
  type PropValue,
  type Ref,
  type Run,
  type SiteDocument,
  type SiteStyles,
} from '../document/index.ts'
import { MAX_ROWS } from '../document/kinds.ts'
import { UNSAFE_FIELDS, isObj } from '../document/rules.ts'
import {
  BIND_KEY,
  CONTROL_FIELDS,
  changeFor,
  applyOverride,
  runChange,
} from '../document/components.ts'
import { blockIds, resolvePart, retarget } from '../document/tree.ts'
import { touched } from '../document/samples.ts'
import type { Registry, Row } from '../registry/index.ts'
import { stylesOf } from '../style/siteStyles.ts'
import { overrideProblem } from '../validate/components.ts'
import { readRef, rowsOf, textOf, type Data } from './query.ts'

type Env = {
  fonts: FontRef[]
  styles: SiteStyles
  /** Plug-in kinds; core kinds are always known. */
  kinds?: ReadonlyMap<string, KindSpec>
}
/** Deepest nesting expanded, plain and through instances together. Far above `MAX_DEPTH`; past it nothing more is added and `over` is set, so no input can overflow the stack. */
const DEPTH_GUARD = 64
/** How much has been added so far, against `MAX_NODES`. */
type Budget = { n: number; over: boolean }

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

/** Writes a prop's value to its part, unless the check an override passes refuses it for that kind of part. */
function write(
  part: Node,
  p: ComponentProp,
  v: PropValue,
  env: Env,
  given = true,
) {
  if (p.run !== undefined) {
    // One run of the part's text: the value is that run's text (or link), the rest of the line stays.
    const change = runChange(part.props?.runs, p.run, p.field!, v)
    if (change && !overrideProblem(change, part.kind, env)) {
      part.props = {
        ...part.props,
        runs: (change.props as { runs: Run[] }).runs,
      }
      if (given) part.props = touched(part.props)
    }
    return
  }
  // How many a list shows is the list's own setting, not a style: a whole number from 1 to `MAX_ROWS`.
  if (p.field === 'limit') {
    if (
      part.repeat &&
      typeof v === 'number' &&
      Number.isInteger(v) &&
      v >= 1 &&
      v <= MAX_ROWS
    )
      part.repeat = { ...part.repeat, max: v }
    return
  }
  const path = CONTROL_FIELDS[p.field!].path
  const change = changeFor(p.field!, v, true)
  const val = path.reduce<unknown>(
    (o, k) => (o as Record<string, unknown>)[k],
    change,
  )
  if (overrideProblem(change, part.kind, env)) return
  let o = part as unknown as Record<string, unknown>
  for (const k of path.slice(0, -1))
    o = (o[k] ??= {}) as Record<string, unknown>
  o[path.at(-1)!] = val
  if (given && (p.field === 'text' || p.field === 'label') && part.props)
    part.props = touched(part.props)
}

/**
 * Contract: the tree and components have passed `validateSite`; behaviour on other input is undefined, except that a missing
 * component and a component cycle unroll to nothing and that recursion is bounded (past `DEPTH_GUARD` levels nothing more is
 * added and `state.over` is set).
 *
 * Replaces every instance with its component's tree: defaults, then the matching looks in order, then the instance's `set`,
 * its data bindings and its `overrides`. Parts become `<instanceId>.<partId>` (the root keeps the instance's id) and the
 * instance keeps its own slot, placement and hide. An unknown component or a cycle drops the instance. Parts are counted
 * before a master is copied: past `MAX_NODES` nothing more is added and `state.over` says so.
 */
export function unrollInstances(
  root: Node,
  components: Component[],
  env: Env,
  state: Budget = { n: 0, over: false },
): Node {
  const todo = [root]
  let any = false
  for (let w = todo.pop(); w && !any; w = todo.pop()) {
    any = w.kind === 'instance'
    if (Array.isArray(w.children)) todo.push(...w.children)
  }
  if (!any) return root
  const byId = new Map(components.map(c => [c.id, c]))
  // An instance that holds nothing but instances adds no parts, so uses are counted as well: no document makes more than MAX_NODES.
  let uses = 0

  const go = (w: Node, stack: string[], depth: number): Node | null => {
    if (depth > DEPTH_GUARD) return ((state.over = true), null)
    if (w.kind === 'instance') return one(w, stack, depth)
    return w.children
      ? {
          ...w,
          children: w.children.flatMap(k => go(k, stack, depth + 1) ?? []),
        }
      : w
  }

  const one = (inst: Node, stack: string[], depth: number): Node | null => {
    const c = byId.get(inst.component as string)
    if (!c || stack.includes(c.id) || state.over) return null
    if (++uses > MAX_NODES) return ((state.over = true), null)
    let size = 0
    let deep = false
    const todo: [Node, number][] = [[c.root, 1]]
    for (let t = todo.pop(); t && !deep; t = todo.pop()) {
      if (t[1] > DEPTH_GUARD) deep = true
      if (t[0].kind !== 'instance') size++
      if (Array.isArray(t[0].children))
        for (const k of t[0].children) todo.push([k, t[1] + 1])
    }
    if (deep) return ((state.over = true), null)
    if (state.n + size > MAX_NODES) return ((state.over = true), null)
    state.n += size
    const tree = structuredClone(c.root)
    const parts = new Map<string, Node>()
    walk(tree, x => void parts.set(x.id, x))
    const props = Array.isArray(c.props) ? c.props : []
    const set = isObj(inst.set) || Array.isArray(inst.set) ? inst.set : {}

    const values: Record<string, PropValue | undefined> = {}
    for (const p of props) {
      const given = Object.hasOwn(set, p.key) ? set[p.key] : undefined
      values[p.key] =
        p.type === 'choice'
          ? typeof given === 'string' && p.options?.includes(given)
            ? given
            : (p.default ?? p.options?.[0])
          : ((given as PropValue | undefined) ?? p.default)
    }
    const apply = (
      p: ComponentProp,
      v: PropValue | undefined,
      given = false,
    ) => {
      const part = p.part ? parts.get(p.part) : undefined
      if (
        part &&
        p.field &&
        v !== undefined &&
        Object.hasOwn(CONTROL_FIELDS, p.field)
      )
        write(part, p, v, env, given)
    }
    const plain = props.filter(p => p.type !== 'choice' && p.type !== 'slot')
    for (const p of plain) if (p.default !== undefined) apply(p, p.default)
    for (const v of Array.isArray(c.variants) ? c.variants : [])
      if (Object.entries(v.when).every(([k, val]) => values[k] === val))
        for (const [id, o] of Object.entries(v.patch)) {
          const part = parts.get(id)
          if (part && !overrideProblem(o, part.kind, env))
            applyOverride(part, o)
        }
    for (const p of plain)
      if (Object.hasOwn(set, p.key)) apply(p, set[p.key] as PropValue, true)
    let rootBound = false
    const binds =
      isObj(inst.bind) || Array.isArray(inst.bind)
        ? (inst.bind as Record<string, Ref>)
        : {}
    for (const [key, ref] of Object.entries(binds)) {
      const p = plain.find(x => x.key === key)
      const part = p?.part ? parts.get(p.part) : undefined
      if (!p || !part || !p.field) continue
      if (p.run !== undefined) {
        const runs = part.props?.runs as Run[] | undefined
        if (runs?.[p.run])
          runs[p.run] =
            p.field === 'link'
              ? { ...runs[p.run], bindHref: ref }
              : { ...runs[p.run], text: '', bind: ref }
      } else if (p.field === 'hidden') {
        part.showIf = ref
        if (part === tree) rootBound = true
      } else if (p.field === 'text')
        (part.props ??= {}).runs = [{ text: '', bind: ref }]
      else if (BIND_KEY[p.field])
        part.bind = { ...part.bind, [BIND_KEY[p.field]!]: ref }
    }
    const slots = props
      .filter(p => p.type === 'slot' && p.part && parts.has(p.part))
      .map(p => p.part!)
    const nested = go(tree, [...stack, c.id], depth + 1)
    if (!nested) return null
    // Overrides go on last, so one can reach a part inside a nested component by its unrolled id (`<nestedInstanceId>.<partId>`).
    // Each is held to the save check for the part's kind first; a lost, unresolvable or failing one is dropped, never applied.
    const all = new Map<string, Node>()
    walk(nested, x => void all.set(x.id, x))
    const overrides =
      isObj(inst.overrides) || Array.isArray(inst.overrides)
        ? inst.overrides
        : {}
    for (const [id, o] of Object.entries(overrides)) {
      const master = resolvePart(byId, c, id)
      const target = all.get(id)
      if (master && target && !overrideProblem(o, master.kind, env))
        applyOverride(target, o)
    }
    const out = blockIds(inst.id, nested)
    out.name = inst.name
    // The use's own states join the top part's (a name the master already holds stays the master's); its triggers replace the master's.
    if (Array.isArray(inst.state) && inst.state.length)
      out.state = [
        ...(out.state ?? []),
        ...inst.state.filter(s => !out.state?.some(m => m.name === s.name)),
      ]
    if (inst.on !== undefined) out.on = inst.on
    for (const k of [
      'slot',
      'hide',
      'placement',
      'showIf',
      'showIfAny',
      'locked',
    ] as const) {
      if (inst[k] === undefined) {
        // a show condition bound onto the top part stays
        if (!(k === 'showIf' && rootBound)) delete out[k]
      } else (out as Record<string, unknown>)[k] = inst[k]
    }
    // Slot children belong to the page, so they keep their own ids and go in after the parts are named.
    const kids = (inst.children ?? []).flatMap(
      k => go(k, stack, depth + 1) ?? [],
    )
    for (const id of slots) {
      const want = id === c.root.id ? inst.id : `${inst.id}.${id}`
      let hit: Node | undefined
      walk(out, x => void (x.id === want && (hit ??= x)))
      if (hit && kids.length) hit.children = [...(hit.children ?? []), ...kids]
    }
    return out
  }

  return go(root, [], 1) ?? root
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
  // Triggers are renamed per copy, so each copy owns its list.
  if (w.on) out.on = structuredClone(w.on)
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
  const at = w.kind === 'table' ? kids.length - 1 : 0
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

/**
 * Internal (used by the `detach` operation, not exported from the layer): the one `instance` of the document unrolled with the
 * environment `expand` builds (the registry's plug-in kinds, the document's fonts and styles). Nested instances unroll too.
 * An instance of a missing component, or of a cycle, comes back unchanged.
 */
export function unrollOne(
  doc: SiteDocument,
  registry: Registry,
  instance: Node,
): Node {
  return unrollInstances(instance, doc.components, {
    fonts: doc.fonts,
    styles: stylesOf(doc),
    kinds: registry.kinds(),
  })
}
