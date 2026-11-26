import { ID_RE } from '../document/kinds.ts'
import { isObj } from '../document/rules.ts'
import { find, replace, slotFor, walk } from '../document/tree.ts'
import type { Node } from '../document/index.ts'
import {
  applySetting,
  insertBlock as insertTree,
  readSettings,
} from '../registry/index.ts'
import type { BlockDef } from '../registry/index.ts'
import { nextIds } from './ids.ts'
import {
  at,
  bad,
  checkSafe,
  indexOk,
  isRefusal,
  lostRequired,
  ref,
  requiredRefusal,
  usedIds,
} from './nodes.ts'
import { rootOf, withRoot } from './trees.ts'
import { refuse } from './types.ts'
import type { Note, OpFn, TreeRef } from './types.ts'

type Fields = Record<string, unknown>

/** Ids in document order. */
const idsOf = (n: Node) => {
  const out: string[] = []
  walk(n, w => out.push(w.id))
  return out
}

/** A node without its children, as text: two nodes with the same text have the same fields. */
const flat = (n: Node) =>
  JSON.stringify({ ...n, children: undefined, origin: undefined })

export const insertBlock: OpFn<'insertBlock'> = (doc, registry, op) => {
  const o = op as unknown as Fields
  const tree = o.tree as TreeRef
  const root = rootOf(doc, tree)
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
      { nodeId: parent.id, path: 'index' },
    )
  if (typeof o.block !== 'string')
    return bad('The block must be a string.', { path: 'block' })
  if (typeof o.look !== 'string')
    return bad('The look must be a string.', { path: 'look' })
  if (
    o.settings !== undefined &&
    (!isObj(o.settings) || Array.isArray(o.settings))
  )
    return bad('settings must be an object.', { path: 'settings' })
  if (o.id !== undefined && (typeof o.id !== 'string' || !ID_RE.test(o.id)))
    return bad(`"${String(o.id)}" is not a valid id.`, {
      nodeId: String(o.id),
      path: 'id',
    })
  if (typeof o.id === 'string' && usedIds(doc, tree, root).has(o.id))
    return bad(`The id "${o.id}" is already used.`, {
      nodeId: o.id,
      path: 'id',
    })
  const unsafe = checkSafe(o, undefined, ['settings'])
  if (unsafe) return unsafe

  const id = (o.id as string | undefined) ?? nextIds(doc, tree, 1)[0]
  const made = insertTree(registry, o.block, o.look, id)
  if (!made.ok) return made
  const given = (o.settings ?? {}) as Fields
  const declared = registry.block(o.block)!.settings.map(s => s.key)
  // The block's own order first, so the result does not depend on the order of the keys; an unknown key last, where `applySetting` refuses it.
  const keys = [
    ...declared.filter(k => Object.hasOwn(given, k)),
    ...Object.keys(given).filter(k => !declared.includes(k)),
  ]
  let block = made.root
  for (const k of keys) {
    const r = applySetting(registry, block, k, given[k] as never)
    if (!r.ok) return r
    block = r.root
  }
  if (!Object.keys(block.slot).length)
    block = { ...block, slot: slotFor(parent.kind, block) }

  const siblings = (parent.children ?? []).slice()
  siblings.splice(o.index, 0, block)
  return {
    ok: true,
    doc: withRoot(
      doc,
      tree,
      replace(root, parent.id, { ...parent, children: siblings }),
    ),
    created: idsOf(block).map(i => ref(tree, i)),
    changed: [ref(tree, parent.id)],
  }
}

export const setBlockSetting: OpFn<'setBlockSetting'> = (doc, registry, op) => {
  const o = op as unknown as Fields
  const t = at(doc, o)
  if (isRefusal(t)) return t
  if (typeof o.key !== 'string')
    return bad('key must be a string.', { nodeId: t.node.id, path: 'key' })
  if (o.value === undefined)
    return bad('value is missing.', { nodeId: t.node.id, path: 'value' })
  const unsafe = checkSafe(o, t.node.id, ['value'])
  if (unsafe) return unsafe
  const r = applySetting(registry, t.node, o.key, o.value as never)
  if (!r.ok)
    return {
      ...r,
      problems: r.problems.map(p =>
        p.code === 'INVALID_NODE' ? { ...p, code: 'INVALID_OPERATION' } : p,
      ),
    }
  const before = new Map<string, string>()
  walk(t.node, w => before.set(w.id, flat(w)))
  const created: string[] = []
  const changed: string[] = []
  walk(r.root, w => {
    const was = before.get(w.id)
    if (was === undefined) created.push(w.id)
    else if (was !== flat(w)) changed.push(w.id)
  })
  // A setting function is plug-in code and can return any subtree: nothing required may be lost to it.
  const result = withRoot(doc, t.tree, replace(t.root, t.node.id, r.root))
  const lost = lostRequired(doc, result)
  if (lost) return requiredRefusal(lost)
  return {
    ok: true,
    doc: result,
    created: created.map(i => ref(t.tree, i)),
    changed: changed.map(i => ref(t.tree, i)),
  }
}

export const updateBlock: OpFn<'updateBlock'> = (doc, registry, op) => {
  const t = at(doc, op as unknown as Fields)
  if (isRefusal(t)) return t
  const old = t.node
  const id = old.id
  if (!old.origin)
    return bad('This node is not a block.', { nodeId: id, path: 'id' })
  const block: BlockDef | undefined = registry.block(old.origin.block)
  if (!block)
    return refuse('UNKNOWN_BLOCK', `No block "${old.origin.block}".`, {
      nodeId: id,
      allowed: registry.blocks().map(b => b.id),
    })
  if (!block.looks.some(l => l.id === old.origin!.look))
    return refuse(
      'UNKNOWN_BLOCK',
      `Block "${block.id}" no longer has the look "${old.origin.look}".`,
      { nodeId: id, allowed: block.looks.map(l => l.id) },
    )
  if (old.origin.version === block.version)
    return {
      ok: true,
      doc,
      created: [],
      changed: [],
      notes: [
        {
          kind: 'info',
          ids: [id],
          text: `"${old.name}" is already at version ${block.version}.`,
        },
      ],
    }

  const made = insertTree(registry, block.id, old.origin.look, id)
  if (!made.ok) return made
  const notes: Note[] = []
  let fresh = made.root
  // The old subtree's values, read with the new declaration; a value the new declaration rejects is dropped, and said so.
  for (const [key, value] of Object.entries(readSettings(registry, old))) {
    const r = applySetting(registry, fresh, key, value!)
    if (r.ok) fresh = r.root
    else
      notes.push({
        kind: 'reset',
        ids: [id],
        text: `The setting "${key}" was reset; the new version does not accept ${JSON.stringify(value)}.`,
      })
  }
  // The place of the block stays: its slot, placement, visibility, show conditions, lock and name; `replace` keeps the position among siblings.
  // A `required` mark is a person's, not the look's: on every node that is in both subtrees, an explicit mark (true or false) wins over the new look's.
  // A `false` is carried only to a node that is still a form or a field (validation refuses it on any other kind, and the person never wrote it there); the node is then listed in the reset note, as any difference is.
  const marks = new Map<string, boolean>()
  walk(old, w => {
    if (w.required !== undefined) marks.set(w.id, w.required)
  })
  const mark = (n: Node): Node => ({
    ...n,
    ...(marks.has(n.id) &&
    (marks.get(n.id) || n.kind === 'form' || n.kind === 'field')
      ? { required: marks.get(n.id) }
      : {}),
    ...(n.children ? { children: n.children.map(mark) } : {}),
  })
  const placed: Node = { ...mark(fresh), slot: old.slot }
  for (const k of [
    'placement',
    'hide',
    'showIf',
    'showIfAny',
    'locked',
    'name',
  ] as const)
    if (old[k] !== undefined) (placed as Fields)[k] = old[k]

  const next = new Map<string, string>()
  walk(placed, w => next.set(w.id, flat(w)))
  const reset: string[] = []
  walk(old, w => {
    if (next.get(w.id) !== flat(w)) reset.push(w.id)
  })
  if (reset.length)
    notes.push({
      kind: 'reset',
      ids: reset,
      text: 'These parts differ from the new version and are reset: they were changed outside a setting, hold a value the new version does not accept, are not in the new version, or carried a mark that no longer fits.',
    })

  const result = withRoot(doc, t.tree, replace(t.root, id, placed))
  const lost = lostRequired(doc, result)
  if (lost) return requiredRefusal(lost)
  const before = new Set(idsOf(old))
  return {
    ok: true,
    doc: result,
    created: idsOf(placed)
      .filter(i => !before.has(i))
      .map(i => ref(t.tree, i)),
    changed: [ref(t.tree, id)],
    notes,
  }
}
