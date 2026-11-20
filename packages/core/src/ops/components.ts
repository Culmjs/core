import { ID_RE } from '../document/kinds.ts'
import { isObj } from '../document/rules.ts'
import { replace, retarget, targetOf, walk } from '../document/tree.ts'
import type { Component, Node, SiteDocument } from '../document/index.ts'
import { unrollOne } from '../data/bind.ts'
import { MAX_COMPONENTS, validateSite } from '../validate/validate.ts'
import { nextIds } from './ids.ts'
import { MARKS, at, bad, checkSafe, isRefusal, merge, ref } from './nodes.ts'
import { trees, withRoot } from './trees.ts'
import type { Registry } from '../registry/index.ts'
import { refuse } from './types.ts'
import type { OpFn } from './types.ts'

type Fields = Record<string, unknown>

/** The ids a node points at: its `props.opens` and the target of each trigger. */
const targetsOf = (w: Node): string[] =>
  [
    w.props?.opens,
    ...(Array.isArray(w.on) ? w.on.map(t => targetOf(t?.do)) : []),
  ].filter((x): x is string => typeof x === 'string')

/** True when `v` holds a reference to the row of an enclosing repeat. */
const readsItem = (v: unknown): boolean =>
  typeof v === 'object' && v !== null
    ? (v as Fields).from === 'item' || Object.values(v).some(readsItem)
    : false

/** The refusal when the input validated and `after` does not; undefined otherwise. */
function stillValid(
  input: SiteDocument,
  after: SiteDocument,
  registry: Registry,
  nodeId: string,
  what: string,
) {
  if (validateSite(input, registry).length) return undefined
  const first = validateSite(after, registry)[0]
  return first
    ? bad(`${what} because the result would not be valid: ${first.message}`, {
        nodeId,
        path: first.path,
      })
    : undefined
}

// ---- makeComponent

export const makeComponent: OpFn<'makeComponent'> = (doc, registry, op) => {
  const o = op as unknown as Fields
  const t = at(doc, o)
  if (isRefusal(t)) return t
  const id = t.node.id
  if (t.root.id === id)
    return bad('The root of a tree cannot become a component.', { nodeId: id })
  const cid = o.component
  if (typeof cid !== 'string' || !ID_RE.test(cid))
    return bad('A component id must be 1 to 20 lowercase letters and digits.', {
      nodeId: id,
      path: 'component',
    })
  if (doc.components.some(c => c.id === cid))
    return bad(`The component id "${cid}" is already used.`, {
      nodeId: id,
      path: 'component',
    })
  if (doc.components.length >= MAX_COMPONENTS)
    return bad(`A site holds at most ${MAX_COMPONENTS} components.`, {
      nodeId: id,
    })
  if (typeof o.name !== 'string' || !o.name.trim() || o.name.length > 100)
    return bad('A component needs a name of 1 to 100 characters.', {
      nodeId: id,
      path: 'name',
    })

  // Ids inside a component are a space of their own and parts are named `<instanceId>.<partId>`, so the subtree keeps its ids.
  // A dotted id is valid only under a block root, which the component's tree is not: such a subtree is refused.
  const inside = new Set<Node>()
  const insideIds = new Set<string>()
  let problem: ReturnType<typeof bad> | undefined
  walk(t.node, w => {
    inside.add(w)
    insideIds.add(w.id)
    if (problem) return
    if (w.id.includes('.'))
      problem = bad(
        `"${w.id}" belongs to a block; a block's parts cannot move into a component.`,
        { nodeId: w.id },
      )
    else if (w.kind === 'instance' && w.component === cid)
      problem = bad('A component cannot hold a use of itself.', {
        nodeId: w.id,
      })
  })
  if (problem) return problem

  // A component's tree sees only itself, so no reference may cross the boundary in either direction.
  const component = isObj(t.tree) && 'component' in t.tree
  for (const tr of trees(doc)) {
    const same = typeof tr.tree === 'object' && 'component' in tr.tree
    if (component ? tr.root !== t.root : same) continue
    let cross: string | undefined
    walk(tr.root, w => {
      if (cross) return
      const mine = inside.has(w)
      if (targetsOf(w).some(x => (mine ? !insideIds.has(x) : insideIds.has(x))))
        cross = w.id
    })
    if (cross)
      return bad(
        `"${cross}" points across the edge of the subtree; a component's parts can point only at each other.`,
        { nodeId: cross },
      )
  }

  // A component's tree has no enclosing states and no enclosing repeat.
  const declared = new Set<string>()
  walk(t.node, w => {
    for (const d of w.state ?? []) declared.add(d.name)
  })
  let outside: ReturnType<typeof bad> | undefined
  const scan = (w: Node, repeated: boolean) => {
    if (outside) return
    for (const tr of w.on ?? []) {
      const d = (tr?.do ?? {}) as Fields
      const name = d.set ?? d.toggle ?? d.step
      if (typeof name === 'string' && !declared.has(name))
        outside = bad(
          `"${w.id}" uses the state "${name}", which is declared outside the node; the node cannot become a component.`,
          { nodeId: w.id },
        )
    }
    const { children, ...own } = w
    if (!repeated && readsItem(own))
      outside = bad(
        `"${w.id}" reads an item of a repeat that encloses it; the node cannot become a component.`,
        { nodeId: w.id },
      )
    for (const k of children ?? []) scan(k, repeated || w.repeat !== undefined)
  }
  scan(t.node, false)
  if (outside) return outside

  const n = t.node
  const instance: Fields = {
    id,
    kind: 'instance',
    name: n.name,
    slot: n.slot,
    component: cid,
  }
  for (const k of [
    'placement',
    'hide',
    'showIf',
    'showIfAny',
    'locked',
  ] as const)
    if (n[k] !== undefined) instance[k] = n[k]
  // The top of a tree has no position, so the instance takes the slot and placement and the component's root gives them up.
  const top: Fields = { ...n, slot: {} }
  delete top.placement
  const made: Component = {
    id: cid,
    name: o.name,
    root: top as unknown as Node,
    props: [],
    variants: [],
  }
  const placed = withRoot(
    doc,
    t.tree,
    replace(t.root, id, instance as unknown as Node),
  )
  const result = { ...placed, components: [...placed.components, made] }
  const broken = stillValid(
    doc,
    result,
    registry,
    id,
    `"${id}" cannot become a component`,
  )
  if (broken) return broken
  // `created` is empty: the instance has the id of the node it replaces, so no new node id appears in the tree.
  return {
    ok: true,
    doc: result,
    created: [],
    changed: [ref(t.tree, id)],
  }
}

// ---- setInstance

export const setInstance: OpFn<'setInstance'> = (doc, _registry, op) => {
  const o = op as unknown as Fields
  const t = at(doc, o)
  if (isRefusal(t)) return t
  const n = t.node
  if (n.kind !== 'instance')
    return bad(`"${n.id}" is not a component use.`, { nodeId: n.id })
  if (o.set === undefined && o.overrides === undefined)
    return bad('Give set, overrides, or both.', { nodeId: n.id })
  for (const k of ['set', 'overrides'])
    if (o[k] !== undefined && !isObj(o[k]))
      return bad(`${k} must be an object.`, { nodeId: n.id, path: k })
  if (isObj(o.overrides))
    for (const [k, v] of Object.entries(o.overrides))
      if (v !== null && !isObj(v))
        return bad(`The override for "${k}" must be an object or null.`, {
          nodeId: n.id,
          path: `overrides.${k}`,
        })
  const unsafe = checkSafe(o, n.id, ['set', 'overrides'])
  if (unsafe) return unsafe
  if (isObj(o.overrides))
    for (const [k, v] of Object.entries(o.overrides)) {
      const mark =
        isObj(v) && isObj(v.props)
          ? MARKS.find(m => Object.hasOwn(v.props as object, m))
          : undefined
      if (mark)
        return bad(
          `The ${mark} mark cannot be set by an operation; only inserting a block writes it.`,
          { nodeId: n.id, path: `overrides.${k}.props.${mark}` },
        )
    }
  const out: Fields = { ...n }
  for (const k of ['set', 'overrides']) {
    if (o[k] === undefined) continue
    const next = merge(n[k as 'set'], o[k] as object)
    if (Object.keys(next).length) out[k] = next
    else delete out[k]
  }
  return {
    ok: true,
    doc: withRoot(doc, t.tree, replace(t.root, n.id, out as unknown as Node)),
    created: [],
    changed: [ref(t.tree, n.id)],
  }
}

// ---- detach

export const detach: OpFn<'detach'> = (doc, registry, op) => {
  const t = at(doc, op as unknown as Fields)
  if (isRefusal(t)) return t
  const n = t.node
  if (n.kind !== 'instance')
    return bad(`"${n.id}" is not a component use.`, { nodeId: n.id })
  // Only the component's own tree is unrolled: what a person put in the slot is theirs and goes back as it was.
  const { children: slotted, ...bare } = n
  const unrolled = unrollOne(doc, registry, bare as Node)
  if (unrolled.kind === 'instance')
    return refuse(
      'UNKNOWN_COMPONENT',
      `The component "${String(n.component)}" is missing or contains itself.`,
      { nodeId: n.id, allowed: doc.components.map(c => c.id) },
    )

  // A copy, so what is rewritten below is never shared with the document.
  const copy: Node = JSON.parse(JSON.stringify(unrolled))
  // A detached copy has no block identity and no dotted ids: every node but the root gets the next free `n<k>`, in document order.
  const rename: Node[] = []
  walk(copy, (w, p) => void (p && rename.push(w)))
  // The root drops its block identity. A pattern block sits behind its parent unless its placement says otherwise, which
  // `effectivePlacement` reads from the origin, so that is written out. A block nested in the component keeps its origin.
  if (copy.origin?.block === 'pattern' && copy.placement?.mode === undefined)
    copy.placement = { ...copy.placement, mode: 'behind' }
  delete copy.origin
  // The use's own `required` mark is a person's and goes with the root (the unroll leaves it behind).
  if (n.required !== undefined) copy.required = n.required
  const fresh = nextIds(doc, t.tree, rename.length)
  const map = new Map(rename.map((w, i) => [w.id, fresh[i]]))
  walk(copy, w => {
    const opens = w.props?.opens
    if (typeof opens === 'string' && map.has(opens))
      w.props!.opens = map.get(opens)!
    retarget(w, map)
  })
  for (const w of rename) w.id = map.get(w.id)!
  // The slot content goes into the slot parts, as unrolling does; its nodes keep their ids and kinds.
  if (slotted?.length) {
    const comp = doc.components.find(c => c.id === n.component)!
    const parts = new Set(
      (Array.isArray(comp.props) ? comp.props : [])
        .filter(x => x.type === 'slot' && x.part)
        .map(x => (x.part === comp.root.id ? n.id : `${n.id}.${x.part}`)),
    )
    const into = [...parts].map(id => map.get(id) ?? id)
    walk(copy, w => {
      if (into.includes(w.id))
        w.children = [
          ...(w.children ?? []),
          ...JSON.parse(JSON.stringify(slotted)),
        ]
    })
  }
  const result = withRoot(doc, t.tree, replace(t.root, n.id, copy))
  const broken = stillValid(
    doc,
    result,
    registry,
    n.id,
    `"${n.id}" cannot be detached`,
  )
  if (broken) return broken
  return {
    ok: true,
    doc: result,
    created: fresh.map(id => ref(t.tree, id)),
    changed: [ref(t.tree, n.id)],
  }
}

// ---- removeComponent

export const removeComponent: OpFn<'removeComponent'> = (doc, _r, op) => {
  const cid = (op as unknown as Fields).component
  const known = doc.components.map(c => c.id)
  if (typeof cid !== 'string' || !known.includes(cid))
    return refuse(
      'UNKNOWN_COMPONENT',
      `No component "${String(cid).slice(0, 40)}".`,
      { path: 'component', allowed: known },
    )
  const uses: string[] = []
  for (const tr of trees(doc))
    walk(tr.root, w => {
      if (w.kind === 'instance' && w.component === cid) uses.push(w.id)
    })
  if (uses.length)
    return bad(`The component "${cid}" is still used by ${uses.join(', ')}.`, {
      nodeId: uses[0],
      path: 'component',
    })
  return {
    ok: true,
    doc: { ...doc, components: doc.components.filter(c => c.id !== cid) },
    created: [],
    changed: [],
  }
}
