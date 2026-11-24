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
import { DEPTH_GUARD, MAX_ROWS } from '../document/kinds.ts'
import { isObj } from '../document/rules.ts'
import {
  BIND_KEY,
  CONTROL_FIELDS,
  changeFor,
  applyOverride,
  runChange,
} from '../document/components.ts'
import { blockIds, resolvePart } from '../document/tree.ts'
import { touched } from '../document/samples.ts'
import { stylesOf } from '../style/siteStyles.ts'
import { overrideProblem } from './components.ts'

/** The environment of an unroll for a document: its fonts and styles, and the registry's plug-in kinds (no data). One place builds it for validation and `detach`. */
export const unrollEnv = (
  doc: Pick<SiteDocument, 'fonts' | 'styles' | 'look'>,
  kinds: ReadonlyMap<string, KindSpec>,
): Env => ({ fonts: doc.fonts, styles: stylesOf(doc), kinds })

type Env = {
  fonts: FontRef[]
  styles: SiteStyles
  /** Plug-in kinds; core kinds are always known. */
  kinds?: ReadonlyMap<string, KindSpec>
  /** Detach needs checked local references before this master's ids change. */
  masterRoot?: (root: Node) => Node
}
export { DEPTH_GUARD }
/** How much has been added so far, against `MAX_NODES`. */
export type Budget = { n: number; over: boolean }

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
  // A default or instance value belongs to the stored document. Later bindings can edit its runs.
  o[path.at(-1)!] = typeof val === 'object' ? structuredClone(val) : val
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
    const tree = structuredClone(env.masterRoot?.(c.root) ?? c.root)
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
    // The use's motion addresses its own slot content, not the master's local part ids.
    if (inst.motion !== undefined) out.motion = structuredClone(inst.motion)
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
