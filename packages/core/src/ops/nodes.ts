import { STATES } from '../document/layers.ts'
import { ID_RE, kindSpec } from '../document/kinds.ts'
import { requiredRefs } from '../document/required.ts'
import { UNSAFE_FIELDS, isObj } from '../document/rules.ts'
import { touched } from '../document/samples.ts'
import {
  find,
  insert,
  move as moveNode,
  parentOf,
  remove as removeNode,
  replace,
  slotFor,
  walk,
} from '../document/tree.ts'
import type { Layout, Node, SiteDocument } from '../document/index.ts'
import { nextIds } from './ids.ts'
import { rootOf, trees, withRoot } from './trees.ts'
import { refuse } from './types.ts'
import type { NodeRef, OpFn, OpResult, TreeRef } from './types.ts'

type Refusal = Extract<OpResult, { ok: false }>
type Target = { tree: TreeRef; root: Node; node: Node }
type Fields = Record<string, unknown>

const LAYOUTS: readonly Layout[] = ['desktop', 'tablet', 'phone']
export const bad = (message: string, more: Parameters<typeof refuse>[2] = {}) =>
  refuse('INVALID_OPERATION', message, more)
export const isRefusal = (v: unknown): v is Refusal =>
  isObj(v) && v.ok === false && 'problems' in v

/** The path of the first key from `UNSAFE_FIELDS` anywhere in `v` (or of a value nested too deep to check), else undefined. */
function unsafePath(v: unknown, path: string, depth = 0): string | undefined {
  if (typeof v !== 'object' || v === null) return undefined
  if (depth > 32) return path
  for (const [k, x] of Object.entries(v)) {
    const p = `${path}.${k}`
    if (UNSAFE_FIELDS.includes(k)) return p
    const hit = unsafePath(x, p, depth + 1)
    if (hit) return hit
  }
  return undefined
}

/** A refusal when any of the named fields of the operation holds an unsafe key. */
export function checkSafe(o: Fields, id: string | undefined, keys: string[]) {
  for (const k of keys) {
    const hit = unsafePath(o[k], k)
    if (hit)
      return bad(`"${hit}" is not an allowed key.`, { nodeId: id, path: hit })
  }
  return undefined
}

/** The tree and the node of an operation, or the refusal. Everything on `o` is untrusted. */
export function at(doc: SiteDocument, o: Fields): Target | Refusal {
  const root = rootOf(doc, o.tree as TreeRef)
  if (!root) return bad('No such tree.', { path: 'tree' })
  if (typeof o.id !== 'string')
    return bad('The id must be a string.', { path: 'id' })
  const node = find(root, o.id)
  if (!node) return bad(`No node "${o.id}".`, { nodeId: o.id, path: 'id' })
  return { tree: o.tree as TreeRef, root, node }
}

export const ref = (tree: TreeRef, id: string): NodeRef => ({ tree, id })

/** Replaces the target node by what `make` returns (or refuses with what it returns). */
function edit(
  doc: SiteDocument,
  op: object,
  make: (n: Node, o: Fields) => Node | Refusal,
): OpResult {
  const o = op as Fields
  const t = at(doc, o)
  if (isRefusal(t)) return t
  const n = make(t.node, o)
  if (isRefusal(n)) return n
  return {
    ok: true,
    doc: withRoot(doc, t.tree, replace(t.root, t.node.id, n)),
    created: [],
    changed: [ref(t.tree, t.node.id)],
  }
}

/** `n` without `key`, or with `key` set to `v` (null deletes). */
const put = <K extends keyof Node>(
  n: Node,
  key: K,
  v: Node[K] | null,
): Node => {
  const out = { ...n } as Fields
  if (v === null) delete out[key]
  else out[key] = v
  return out as Node
}

/** Whole numbers from 0 to `max`. */
export const indexOk = (v: unknown, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max

/** Applies `entries` to a copy of `base`: null deletes. Keys were checked by the caller. */
export function merge(base: object | undefined, entries: object): Fields {
  const out: Fields = { ...base }
  for (const [k, v] of Object.entries(entries))
    if (v === null) delete out[k]
    else out[k] = v
  return out
}

/** Ids already in the id space of a tree: a component has its own; header, footer and pages share one. */
export function usedIds(doc: SiteDocument, tree: TreeRef, root: Node) {
  const used = new Set<string>()
  const component = isObj(tree) && 'component' in tree
  for (const t of trees(doc))
    if (component === (typeof t.tree === 'object' && 'component' in t.tree))
      if (!component || t.root === root) walk(t.root, w => used.add(w.id))
  return used
}

// ---- add

export const add: OpFn<'add'> = (doc, registry, op) => {
  const o = op as unknown as Fields
  const root = rootOf(doc, o.tree as TreeRef)
  if (!root) return bad('No such tree.', { path: 'tree' })
  const parent = typeof o.parent === 'string' ? find(root, o.parent) : undefined
  if (!parent)
    return bad(`No parent "${String(o.parent)}".`, {
      nodeId: typeof o.parent === 'string' ? o.parent : undefined,
      path: 'parent',
    })
  if (!indexOk(o.index, parent.children?.length ?? 0))
    return bad(
      'The index must be a whole number from 0 to the number of children.',
      {
        nodeId: parent.id,
        path: 'index',
      },
    )
  if (!isObj(o.node))
    return bad('The node must be an object.', { path: 'node' })
  const unsafe = checkSafe(o, undefined, ['node'])
  if (unsafe) return unsafe

  const used = usedIds(doc, o.tree as TreeRef, root)

  // Shape and given ids, in document order.
  const given = new Set<string>()
  let missing = 0
  let problem: Refusal | undefined
  const check = (n: unknown): void => {
    if (problem) return
    if (!isObj(n) || typeof n.kind !== 'string') {
      problem = bad('A node needs a kind.', { path: 'node' })
      return
    }
    if (n.children !== undefined && !Array.isArray(n.children)) {
      problem = bad('children must be a list.', { path: 'node' })
      return
    }
    if (n.id === undefined) missing++
    else if (typeof n.id !== 'string' || !ID_RE.test(n.id))
      problem = bad(`"${String(n.id)}" is not a valid id.`, {
        nodeId: String(n.id),
        path: 'node.id',
      })
    else if (used.has(n.id) || given.has(n.id))
      problem = bad(`The id "${n.id}" is already used.`, {
        nodeId: n.id,
        path: 'node.id',
      })
    else given.add(n.id)
    for (const c of (n.children as unknown[] | undefined) ?? []) check(c)
  }
  check(o.node)
  if (problem) return problem

  const fresh = nextIds(doc, o.tree as TreeRef, missing + given.size)
    .filter(id => !given.has(id))
    .slice(0, missing)
  const ids: string[] = []
  const build = (n: Fields, parentKind: Node['kind']): Node => {
    const id = (n.id as string | undefined) ?? fresh.shift()!
    ids.push(id)
    const kind = n.kind as string
    const slot = isObj(n.slot)
      ? n.slot
      : slotFor(parentKind, { slot: {} } as Node)
    const out: Fields = {
      ...n,
      id,
      kind,
      slot,
      name:
        typeof n.name === 'string'
          ? n.name
          : (kindSpec(kind, registry.kinds())?.label ?? kind),
    }
    if (Array.isArray(n.children))
      out.children = n.children.map(c => build(c as Fields, kind))
    return out as Node
  }
  const node = build(o.node, parent.kind)
  return {
    ok: true,
    doc: withRoot(
      doc,
      o.tree as TreeRef,
      insert(root, parent.id, o.index, node),
    ),
    created: ids.map(id => ref(o.tree as TreeRef, id)),
    changed: [ref(o.tree as TreeRef, parent.id)],
  }
}

// ---- remove

/** The first node that was required in `before` and is not in `after` (same tree, same id), or undefined. */
export function lostRequired(
  before: SiteDocument,
  after: SiteDocument,
): NodeRef | undefined {
  const key = (r: NodeRef) => `${JSON.stringify(r.tree)}|${r.id}`
  const kept = new Set(requiredRefs(after).map(key))
  return requiredRefs(before).find(r => !kept.has(key(r)))
}

/** The refusal for a change that would lose a node that was required. */
export const requiredRefusal = (lost: NodeRef) =>
  refuse(
    'POLICY_VIOLATION',
    `"${lost.id}" must stay in the site${typeof lost.tree === 'object' && 'component' in lost.tree ? ` (in component "${lost.tree.component}")` : ''}.`,
    { nodeId: lost.id, rule: 'required' },
  )

export const remove: OpFn<'remove'> = (doc, _registry, op) => {
  const t = at(doc, op as unknown as Fields)
  if (isRefusal(t)) return t
  if (t.root.id === t.node.id)
    return bad('The root of a tree cannot be removed.', { nodeId: t.node.id })
  const parent = parentOf(t.root, t.node.id)!
  const result = withRoot(doc, t.tree, removeNode(t.root, t.node.id))
  const lost = lostRequired(doc, result)
  if (lost) return requiredRefusal(lost)
  return {
    ok: true,
    doc: result,
    created: [],
    changed: [ref(t.tree, parent.id)],
  }
}

// ---- move

export const move: OpFn<'move'> = (doc, _registry, op) => {
  const o = op as unknown as Fields
  const t = at(doc, o)
  if (isRefusal(t)) return t
  const id = t.node.id
  if (t.root.id === id)
    return bad('The root of a tree cannot be moved.', { nodeId: id })
  const parent =
    typeof o.parent === 'string' ? find(t.root, o.parent) : undefined
  if (!parent)
    return bad(`No parent "${String(o.parent)}".`, {
      nodeId: id,
      path: 'parent',
    })
  if (find(t.node, parent.id))
    return bad('A node cannot move into itself.', {
      nodeId: id,
      path: 'parent',
    })
  const siblings = parent.children?.filter(c => c.id !== id).length ?? 0
  if (!indexOk(o.index, siblings))
    return bad(
      'The index must be a whole number from 0 to the number of children.',
      {
        nodeId: id,
        path: 'index',
      },
    )
  if (o.slot !== undefined && !isObj(o.slot))
    return bad('The slot must be an object.', { nodeId: id, path: 'slot' })
  const unsafe = checkSafe(o, id, ['slot'])
  if (unsafe) return unsafe
  let root = moveNode(t.root, id, parent.id, o.index)
  if (o.slot !== undefined)
    root = replace(root, id, {
      ...find(root, id)!,
      slot: o.slot as Node['slot'],
    })
  return {
    ok: true,
    doc: withRoot(doc, t.tree, root),
    created: [],
    changed: [ref(t.tree, id)],
  }
}

// ---- settings of one node

export const setProps: OpFn<'setProps'> = (doc, _registry, op) =>
  edit(doc, op, (n, o) => {
    if (!isObj(o.props))
      return bad('props must be an object.', { nodeId: n.id, path: 'props' })
    if (o.name !== undefined && typeof o.name !== 'string')
      return bad('name must be a string.', { nodeId: n.id, path: 'name' })
    const unsafe = checkSafe(o, n.id, ['props'])
    if (unsafe) return unsafe
    const props = merge(touched({ ...n.props }), o.props) as Node['props']
    const named = typeof o.name === 'string' ? { ...n, name: o.name } : n
    return Object.keys(props!).length
      ? { ...named, props }
      : put(named, 'props', null)
  })

export const setText: OpFn<'setText'> = (doc, registry, op) =>
  edit(doc, op, (n, o) => {
    if (typeof o.text !== 'string')
      return bad('text must be a string.', { nodeId: n.id, path: 'text' })
    if (!kindSpec(n.kind, registry.kinds())?.props.runs)
      return bad(`A ${n.kind} has no text to set.`, {
        nodeId: n.id,
        allowed: [],
      })
    return { ...n, props: touched({ ...n.props, runs: [{ text: o.text }] }) }
  })

export const setStyle: OpFn<'setStyle'> = (doc, _registry, op) =>
  edit(doc, op, (n, o) => {
    const id = n.id
    const l = o.layer
    const when =
      isObj(l) &&
      isObj(l.when) &&
      typeof l.when.state === 'string' &&
      typeof l.when.is === 'string'
        ? { state: l.when.state, is: l.when.is }
        : undefined
    const name =
      typeof l === 'string' && (STATES as readonly string[]).includes(l)
        ? l
        : undefined
    if (!when && !name)
      return bad('Unknown style layer.', {
        nodeId: id,
        path: 'layer',
        allowed: STATES,
      })
    if (!isObj(o.decl))
      return bad('decl must be an object.', { nodeId: id, path: 'decl' })
    const unsafe = checkSafe(o, id, ['decl'])
    if (unsafe) return unsafe
    const style: Fields = { ...n.style }
    if (name) {
      const decl = merge(style[name] as object | undefined, o.decl)
      if (Object.keys(decl).length) style[name] = decl
      else delete style[name]
    } else {
      const list = ((style.when as Fields[] | undefined) ?? []).slice()
      const i = list.findIndex(
        w => w.state === when!.state && w.is === when!.is,
      )
      const decl = merge(list[i]?.decl as object | undefined, o.decl)
      if (!Object.keys(decl).length) list.splice(i < 0 ? list.length : i, 1)
      else if (i < 0) list.push({ ...when, decl })
      else list[i] = { ...list[i], decl }
      if (list.length) style.when = list
      else delete style.when
    }
    return Object.keys(style).length
      ? { ...n, style: style as Node['style'] }
      : put(n, 'style', null)
  })

export const setHidden: OpFn<'setHidden'> = (doc, _registry, op) =>
  edit(doc, op, (n, o) => {
    if (
      typeof o.layout !== 'string' ||
      !(LAYOUTS as readonly string[]).includes(o.layout)
    )
      return bad('Unknown layout.', {
        nodeId: n.id,
        path: 'layout',
        allowed: LAYOUTS,
      })
    if (typeof o.hidden !== 'boolean')
      return bad('hidden must be true or false.', {
        nodeId: n.id,
        path: 'hidden',
      })
    const hide: Fields = { ...n.hide }
    if (o.hidden) hide[o.layout] = true
    else delete hide[o.layout]
    return Object.keys(hide).length
      ? { ...n, hide: hide as Node['hide'] }
      : put(n, 'hide', null)
  })

export const setSlot: OpFn<'setSlot'> = (doc, _registry, op) =>
  edit(doc, op, (n, o) => {
    if (o.slot === undefined && o.placement === undefined)
      return bad('Give a slot, a placement, or both.', { nodeId: n.id })
    if (o.slot !== undefined && !isObj(o.slot))
      return bad('slot must be an object.', { nodeId: n.id, path: 'slot' })
    if (
      o.placement !== undefined &&
      o.placement !== null &&
      !isObj(o.placement)
    )
      return bad('placement must be an object or null.', {
        nodeId: n.id,
        path: 'placement',
      })
    const unsafe = checkSafe(o, n.id, ['slot', 'placement'])
    if (unsafe) return unsafe
    const out =
      o.slot === undefined ? n : { ...n, slot: o.slot as Node['slot'] }
    return o.placement === undefined
      ? out
      : put(out, 'placement', o.placement as Node['placement'] | null)
  })

export const setRequired: OpFn<'setRequired'> = (doc, _registry, op) =>
  edit(doc, op, (n, o) =>
    o.required === true || o.required === false || o.required === null
      ? put(n, 'required', o.required)
      : bad('required must be true, false or null.', {
          nodeId: n.id,
          path: 'required',
        }),
  )

/** Replaces each given field of the node by the value (null deletes it); `fields` says which values are well formed. */
const setFields =
  (fields: Record<string, (v: unknown) => boolean>) =>
  (n: Node, o: Fields): Node | Refusal => {
    const given = Object.keys(fields).filter(k => o[k] !== undefined)
    if (!given.length)
      return bad(`Give at least one of ${Object.keys(fields).join(', ')}.`, {
        nodeId: n.id,
      })
    for (const k of given)
      if (o[k] !== null && !fields[k](o[k]))
        return bad(`${k} has the wrong shape.`, { nodeId: n.id, path: k })
    const unsafe = checkSafe(o, n.id, given)
    if (unsafe) return unsafe
    let out = n
    for (const k of given) out = put(out, k as keyof Node, o[k] as never)
    return out
  }

const list = (v: unknown) => Array.isArray(v)

export const bindData: OpFn<'bindData'> = (doc, _registry, op) =>
  edit(
    doc,
    op,
    setFields({ repeat: isObj, bind: isObj, showIf: isObj, showIfAny: list }),
  )

export const setStates: OpFn<'setStates'> = (doc, _registry, op) =>
  edit(doc, op, setFields({ state: list, on: list }))
