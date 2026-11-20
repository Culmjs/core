import { localTarget } from '../document/tree.ts'
import type { Node, PropValue } from '../document/index.ts'

/** A Path is "<localId>.<field>.<field>…" or "$root.<field>…". */
export type SetAction = {
  do: 'set'
  path: string | string[]
  as?: { unit: 'px' | '%' | 'ch' | 'vh' | 'vw' }
  unsetWhenEmpty?: boolean
  readWhen?: { path: string; is: PropValue }
}
export type ChooseAction = {
  do: 'choose'
  options: Record<
    string,
    { write?: Record<string, unknown>; remove?: string[] }
  >
  default: string
}
/** Shows or hides nodes by whether a value is empty. It stores no value, so it has no read-back: `readAction` always returns undefined for it. */
export type ShowAction = {
  do: 'show'
  nodes: string[]
  when?: string[]
  emptyIs?: 'hidden' | 'shown'
}
export type FilterAction = {
  do: 'filter'
  list: string | string[]
  field: string
  empty?: 'remove' | { is: string | number | boolean }
}
export type Action = SetAction | ChooseAction | ShowAction | FilterAction

type Obj = Record<string, unknown>
type Hit = NonNullable<ReturnType<typeof localTarget>>

// A JSON copy, not structuredClone: nodes are plain JSON, and a style object shared by several nodes must not stay shared.
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v))
export const paths = (p: string | string[]): string[] => [p].flat()
const isEmpty = (v: unknown) => v === undefined || v === null || v === ''

function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a)
  return (
    ka.length === Object.keys(b).length &&
    ka.every(k => equal((a as Obj)[k], (b as Obj)[k]))
  )
}

const dig = (hit: Hit | null): unknown =>
  hit?.path.reduce<unknown>((o, k) => (o as Obj | undefined)?.[k], hit.node)

/** Writes `v` at a target in `root`, or deletes the key when `v` is undefined. A target whose node is missing is skipped. */
function put(root: Node, target: string, v: unknown): void {
  const hit = localTarget(root, target)
  if (!hit?.path.length) return
  const last = hit.path.at(-1)!
  let o: Obj | undefined = hit.node as unknown as Obj
  for (const k of hit.path.slice(0, -1))
    o = v === undefined ? (o?.[k] as Obj | undefined) : ((o![k] ??= {}) as Obj)
  if (!o) return
  if (v === undefined) delete o[last]
  else o[last] = copy(v)
}

export function applyAction(
  root: Node,
  action: Action,
  value: PropValue,
  siblings: Record<string, PropValue | undefined> = {},
): Node {
  const out = copy(root)
  switch (action.do) {
    case 'set': {
      const v =
        action.unsetWhenEmpty && value === ''
          ? undefined
          : action.as && typeof value === 'number'
            ? { n: value, unit: action.as.unit }
            : value
      for (const p of paths(action.path)) put(out, p, v)
      break
    }
    case 'choose': {
      const o = Object.values(action.options)
      for (const t of new Set(
        o.flatMap(x => [...Object.keys(x.write ?? {}), ...(x.remove ?? [])]),
      ))
        put(out, t, undefined)
      const pick = (k: string) =>
        Object.hasOwn(action.options, k) ? action.options[k] : undefined
      const chosen = pick(String(value)) ?? pick(action.default)
      for (const [t, x] of Object.entries(chosen?.write ?? {})) put(out, t, x)
      break
    }
    case 'show': {
      const empty = [value, ...(action.when ?? []).map(k => siblings[k])].every(
        isEmpty,
      )
      const hide = empty !== (action.emptyIs === 'shown')
      for (const id of action.nodes) {
        const node = localTarget(out, id)?.node
        if (!node) continue
        if (hide) (node.style ??= {}).base ??= {}
        const base = node.style?.base as Obj | undefined
        if (hide) base!.hidden = true
        else if (base) delete base.hidden
      }
      break
    }
    case 'filter':
      for (const id of paths(action.list)) {
        const r = localTarget(out, id)?.node.repeat
        if (!r) continue
        if (!isEmpty(value))
          r.filter = { field: action.field, is: value as string }
        else if (action.empty && action.empty !== 'remove')
          r.filter = { field: action.field, is: action.empty.is }
        else delete r.filter
      }
  }
  return out
}

/** The value an action holds in the tree now, or undefined when it holds none (or cannot be read back). */
export function readAction(root: Node, action: Action): PropValue | undefined {
  switch (action.do) {
    case 'set': {
      const g = action.readWhen
      if (g && !equal(dig(localTarget(root, g.path)), g.is)) return undefined
      for (const p of paths(action.path)) {
        const hit = localTarget(root, p)
        if (!hit) continue
        const v = dig(hit)
        return (
          action.as && v && typeof v === 'object' && 'n' in v ? v.n : v
        ) as PropValue | undefined
      }
      return undefined
    }
    case 'choose':
      // Like the write, read only the targets this look has; an option with none of them cannot match.
      return (
        Object.entries(action.options).find(([, o]) => {
          const here = Object.entries(o.write ?? {}).filter(([t]) =>
            localTarget(root, t),
          )
          return (
            here.length > 0 &&
            here.every(([t, x]) => equal(dig(localTarget(root, t)), x)) &&
            (o.remove ?? []).every(t => dig(localTarget(root, t)) === undefined)
          )
        })?.[0] ?? action.default
      )
    case 'filter':
      for (const id of paths(action.list)) {
        const f = localTarget(root, id)?.node.repeat?.filter
        if (f) return f.field === action.field ? (f.is as PropValue) : undefined
      }
      return undefined
    case 'show':
      return undefined
  }
}
