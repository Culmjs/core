import { find, walk } from '../document/index.ts'
import { blockIds, localTarget } from '../document/tree.ts'
import { touched } from '../document/samples.ts'
import type { Node, Problem, PropValue, Run } from '../document/index.ts'
import { applyAction, paths, readAction } from './actions.ts'
import type { Action } from './actions.ts'
import type { Registry } from './registry.ts'

export type SettingType =
  | 'number'
  | 'switch'
  | 'select'
  | 'text'
  | 'textarea'
  | 'color'
  | 'link'
  | 'asset'

export type Setting = {
  key: string
  label: string
  type: SettingType
  min?: number
  max?: number
  options?: { label: string; value: string }[]
  invert?: boolean
  /** Exactly one of `actions` and `fn`. */
  actions?: Action[]
  fn?: string
}

export type SettingFn = {
  read(root: Node): PropValue | undefined
  apply(root: Node, value: PropValue): Node
}

export type BlockDef = {
  id: string
  version: number
  name: string
  category: string
  looks: { id: string; name: string; tree: Node }[]
  settings: Setting[]
  /** A short note for a person or an agent on when to use the block; at most 500 characters (UTF-16 code units, as `String.length` counts them). */
  guide?: string
  onInsert?: (lookId: string) => Node
}

export type TreeResult =
  { ok: true; root: Node } | { ok: false; problems: Problem[] }

const fail = (
  code: Problem['code'],
  message: string,
  more: Partial<Problem> = {},
): TreeResult => ({ ok: false, problems: [{ code, message, ...more }] })

export function insertBlock(
  registry: Registry,
  blockId: string,
  lookId: string,
  rootId: string,
): TreeResult {
  const block = registry.block(blockId)
  if (!block)
    return fail('UNKNOWN_BLOCK', `No block "${blockId}".`, {
      allowed: registry.blocks().map(b => b.id),
    })
  const look = block.looks.find(l => l.id === lookId)
  if (!look)
    return fail(
      'UNKNOWN_BLOCK',
      `Block "${blockId}" has no look "${lookId}".`,
      {
        allowed: block.looks.map(l => l.id),
      },
    )
  const tree = block.onInsert ? block.onInsert(lookId) : look.tree
  return {
    ok: true,
    root: {
      ...blockIds(rootId, tree),
      origin: { block: block.id, version: block.version, look: lookId },
    },
  }
}

const runsText = (v: Run[]) =>
  v.map(r => (r.br ? '\n' : (r.text ?? ''))).join('')

function readOne(
  registry: Registry,
  root: Node,
  s: Setting,
): PropValue | undefined {
  if (s.fn) return registry.settingFn(s.fn)?.read(root)
  const actions = s.actions ?? []
  let v: unknown
  for (const a of actions) if ((v = readAction(root, a)) !== undefined) break
  if (Array.isArray(v) && (s.type === 'text' || s.type === 'textarea'))
    v = runsText(v as Run[])
  // A node that exists but has no value yet still has a reading: a shown switch, a select on "".
  const exists = actions.some(
    a => a.do === 'set' && paths(a.path).some(p => localTarget(root, p)),
  )
  if (s.type === 'switch' && (v !== undefined || exists))
    return !!v !== !!s.invert
  if (s.type === 'select' && v === undefined && exists) return ''
  return v as PropValue | undefined
}

/** Each setting's current value; a setting whose parts this look lacks is left out. */
export function readSettings(
  registry: Registry,
  root: Node,
): Record<string, PropValue | undefined> {
  const block = root.origin && registry.block(root.origin.block)
  const out: Record<string, PropValue | undefined> = {}
  for (const s of block ? block.settings : []) {
    const v = readOne(registry, root, s)
    if (v !== undefined) out[s.key] = v
  }
  return out
}

const typeOk = (s: Setting, v: PropValue): boolean =>
  s.type === 'number'
    ? typeof v === 'number' && Number.isFinite(v)
    : s.type === 'switch'
      ? typeof v === 'boolean'
      : s.type === 'select'
        ? typeof v === 'string' && !!s.options?.some(o => o.value === v)
        : s.type === 'link'
          ? typeof v === 'string' ||
            (typeof v === 'object' && v !== null && !Array.isArray(v))
          : typeof v === 'string'

/** A plain string as text runs, each line break a `{ br: true }` run. */
const runsFrom = (text: string): Run[] =>
  text
    .split('\n')
    .flatMap((line, i) => [
      ...(i ? [{ br: true as const }] : []),
      { text: line },
    ])

export function applySetting(
  registry: Registry,
  root: Node,
  key: string,
  value: PropValue,
): TreeResult {
  const nodeId = root.id
  if (!root.origin)
    return fail('INVALID_NODE', 'This node is not a block.', { nodeId })
  const block = registry.block(root.origin.block)
  if (!block)
    return fail('UNKNOWN_BLOCK', `No block "${root.origin.block}".`, {
      nodeId,
      allowed: registry.blocks().map(b => b.id),
    })
  const s = block.settings.find(x => x.key === key)
  if (!s)
    return fail(
      'INVALID_NODE',
      `Block "${block.id}" has no setting "${key}".`,
      {
        nodeId,
        allowed: block.settings.map(x => x.key),
      },
    )
  if (!typeOk(s, value))
    return fail(
      'INVALID_NODE',
      `Setting "${key}" does not accept this value.`,
      {
        nodeId,
        path: key,
        ...(s.type === 'select' && { allowed: s.options?.map(o => o.value) }),
      },
    )
  if (!s.fn === !s.actions)
    return fail(
      'INVALID_NODE',
      `Setting "${key}" needs exactly one of actions and fn.`,
      { nodeId },
    )
  const fn = s.fn ? registry.settingFn(s.fn) : undefined
  if (s.fn && !fn)
    return fail(
      'INVALID_NODE',
      `Setting function "${s.fn}" is not registered.`,
      { nodeId },
    )

  const sets = (s.actions ?? []).flatMap(a =>
    a.do === 'set' ? paths(a.path) : [],
  )
  // `plain` is the setting's value after clamping and inversion; only `set` takes it as runs.
  let plain: PropValue = value
  if (typeof plain === 'number')
    plain = Math.round(
      Math.min(s.max ?? Infinity, Math.max(s.min ?? -Infinity, plain)),
    )
  else if (s.type === 'switch') plain = !!plain !== !!s.invert
  let runs = plain
  if (s.type === 'textarea') runs = runsFrom(plain as string)
  else if (typeof plain === 'string' && sets.some(p => p.endsWith('.runs')))
    runs = [{ text: plain }]

  let next: Node
  if (fn) next = fn.apply(JSON.parse(JSON.stringify(root)), runs)
  else {
    const siblings = { ...readSettings(registry, root), [key]: value }
    next = root
    for (const a of s.actions!)
      next = applyAction(next, a, a.do === 'set' ? runs : plain, siblings)
  }
  // Changing the words of a text is writing in it, whichever action wrote them: a sample becomes the owner's (`sample: false`) and the block's own wording (`chrome`) becomes theirs.
  walk(next, n => {
    const was = find(root, n.id)
    if (
      was &&
      n.props &&
      JSON.stringify(was.props?.runs) !== JSON.stringify(n.props.runs)
    )
      n.props = touched(n.props)
  })
  return { ok: true, root: next }
}

/** Deletes the value at a setting path from a copy of the tree, with the sample marks the setting's write leaves on its node. */
function dropPath(root: Node, target: string): void {
  const hit = localTarget(root, target)
  if (!hit?.path.length) return
  let o = hit.node as unknown as Record<string, unknown> | undefined
  for (const k of hit.path.slice(0, -1))
    o = o?.[k] as Record<string, unknown> | undefined
  if (o) delete o[hit.path.at(-1)!]
  if (hit.path[0] === 'props' && hit.node.props) {
    delete hit.node.props.sample
    delete hit.node.props.chrome
  }
}

/**
 * Whether a block's root is still as `insertBlock` made it: the same look as a fresh expansion of its origin, except for what its settings write and for starter nodes removed or hidden (a node added, or any style changed, is false)
 * (the site name, a note, labels, links, shown switches). False when the origin's version is not the block's version, because the old default is not held.
 */
export function isAsInserted(registry: Registry, root: Node): boolean {
  const o = root.origin
  const block = o && registry.block(o.block)
  if (!o || !block || block.version !== o.version) return false
  const fresh = insertBlock(registry, o.block, o.look, root.id)
  if (!fresh.ok) return false
  const a: Node = JSON.parse(JSON.stringify(root))
  const b: Node = JSON.parse(JSON.stringify(fresh.root))
  for (const s of block.settings)
    for (const act of s.actions ?? []) {
      const targets =
        act.do === 'set'
          ? paths(act.path)
          : act.do === 'choose'
            ? Object.values(act.options).flatMap(x => [
                ...Object.keys(x.write ?? {}),
                ...(x.remove ?? []),
              ])
            : act.do === 'show'
              ? act.nodes.map(n => `${n}.style.base.hidden`)
              : []
      for (const t of targets) {
        dropPath(a, t)
        dropPath(b, t)
      }
    }
  // Appearance only: a node the starter inserted may be removed or hidden, a node added may not.
  const gone = (n: Node) => {
    n.children = n.children?.filter(c => find(a, c.id))
    n.children?.forEach(gone)
  }
  gone(b)
  for (const t of [a, b])
    walk(t, n => {
      if (n.style?.base) delete n.style.base.hidden
    })
  return JSON.stringify(sorted(a)) === JSON.stringify(sorted(b))
}

/** The same value with every object's keys in order and empty objects left out, so two trees that differ only in that compare equal. */
function sorted(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sorted)
  if (v && typeof v === 'object')
    return Object.fromEntries(
      Object.entries(v)
        .sort(([x], [y]) => (x < y ? -1 : 1))
        .map(([k, x]) => [k, sorted(x)] as const)
        .filter(
          ([, x]) =>
            !(
              x &&
              typeof x === 'object' &&
              !Array.isArray(x) &&
              !Object.keys(x).length
            ),
        ),
    )
  return v
}
