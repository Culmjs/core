import {
  hiddenAt,
  hiddenIndex,
  hiddenViaUse,
  looksOf,
  isRequired,
  nodeSizes,
  outerChains,
  reasonOf,
  textSizes,
  trees,
  walkWithAncestors,
  type HiddenWhy,
  type Outer,
} from '../document/required.ts'
import type {
  Component,
  ComponentProp,
  Node,
  Override,
  Problem,
  Run,
  SiteDocument,
} from '../document/index.ts'
import { isObj } from '../document/rules.ts'
import {
  CONTROL_FIELDS,
  applyOverride,
  changeFor,
  runChange,
} from '../document/components.ts'

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
const pathOf = (w: Pick<HiddenWhy, 'how' | 'where'>) =>
  w.how === 'hide'
    ? `hide.${w.where}`
    : w.how === 'hidden'
      ? w.where === 'when'
        ? 'style.when'
        : `style.${w.where}.hidden`
      : undefined

/** A run counts as content when it has a binding or some text that is not only whitespace. */
const runHas = (r: unknown) =>
  isObj(r) &&
  ((typeof r.text === 'string' && r.text.trim() !== '') || isObj(r.bind))

/** A text has content when a run has text or a binding. */
const hasContent = (n: Node) => {
  const runs = isObj(n.props) ? n.props.runs : undefined
  return Array.isArray(runs) && runs.some(runHas)
}

/** A component property that writes to a part, with its place in the component's list. */
type Mine = { p: ComponentProp; i: number }
/** The properties that write to each part, in list order. Choice and slot properties write nothing (`unrollInstances` skips them). */
const minesOf = (comp: Component): Map<string, Mine[]> => {
  const out = new Map<string, Mine[]>()
  ;(Array.isArray(comp.props) ? comp.props : []).forEach((p, i) => {
    if (!isObj(p) || p.type === 'choice' || p.type === 'slot') return
    if (typeof p.part !== 'string') return
    out.set(p.part, [...(out.get(p.part) ?? []), { p, i }])
  })
  return out
}

/** What `shownPart` reads of one use of a component, worked out once per use. */
type Use = {
  comp: Component
  inst: Node
  mines: Map<string, Mine[]>
  set: Record<string, unknown>
  /** the variants that apply to this use, by place in the component's list */
  looks: number[]
}
const useOf = (comp: Component, inst: Node, mines = minesOf(comp)): Use => {
  const set =
    isObj(inst.set) || Array.isArray(inst.set)
      ? (inst.set as Record<string, unknown>)
      : {}
  return { comp, inst, mines, set, looks: looksOf(comp, inst) }
}

/** Where a change to the part came from, in the order `unrollInstances` applies them. */
type Source =
  | { by: 'master' }
  | { by: 'default'; i: number }
  | { by: 'variant'; i: number }
  | { by: 'set'; key: string; inst: Node }
  | { by: 'bind'; inst: Node }
  | { by: 'override'; key: string; inst: Node }
type Stage = { source: Source; node: Node }

/** A node whose props, hide and style objects are its own, so a change to them leaves the original alone. */
const fork = (n: Node): Node => ({
  ...n,
  ...(isObj(n.props) ? { props: { ...n.props } } : {}),
  ...(isObj(n.hide) ? { hide: { ...n.hide } } : {}),
  ...(isObj(n.style) ? { style: { ...n.style } } : {}),
})

/** `bind.ts`' `write`, without its save check (validation holds the same values to it elsewhere): a property's value on its part, through `changeFor` and `runChange`. */
function writeProp(node: Node, p: ComponentProp, v: unknown): Node {
  if (p.run !== undefined) {
    const change = runChange(node.props?.runs, p.run, p.field!, v)
    return change
      ? {
          ...node,
          props: {
            ...node.props,
            runs: (change.props as { runs: Run[] }).runs,
          },
        }
      : node
  }
  // How many a list shows says nothing about hiding, content or size.
  if (p.field === 'limit') return node
  const path = CONTROL_FIELDS[p.field!].path
  const val = path.reduce<unknown>(
    (o, k) => (o as Record<string, unknown>)[k],
    changeFor(p.field!, v, true),
  )
  const at = (o: unknown, d: number): unknown => ({
    ...(isObj(o) ? o : {}),
    [path[d]]:
      d === path.length - 1
        ? val
        : at((o as Record<string, unknown>)?.[path[d]], d + 1),
  })
  return at(node, 0) as Node
}

const writes = (p: ComponentProp, v: unknown) =>
  p.field !== undefined &&
  v !== undefined &&
  Object.hasOwn(CONTROL_FIELDS, p.field)

/**
 * Every state of `part` on the way to the page, for one use of its component: the master, then what each step of
 * `unrollInstances` (data/bind.ts) does to it, in its order, listing a step only when it changed something:
 * 1. each property that writes to the part, with its `default`;
 * 2. each variant that applies, through `applyOverride` (shared with bind.ts);
 * 3. the instance's `set` values;
 * 4. the instance's `bind` on a property. A text takes it as its content. A `hidden` property bound to data becomes a show
 *    condition, and a bound `fontSize` writes nothing: data cannot be judged, so both are out of reach, like `showIf`;
 * 5. the instance's `overrides` entry for the part, then those of the instances further out (`outer`, innermost first).
 * A change `unrollInstances` would drop for failing the save check is applied here too: validation refuses it elsewhere.
 */
function stagesOf(part: Node, use: Use, outer: readonly Outer[] = []): Stage[] {
  let node = fork(part)
  const out: Stage[] = [{ source: { by: 'master' }, node }]
  const push = (source: Source, next: Node) => {
    node = next
    out.push({ source, node })
  }
  const mine = use.mines.get(part.id) ?? []
  for (const { p, i } of mine)
    if (writes(p, p.default))
      push({ by: 'default', i }, writeProp(node, p, p.default))
  for (const i of use.looks) {
    const v = use.comp.variants[i]
    const o =
      isObj(v.patch) && Object.hasOwn(v.patch, part.id)
        ? v.patch[part.id]
        : undefined
    if (isObj(o)) push({ by: 'variant', i }, patched(node, o))
  }
  for (const { p } of mine)
    if (Object.hasOwn(use.set, p.key) && writes(p, use.set[p.key]))
      push(
        { by: 'set', key: p.key, inst: use.inst },
        writeProp(node, p, use.set[p.key]),
      )
  const binds =
    isObj(use.inst.bind) || Array.isArray(use.inst.bind) ? use.inst.bind : {}
  const plain = (Array.isArray(use.comp.props) ? use.comp.props : []).filter(
    p => isObj(p) && p.type !== 'choice' && p.type !== 'slot',
  )
  for (const [key, ref] of Object.entries(binds)) {
    const p = plain.find(x => x.key === key)
    if (!p || p.part !== part.id || !p.field) continue
    const runs = node.props?.runs as Run[] | undefined
    if (p.run !== undefined) {
      if (Array.isArray(runs) && runs[p.run])
        push(
          { by: 'bind', inst: use.inst },
          {
            ...node,
            props: {
              ...node.props,
              runs: runs.map((r: Run, i: number) =>
                i !== p.run
                  ? r
                  : p.field === 'link'
                    ? { ...r, bindHref: ref }
                    : { ...r, text: '', bind: ref },
              ),
            },
          },
        )
    } else if (p.field === 'text')
      push(
        { by: 'bind', inst: use.inst },
        { ...node, props: { ...node.props, runs: [{ text: '', bind: ref }] } },
      )
  }
  const given = (inst: Node, key: string) => {
    const all =
      isObj(inst.overrides) || Array.isArray(inst.overrides)
        ? inst.overrides
        : {}
    const o = Object.hasOwn(all, key)
      ? (all as Record<string, unknown>)[key]
      : undefined
    if (isObj(o)) push({ by: 'override', key, inst }, patched(node, o))
  }
  given(use.inst, part.id)
  // The root of a nested use is the nested instance itself: an outer instance names it by the instance's id alone.
  for (const o of outer)
    given(o.inst, part.id === use.comp.root.id ? o.via : `${o.via}.${part.id}`)
  return out
}

const patched = (n: Node, o: Record<string, unknown>): Node => {
  const w = fork(n)
  applyOverride(w, o as Override)
  return w
}

/**
 * The part as the page shows it for one use of its component: a copy of `part` with everything `inst` does to it applied
 * (see `stagesOf`). The one place validation reads the unroll rules from; a test pins it against `unrollInstances`.
 */
export function shownPart(
  part: Node,
  comp: Component,
  inst: Node,
  outer: readonly Outer[] = [],
): Node {
  return stagesOf(part, useOf(comp, inst), outer).at(-1)!.node
}

/** The value at a dotted path of a node (`style.when.0.decl.size`). */
const valueAt = (n: unknown, path: string): unknown =>
  path
    .split('.')
    .reduce<unknown>(
      (o, k) =>
        isObj(o) || Array.isArray(o)
          ? (o as Record<string, unknown>)[k]
          : undefined,
      n,
    )

/** How many `when` layers a node has. */
const whens = (n: Node) =>
  isObj(n.style) && Array.isArray(n.style.when) ? n.style.when.length : 0

/**
 * Where a stage put something: the problem's `nodeId` and `path`, `rel` being the path inside the part as the stage wrote it.
 * A property's default and a variant's patch belong to the component, so they name no node.
 */
function placeOf(
  st: Stage,
  before: Node,
  comp: Component,
  partId: string,
  rel: string,
): { nodeId?: string; path: string } | undefined {
  const s = st.source
  // `when` layers are appended, so the index inside the patch is the shown index less the layers there already were.
  const own = rel.replace(
    /^style\.when\.(\d+)/,
    (_, k) => `style.when.${Number(k) - whens(before)}`,
  )
  switch (s.by) {
    case 'set':
      return { nodeId: s.inst.id, path: `set.${s.key}` }
    case 'default':
      return { path: `components.${comp.id}.props.${s.i}.default` }
    case 'variant':
      return {
        path: `components.${comp.id}.variants.${s.i}.patch.${partId}.${own}`,
      }
    case 'override':
      return { nodeId: s.inst.id, path: `overrides.${s.key}.${own}` }
    default:
      return undefined
  }
}

/**
 * Where a hiding written by a stage is reported, for a part hidden for one use: the use that causes it and the place on it.
 * A property's default and a look belong to the component, so the use is named with the property it can set to undo them.
 * Hidden in the component's own tree (the master stage) names the node, as for any node hidden in its own tree.
 */
function hidePlace(
  st: Stage,
  before: Node,
  use: Use,
  partId: string,
  rel: string,
  node: string,
): { nodeId?: string; path?: string; look?: string } | undefined {
  const s = st.source
  if (s.by === 'master') return { nodeId: node, ...(rel ? { path: rel } : {}) }
  if (s.by === 'default')
    return {
      nodeId: use.inst.id,
      path: `set.${(use.comp.props[s.i] as ComponentProp).key}`,
    }
  if (s.by === 'variant') {
    const when = (use.comp.variants[s.i] as { when: Record<string, unknown> })
      .when
    const [key, value] = Object.entries(when)[0] ?? []
    return {
      nodeId: use.inst.id,
      ...(key === undefined ? {} : { path: `set.${key}` }),
      look: key === undefined ? `look ${s.i + 1}` : `${key} = ${String(value)}`,
    }
  }
  return placeOf(st, before, use.comp, partId, rel)
}

/** The refusal when too many ways reach a part of a component for its uses to be checked: never a silent pass. */
const tooMany = (cid: string, part: string, rule: string): Problem => ({
  code: 'RESOURCE_LIMIT_EXCEEDED',
  message: `The part "${part}" of the component "${cid}" is reached in too many ways through other components for all its uses to be checked.`,
  rule,
  nodeId: part,
})

/** A required node that is hidden, and a required text with no content. Assumes a well-formed tree. */
export function checkRequired(doc: SiteDocument): Problem[] {
  const out: Problem[] = []
  const seen = new Set<string>()
  const add = (p: Problem) => {
    const k = JSON.stringify([p.rule, p.nodeId, p.path, p.message])
    if (!seen.has(k)) {
      seen.add(k)
      out.push(p)
    }
  }
  const ix = hiddenIndex(doc)
  const minesCache = new Map<Component, Map<string, Mine[]>>()
  const mines = (c: Component) => {
    let m = minesCache.get(c)
    if (!m) minesCache.set(c, (m = minesOf(c)))
    return m
  }
  for (const [tree, root] of trees(doc)) {
    const cid =
      typeof tree === 'object' && 'component' in tree
        ? tree.component
        : undefined
    // A component's parts count only when an instance uses it.
    const uses = cid === undefined ? undefined : ix.uses.get(cid)
    if (cid !== undefined && !uses) continue
    const owner = cid === undefined ? undefined : ix.components.get(cid)
    // The ways each use of a component is shown, worked out once per tree.
    let over = false
    const views = (uses ?? []).flatMap(u => {
      const c = outerChains(ix, u)
      over ||= c.over
      return c.chains.map(outer => ({
        use: useOf(owner!, u.path[u.path.length - 1], mines(owner!)),
        outer,
      }))
    })
    // A required instance, or content in an instance's slot, is hidden by what the use does to the component's root or to the
    // slot host and the parts above it. Judged as the page shows them, for every way the instance is reached.
    const inside = (n: Node, up: readonly Node[]) => {
      for (const a of [n, ...[...up].reverse()]) {
        const comp =
          a.kind === 'instance' && typeof a.component === 'string'
            ? ix.components.get(a.component)
            : undefined
        const u = comp && ix.uses.get(comp.id)?.find(x => x.path.at(-1) === a)
        if (!comp || !u) continue
        // the parts that carry the page node: the root for the instance itself, the slot host and its ancestors for slot content
        const carriers: Node[][] = []
        if (a === n) carriers.push([comp.root])
        else
          for (const p of Array.isArray(comp.props) ? comp.props : [])
            if (isObj(p) && p.type === 'slot' && typeof p.part === 'string')
              walkWithAncestors(comp.root, (x, above) => {
                if (x.id === p.part) carriers.push([...above, x])
              })
        if (!carriers.length) continue
        const c = outerChains(ix, u)
        if (c.over) add(tooMany(comp.id, n.id, 'required'))
        const use = useOf(comp, a, mines(comp))
        for (const outer of c.chains)
          for (const chain of carriers)
            for (const part of chain) {
              const st = stagesOf(part, use, outer)
              const i = st.findIndex(x => reasonOf(x.node))
              if (i < 0 || !reasonOf(st[st.length - 1].node)) continue
              const r = reasonOf(st[i].node)!
              const place = hidePlace(
                st[i],
                st[i - 1]?.node ?? st[i].node,
                use,
                part.id,
                pathOf(r) ?? '',
                a.id,
              )
              if (place) {
                const { look, ...at } = place
                add(
                  policy(
                    'required',
                    `${
                      a === n
                        ? `The block "${n.id}" must stay on the page, but ${look ? `the look "${look}"` : 'this use'} hides the root of the component "${comp.id}"`
                        : `The block "${n.id}" sits in the slot of "${a.id}", but ${look ? `the look "${look}"` : 'this use'} hides "${part.id}" of the component "${comp.id}"`
                    }.`,
                    at,
                  ),
                )
              }
            }
      }
    }
    walkWithAncestors(root, (n, up) => {
      let form: Node | undefined
      for (let i = up.length - 1; i >= 0 && !form; i--)
        if (up[i].kind === 'form') form = up[i]
      if (!isRequired(n, form)) return
      if (over) add(tooMany(cid!, n.id, 'required'))
      // In a component the part's own hiding is judged per use below (a toggle can show a part its master hides);
      // here only a use, or an ancestor of one, that is itself hidden.
      const why = owner
        ? hiddenViaUse(ix, tree, [...up, n])
        : hiddenAt(ix, tree, [...up, n])
      if (why) {
        const path = pathOf(why)
        // Through a use: the node that carries the hiding, an instance of the component or something above it.
        add(
          policy(
            'required',
            `This block must stay on the page, but it is hidden${why.by === n.id ? '' : ` by "${why.by}"`}.`,
            { nodeId: owner ? why.by : n.id, ...(path ? { path } : {}) },
          ),
        )
      } else if (owner)
        // Hidden by what a use gives the part or one of its ancestors in the component: a property, a look, an override.
        for (const v of views)
          for (const a of [...up, n]) {
            const st = stagesOf(a, v.use, v.outer)
            const i = st.findIndex(s => reasonOf(s.node))
            if (i < 0 || !reasonOf(st[st.length - 1].node)) continue
            const r = reasonOf(st[i].node)!
            // hidden in the component's own tree, and not shown again by this use: the node carries it
            const place = hidePlace(
              st[i],
              st[i - 1]?.node ?? st[i].node,
              v.use,
              a.id,
              pathOf(r) ?? '',
              n.id,
            )
            if (place) {
              const { look, ...at } = place
              const who = a === n ? 'it' : `"${a.id}"`
              add(
                policy(
                  'required',
                  `The block "${n.id}" of the component "${cid}" must stay on the page, but ${
                    look
                      ? `the look "${look}" of the component hides ${who} for this use`
                      : st[i].source.by === 'master'
                        ? `${who} is hidden in the component`
                        : `this use hides ${who}`
                  }.`,
                  at,
                ),
              )
            }
          }
      inside(n, up)
      if (n.kind !== 'text') return
      if (!owner) {
        if (!hasContent(n))
          add(
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
      for (const v of views) {
        const st = stagesOf(n, v.use, v.outer)
        const runs = (x: Stage) => x.node.props?.runs
        if ((runs(st[st.length - 1]) as unknown[] | undefined)?.some(runHas))
          continue
        // Emptied by an instance further out: that one is where to look. Otherwise it is this use's own `set` or override.
        const last = st.findLastIndex(
          (x, j) => j > 0 && runs(x) !== runs(st[j - 1]),
        )
        const s = last > 0 ? st[last].source : undefined
        // An override that emptied it is where to look, this use's or one further out; otherwise the property that is set.
        const far = s?.by === 'override' ? s : undefined
        add(
          policy(
            'required',
            `The text "${n.id}" of the component "${cid}" must keep some text, and this use shows none.`,
            far
              ? { nodeId: far.inst.id, path: `overrides.${far.key}.props.runs` }
              : {
                  nodeId: v.use.inst.id,
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
  const outside = (size: number) => size < r.min || size > r.max
  const allowed = [String(r.min), String(r.max)]
  for (const s of textSizes(doc))
    if (outside(s.size))
      out.push(
        policy(
          'textRange',
          `A text size of ${s.size} is outside the site's range of ${r.min} to ${r.max}.`,
          {
            ...(s.nodeId === undefined ? {} : { nodeId: s.nodeId }),
            path: s.path,
            allowed,
          },
        ),
      )
  // The sizes a use of a component gives its parts: through a property, a look, or an override. Those of the master are in `textSizes`.
  const ix = hiddenIndex(doc)
  const seen = new Set<string>()
  for (const [tree, root] of trees(doc)) {
    const cid =
      typeof tree === 'object' && 'component' in tree
        ? tree.component
        : undefined
    const comp = cid === undefined ? undefined : ix.components.get(cid)
    const uses = cid === undefined ? undefined : ix.uses.get(cid)
    if (!comp || !uses) continue
    const mines = minesOf(comp)
    let over = false
    const views = uses.flatMap(u => {
      const c = outerChains(ix, u)
      over ||= c.over
      return c.chains.map(outer => ({
        use: useOf(comp, u.path[u.path.length - 1], mines),
        outer,
      }))
    })
    walkWithAncestors(root, part => {
      if (over) {
        const p = tooMany(comp.id, part.id, 'textRange')
        const k = JSON.stringify([p.rule, p.message])
        if (!seen.has(k)) {
          seen.add(k)
          out.push(p)
        }
      }
      for (const v of views) {
        const st = stagesOf(part, v.use, v.outer)
        for (const s of nodeSizes(st[st.length - 1].node)) {
          if (!outside(s.size)) continue
          const i = st.findIndex(
            (x, j) =>
              valueAt(x.node, s.real) === s.size &&
              (j === 0 || valueAt(st[j - 1].node, s.real) !== s.size),
          )
          if (i < 1) continue
          const place = placeOf(st[i], st[i - 1].node, comp, part.id, s.real)
          const key = JSON.stringify([place?.nodeId, place?.path])
          if (!place || seen.has(key)) continue
          seen.add(key)
          out.push(
            policy(
              'textRange',
              `A text size of ${s.size} is outside the site's range of ${r.min} to ${r.max} (the part "${part.id}" of the component "${comp.id}").`,
              { ...place, allowed },
            ),
          )
        }
      }
    })
  }
  return out
}
