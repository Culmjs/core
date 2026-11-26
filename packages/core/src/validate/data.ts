import { type Code, type KindSpec } from '../document/index.ts'
import { KINDS, MAX_ROWS } from '../document/kinds.ts'
import { isObj } from '../document/rules.ts'
import { type FieldType } from '../registry/index.ts'
import {
  isInt,
  isNum,
  isStr,
  oneOf,
  only,
  type Ctx,
  type Entry,
  type Obj,
  type Refs,
  type Schema,
} from './common.ts'
import { bindAllowed } from './components.ts'

export const MARKERS = [
  'none',
  'disc',
  'circle',
  'square',
  'decimal',
  'decimal-leading-zero',
  'lower-roman',
  'upper-roman',
  'lower-alpha',
]

export const scalar = (t: unknown): t is 'text' | 'number' | 'boolean' =>
  t === 'text' || t === 'number' || t === 'boolean'

/** What a reference reaches: the field's type, 'site' for a value the caller supplies, 'shape' for a reference that is not well formed, undefined for a field that is not there. */
export function lookup(
  ref: unknown,
  items: readonly Schema[],
): FieldType | 'site' | 'shape' | undefined {
  if (
    !isObj(ref) ||
    !only(ref, ['from', 'field', 'outer']) ||
    typeof ref.field !== 'string' ||
    !ref.field
  )
    return 'shape'
  if (ref.from === 'item') {
    const outer = ref.outer === undefined ? 0 : ref.outer
    if (!isInt(outer, 0, 63)) return 'shape'
    const r = items[outer]
    return r && Object.hasOwn(r, ref.field) ? r[ref.field] : undefined
  }
  return ref.from === 'site' &&
    ref.outer === undefined &&
    ref.field.length <= 100
    ? 'site'
    : 'shape'
}

export const refsFor =
  (items: readonly Schema[]): Refs =>
  r => {
    const t = lookup(r, items)
    return t === 'shape' ? 'shape' : t === undefined ? 'unknown' : 'ok'
  }

/** The row a repeat reads: a registered source's fields, or the collection of the enclosing row. With `grouped`, a group's own row. */
export function rowOf(
  c: Ctx,
  repeat: Obj,
  items: readonly Schema[],
  grouped: boolean,
): Schema | undefined {
  const s = repeat.source
  let row: Schema | undefined
  if (typeof s === 'string') row = c.reg.source(s)?.fields
  else if (isObj(s) && s.from === 'item') {
    const t = lookup(s, items)
    row = isObj(t) ? (t as { rows: Schema }).rows : undefined
  }
  if (!row || !grouped || !repeat.group) return row
  const g = repeat.group
  const f =
    isObj(g) && typeof g.field === 'string' && Object.hasOwn(row, g.field)
      ? row[g.field]
      : undefined
  return scalar(f)
    ? { label: 'text', key: f, count: 'number', items: { rows: row } }
    : undefined
}

/** The type a repeat's filter compares: a field's own, or text for a list of plain values, which a row passes when the list holds the value. */
export const filterType = (row: Schema, field: unknown) => {
  const f =
    typeof field === 'string' && Object.hasOwn(row, field)
      ? row[field]
      : undefined
  return scalar(f) ? f : f === 'list' ? 'text' : undefined
}

export function checkData(
  c: Ctx,
  e: Entry,
  spec: KindSpec,
  refs: Refs,
  say: (message: string, path?: string, code?: Code) => void,
) {
  const { w } = e
  const ref = (r: unknown, what: string, path: string) => {
    const k = refs(r)
    if (k === 'shape') say(`${what} is not a reference to a field.`, path)
    else if (k === 'unknown')
      say(
        `${what} points at a field that no source here provides.`,
        path,
        'UNKNOWN_SOURCE',
      )
    return k === 'ok'
  }
  if (w.repeat !== undefined) checkRepeat(c, e, spec, ref, say)
  if (w.bind !== undefined) {
    if (!isObj(w.bind)) say('Its data bindings are not an object.', 'bind')
    else
      for (const [k, r] of Object.entries(w.bind)) {
        if (!bindAllowed(c, w, spec, k))
          say(`Its binding for "${k}" is not allowed.`, `bind.${k}`)
        else ref(r, `Its binding for "${k}"`, `bind.${k}`)
      }
  }
  if (w.showIf !== undefined) ref(w.showIf, 'Its show condition', 'showIf')
  if (w.showIfAny !== undefined) {
    const l = w.showIfAny as unknown
    if (!Array.isArray(l) || l.length < 1 || l.length > 8)
      say('Its show-if-any list needs 1 to 8 fields.', 'showIfAny')
    else l.forEach((r, i) => ref(r, 'A show condition', `showIfAny.${i}`))
  }
}

export function checkRepeat(
  c: Ctx,
  e: Entry,
  spec: KindSpec,
  ref: (r: unknown, what: string, path: string) => boolean,
  say: (message: string, path?: string, code?: Code) => void,
) {
  const { w } = e
  const r = w.repeat as unknown
  if (
    !spec.repeatable ||
    (Object.hasOwn(KINDS, w.kind) && w.kind !== 'list' && w.kind !== 'table') ||
    spec.role !== 'container'
  )
    return say('Only a repeatable container can repeat.', 'repeat')
  if (
    !isObj(r) ||
    !only(r, [
      'source',
      'filter',
      'exclude',
      'sort',
      'max',
      'skip',
      'marker',
      'group',
    ])
  )
    return say('Its repeat setting is not valid.', 'repeat')
  const s = r.source
  if (typeof s === 'string') {
    if (!c.reg.source(s))
      return say(
        `Source "${s.slice(0, 40)}" is not registered.`,
        'repeat.source',
        'UNKNOWN_SOURCE',
      )
  } else if (isObj(s) && s.from === 'item') {
    if (!ref(s, 'Its source', 'repeat.source')) return
    if (!isObj(lookup(s, e.items)))
      return say(
        'Its source is not a collection of rows.',
        'repeat.source',
        'UNKNOWN_SOURCE',
      )
  } else return say('Its source is not valid.', 'repeat.source')
  const row = rowOf(c, r, e.items, false)!
  const invalid = (path: string, m = 'Its repeat setting is not valid.') =>
    say(m, `repeat.${path}`)
  if (r.max !== undefined && !isInt(r.max, 1, MAX_ROWS)) invalid('max')
  if (r.skip !== undefined && !isInt(r.skip, 0, MAX_ROWS)) invalid('skip')
  if (r.marker !== undefined && !oneOf(r.marker, MARKERS)) invalid('marker')
  if (r.sort !== undefined) {
    const o = r.sort
    if (
      !isObj(o) ||
      !only(o, ['field', 'dir']) ||
      !oneOf(o.dir, ['asc', 'desc'])
    )
      invalid('sort')
    else if (!(
      typeof o.field === 'string' &&
      Object.hasOwn(row, o.field) &&
      scalar(row[o.field])
    ))
      invalid('sort', 'Its sort field does not exist in this collection.')
  }
  for (const name of ['filter', 'exclude'] as const) {
    const f = r[name]
    if (f === undefined) continue
    if (
      !isObj(f) ||
      !only(f, ['field', 'is', 'of']) ||
      !isStr(f.field) ||
      !(isStr(f.is) || typeof f.is === 'boolean' || isNum(f.is, -1e12, 1e12))
    ) {
      invalid(name)
      continue
    }
    const type = filterType(row, f.field)
    if (!type || typeof f.is !== (type === 'text' ? 'string' : type))
      invalid(name, `Its ${name} value does not match the field type.`)
    else if (f.of !== undefined)
      ref(f.of, `Its ${name} value`, `repeat.${name}.of`)
  }
  if (r.group !== undefined) {
    const g = r.group
    if (
      !isObj(g) ||
      !only(g, ['field', 'dir']) ||
      !(
        typeof g.field === 'string' &&
        Object.hasOwn(row, g.field) &&
        scalar(row[g.field])
      ) ||
      (g.dir !== undefined && !oneOf(g.dir, ['asc', 'desc']))
    )
      invalid('group', 'Its grouping field is not valid.')
  }
}
