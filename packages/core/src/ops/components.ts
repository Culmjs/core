import { ID_RE } from '../document/kinds.ts'
import { isObj } from '../document/rules.ts'
import { replace, retarget, targetOf, walk } from '../document/tree.ts'
import type { Component, Node } from '../document/index.ts'
import { unrollOne } from '../data/bind.ts'
import { MAX_COMPONENTS } from '../validate/validate.ts'
import { nextIds } from './ids.ts'
import { at, bad, checkSafe, isRefusal, merge, ref } from './nodes.ts'
import { trees, withRoot } from './trees.ts'
import { refuse } from './types.ts'
import type { OpFn } from './types.ts'

type Fields = Record<string, unknown>

/** The ids a node points at: its `props.opens` and the target of each trigger. */
const targetsOf = (w: Node): string[] =>
  [
    w.props?.opens,
    ...(Array.isArray(w.on) ? w.on.map(t => targetOf(t?.do)) : []),
  ].filter((x): x is string => typeof x === 'string')

// ---- makeComponent

export const makeComponent: OpFn<'makeComponent'> = (doc, _registry, op) => {
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
  // `created` is empty: the instance has the id of the node it replaces, so no new node id appears in the tree.
  return {
    ok: true,
    doc: { ...placed, components: [...placed.components, made] },
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
  const unrolled = unrollOne(doc, registry, n)
  if (unrolled.kind === 'instance')
    return refuse(
      'UNKNOWN_COMPONENT',
      `The component "${String(n.component)}" is missing or contains itself.`,
      { nodeId: n.id, allowed: doc.components.map(c => c.id) },
    )

  // A copy, so what is rewritten below is never shared with the document (unrolling shares the nodes of the use's slot).
  const copy: Node = JSON.parse(JSON.stringify(unrolled))
  // A part's id has a dot, which only a block's parts may have. Keep the root, ids without a dot (slot content) and parts of a
  // block inside the tree; every other node gets the next free `n<k>` of the tree, in document order.
  const rename: Node[] = []
  const scan = (w: Node, ns: string | undefined, top: boolean) => {
    const own = w.origin !== undefined ? w.id : ns
    const [a, b, ...more] = w.id.split('.')
    const keeps = top || b === undefined || (!more.length && a === ns)
    if (!keeps) rename.push(w)
    for (const k of w.children ?? []) scan(k, keeps ? own : undefined, false)
  }
  scan(copy, undefined, true)
  const fresh = nextIds(doc, t.tree, rename.length)
  const map = new Map(rename.map((w, i) => [w.id, fresh[i]]))
  walk(copy, w => {
    const opens = w.props?.opens
    if (typeof opens === 'string' && map.has(opens))
      w.props!.opens = map.get(opens)!
    retarget(w, map)
  })
  for (const w of rename) w.id = map.get(w.id)!
  return {
    ok: true,
    doc: withRoot(doc, t.tree, replace(t.root, n.id, copy)),
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
