import { type Ref, type Repeat } from '../document/index.ts'
import { MAX_ROWS } from '../document/kinds.ts'
import { UNSAFE_FIELDS, isObj } from '../document/rules.ts'
import type { Row } from '../registry/index.ts'

/** Rows the caller supplies, by source name, and the values `site` references read, by whole dotted field name. */
export type Data = {
  rows: Record<string, readonly Row[]>
  values?: Record<string, unknown>
}
/** What a filter's `of` reference can read: the enclosing rows, innermost first, and the caller's values. */
export type Scope = {
  items: readonly Row[]
  values: Record<string, unknown>
}

/** Own-property reads only: a reference never evaluates a path or reaches the prototype. A reference that is not well formed reads nothing. */
export function readRef(r: Ref | undefined, scope: Scope): unknown {
  if (
    !isObj(r) ||
    typeof r.field !== 'string' ||
    UNSAFE_FIELDS.includes(r.field)
  )
    return undefined
  if (r.from === 'site')
    return Object.hasOwn(scope.values, r.field)
      ? scope.values[r.field]
      : undefined
  if (r.from !== 'item') return undefined
  const outer = r.outer === undefined ? 0 : r.outer
  if (!Number.isInteger(outer) || outer < 0 || outer > 63) return undefined
  const item = scope.items[outer]
  return (isObj(item) || Array.isArray(item)) && Object.hasOwn(item, r.field)
    ? item[r.field]
    : undefined
}

/** A value as page text: a string, a finite number or a boolean; anything else (missing, null, NaN, an object, a list) is an empty text, never a word for it. */
export const textOf = (v: unknown): string =>
  typeof v === 'string' ||
  typeof v === 'boolean' ||
  (typeof v === 'number' && Number.isFinite(v))
    ? String(v)
    : ''

/** Years are free text ("Sept 2019 to 2021"): they sort by the first four-digit year in them; none counts as missing. */
const firstYear = (v: unknown) => {
  const y = /\d{4}/.exec(
    typeof v === 'string' || typeof v === 'number' ? String(v) : '',
  )
  return y ? Number(y[0]) : undefined
}

function sorted(rows: Row[], field: string, dir: 'asc' | 'desc'): Row[] {
  const miss = (v: unknown) => v == null || v === ''
  const cmp = (a: unknown, b: unknown) =>
    typeof a === 'number' && typeof b === 'number'
      ? a - b
      : ((x, y) => (x < y ? -1 : x > y ? 1 : 0))(String(a), String(b))
  // Array.prototype.sort is stable.
  return [...rows].sort((x, y) => {
    const a = field === 'years' ? firstYear(x[field]) : x[field]
    const b = field === 'years' ? firstYear(y[field]) : y[field]
    if (miss(a) || miss(b)) return Number(miss(a)) - Number(miss(b))
    return dir === 'desc' ? cmp(b, a) : cmp(a, b)
  })
}

/** A whole number from 0 to `MAX_ROWS`; anything else is `fallback`. A list never shows more rows than that. */
const bounded = (v: unknown, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v)
    ? Math.max(0, Math.min(Math.trunc(v), MAX_ROWS))
    : fallback

/**
 * The rows a repeat shows: filter, exclude, sort, skip, max, and with `group` one row per value
 * (`key`, `label`, `count`, `items`). `scope` resolves a filter's `of` reference.
 */
export function rowsOf(
  source: readonly unknown[],
  repeat: Repeat,
  scope: Scope = { items: [], values: {} },
): Row[] {
  // A list of plain values (a `list` field) repeats each string and number as { value }; anything else that is not a row is skipped.
  const rows0: Row[] = []
  for (const x of Array.isArray(source) ? source : [])
    if (isObj(x)) rows0.push(x)
    else if (
      typeof x === 'string' ||
      (typeof x === 'number' && Number.isFinite(x))
    )
      rows0.push({ value: x })
  let rows = rows0
  const passes = (f: NonNullable<Repeat['filter']>) => {
    const is = f.of ? (readRef(f.of, scope) ?? f.is) : f.is
    return (x: Row) => {
      const v = x[f.field]
      return Array.isArray(v) ? v.includes(is) : v === is
    }
  }
  if (repeat.filter) rows = rows.filter(passes(repeat.filter))
  if (repeat.exclude) {
    const hit = passes(repeat.exclude)
    rows = rows.filter(x => !hit(x))
  }
  if (repeat.sort) rows = sorted(rows, repeat.sort.field, repeat.sort.dir)
  const skip = bounded(repeat.skip, 0)
  rows = rows.slice(skip, skip + bounded(repeat.max, MAX_ROWS))
  if (!repeat.group) return rows
  const groups = new Map<unknown, Row[]>()
  for (const row of rows) {
    const key = row[repeat.group.field]
    const into = groups.get(key)
    if (into) into.push(row)
    else groups.set(key, [row])
  }
  return sorted(
    [...groups].map(([key, items]) => ({
      key,
      label: textOf(key),
      count: items.length,
      items,
    })),
    'key',
    repeat.group.dir ?? 'desc',
  )
}
