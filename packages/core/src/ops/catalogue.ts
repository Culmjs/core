import { KINDS } from '../document/index.ts'
import { STYLE_GROUPS } from '../document/kinds.ts'
import type { KindSpec, Problem } from '../document/index.ts'
import type { BlockDef, DataSource, Registry } from '../registry/index.ts'
import { READ_CAP, paged } from './cap.ts'
import { OP_NAMES } from './plan.ts'
import { capped, cut, len, marker } from './read.ts'
import { refuse } from './types.ts'
import type { Head, Op } from './types.ts'

type Refusal = { ok: false; problems: Problem[] }
type Row = Record<string, unknown>
type What = 'kinds' | 'blocks' | 'sources' | 'operations'
const WHATS: readonly What[] = ['kinds', 'blocks', 'sources', 'operations']

// ---- limits. Every bound is a serialised length (`JSON.stringify(v).length`), never a count of characters.
/** A name, label, id or note in a row. */
const TEXT = 100
/** A guide (at most 500 characters when registered, but a registry is not trusted). */
const GUIDE = 500
/** Entries listed per list in a row; the rest is counted in `<list>More`. */
const LISTED = 50
/** The same when one entry is asked for by `id`. */
const LISTED_ONE = 200
/** A row among many. */
const ROW = 4000
/** The single entry of an `id` query. */
const ROW_ONE = READ_CAP / 2
/** A string value of a sample row, a field type or a nested value. */
const VALUE = 200
/** The sample row. */
const SAMPLE = 2000
/** Names listed in `allowed` of an unknown id. */
const ALLOWED = 50

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const str = (v: unknown, budget = TEXT) =>
  typeof v === 'string' ? cut(v, budget) : ''
const num = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined

/** Up to `n` entries mapped by `f`, and how many were left out. */
function listed<T>(
  list: unknown,
  n: number,
  f: (x: unknown) => T | undefined,
): { items: T[]; more: number } {
  const all = arr(list)
  const items: T[] = []
  for (const x of all.slice(0, n)) {
    const y = f(x)
    if (y !== undefined) items.push(y)
  }
  return { items, more: all.length - Math.min(all.length, n) }
}
const more = (key: string, n: number) => (n > 0 ? { [key]: n } : {})

/** A value cut down: strings to VALUE, lists to 20, objects to LISTED keys, depth to 4; what is left is counted or marked. */
function trim(v: unknown, depth = 0): unknown {
  if (typeof v === 'string') return cut(v, VALUE)
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'boolean' || v === null) return v
  if (depth >= 4 || typeof v !== 'object') return undefined
  if (Array.isArray(v))
    return v.slice(0, 20).map(x => trim(x, depth + 1) ?? null)
  const out: Row = {}
  for (const [k, x] of Object.entries(v).slice(0, LISTED)) {
    const y = trim(x, depth + 1)
    if (y !== undefined) out[cut(k, TEXT)] = y
  }
  return out
}

/**
 * Brings a row under `limit`: while it is over, its largest field (never the first one, which names the row) is replaced by the
 * marker `{ cut: <length> }`. A marker is small, so the loop ends.
 */
function fit(row: Row, limit: number): Row {
  const out = { ...row }
  const keys = Object.keys(out).slice(1)
  while (len(out) > limit) {
    let big: string | undefined
    for (const k of keys)
      if (
        !(isObj(out[k]) && Object.keys(out[k]).join() === 'cut') &&
        (big === undefined || len(out[k]) > len(out[big]))
      )
        big = k
    if (big === undefined) break
    out[big] = marker(out[big])
  }
  return out
}

// ---- kinds

function styleNames(styles: unknown): string[] {
  const held = new Set(arr(styles).filter(s => typeof s === 'string'))
  const groups: string[] = []
  const inGroup = new Set<string>()
  for (const [name, props] of Object.entries(STYLE_GROUPS))
    if (props.length && props.every(p => held.has(p))) {
      groups.push(name)
      for (const p of props) inGroup.add(p)
    }
  return [
    ...groups,
    ...[...held].filter(p => !inGroup.has(p as string)),
  ] as string[]
}

function kindRow(kind: string, spec: KindSpec, n: number): Row {
  const props = Object.entries(isObj(spec.props) ? spec.props : {})
  const settings = listed(props, n, e => {
    const [key, f] = e as [string, Record<string, unknown>]
    if (!isObj(f)) return undefined
    const options = Array.isArray(f.options)
      ? listed(f.options, n, o =>
          typeof o === 'string' ? cut(o, TEXT) : undefined,
        )
      : undefined
    return {
      key: cut(key, TEXT),
      type: str(f.type),
      ...(num(f.min) === undefined ? {} : { min: num(f.min) }),
      ...(num(f.max) === undefined ? {} : { max: num(f.max) }),
      ...(num(f.maxLength) === undefined
        ? {}
        : { maxLength: num(f.maxLength) }),
      ...(options
        ? { options: options.items, ...more('optionsMore', options.more) }
        : {}),
    }
  })
  const styles = listed(styleNames(spec.styles), n, x => str(x))
  const states = listed(spec.states, n, x => trim(x))
  const bindable = listed(spec.bindable, n, x => str(x))
  const parents =
    spec.parents === 'any' ? undefined : listed(spec.parents, n, x => str(x))
  const c = spec.children
  return fit(
    {
      kind: cut(kind, TEXT),
      label: str(spec.label),
      role: str(spec.role),
      parents: parents ? parents.items : 'any',
      ...(parents ? more('parentsMore', parents.more) : {}),
      ...(isObj(c)
        ? {
            children: {
              min: num(c.min) ?? 0,
              ...(num(c.max) === undefined ? {} : { max: num(c.max) }),
              ...(Array.isArray(c.kinds)
                ? { kinds: listed(c.kinds, n, x => str(x)).items }
                : {}),
            },
          }
        : {}),
      settings: settings.items,
      ...more('settingsMore', settings.more),
      styles: styles.items,
      ...more('stylesMore', styles.more),
      states: states.items,
      ...more('statesMore', states.more),
      bindable: bindable.items,
      ...more('bindableMore', bindable.more),
      repeatable: spec.repeatable === true,
    },
    n === LISTED ? ROW : ROW_ONE,
  )
}

// ---- blocks

/** Where a ready insert goes: the first page of the given site, else the pages `emptySite` makes. */
function target(site: Head | undefined): {
  tree: { page: string }
  parent: string
} {
  const p = site?.doc.pages[0]
  return p
    ? { tree: { page: p.id }, parent: p.root.id }
    : { tree: { page: 'home' }, parent: 'homeroot' }
}

/** The settings a batch needs to be accepted: a select its first option, a number its minimum (else 0); the rest stays as the look has it. */
function needed(settings: unknown): Record<string, string | number> {
  const out: Record<string, string | number> = {}
  for (const s of arr(settings)) {
    if (!isObj(s) || typeof s.key !== 'string') continue
    if (s.type === 'select') {
      const first = arr(s.options)[0]
      if (isObj(first) && typeof first.value === 'string')
        out[s.key] = first.value
    } else if (s.type === 'number') out[s.key] = num(s.min) ?? 0
  }
  return out
}

function blockRow(b: BlockDef, site: Head | undefined, n: number): Row {
  const looks = listed(b.looks, n, l =>
    isObj(l) ? { id: str(l.id), name: str(l.name) } : undefined,
  )
  const settings = listed(b.settings, n, s => {
    if (!isObj(s)) return undefined
    const options = Array.isArray(s.options)
      ? listed(s.options, n, o =>
          isObj(o) ? { label: str(o.label), value: str(o.value) } : undefined,
        )
      : undefined
    return {
      key: str(s.key),
      label: str(s.label),
      type: str(s.type),
      ...(num(s.min) === undefined ? {} : { min: num(s.min) }),
      ...(num(s.max) === undefined ? {} : { max: num(s.max) }),
      ...(options
        ? { options: options.items, ...more('optionsMore', options.more) }
        : {}),
    }
  })
  const first = arr(b.looks)[0]
  const settingsNeeded = needed(b.settings)
  return fit(
    {
      block: str(b.id),
      version: num(b.version) ?? 0,
      name: str(b.name),
      category: str(b.category),
      ...(typeof b.guide === 'string' ? { guide: str(b.guide, GUIDE) } : {}),
      looks: looks.items,
      ...more('looksMore', looks.more),
      settings: settings.items,
      ...more('settingsMore', settings.more),
      ...(isObj(first)
        ? {
            insert: {
              op: 'insertBlock',
              ...target(site),
              index: 0,
              block: b.id,
              look: first.id as string,
              ...(Object.keys(settingsNeeded).length
                ? { settings: settingsNeeded }
                : {}),
            } satisfies Op,
          }
        : {}),
    },
    n === LISTED ? ROW : ROW_ONE,
  )
}

// ---- sources

function sourceRow(s: DataSource, n: number): Row {
  const sample = arr(s.sample)[0]
  const fields = isObj(s.fields) ? Object.entries(s.fields) : []
  const kept = Object.fromEntries(
    fields.slice(0, n).map(([k, t]) => [cut(k, TEXT), trim(t)]),
  )
  const row = isObj(sample) ? trim(sample) : undefined
  return fit(
    {
      source: str(s.name),
      ...(typeof s.guide === 'string' ? { guide: str(s.guide, GUIDE) } : {}),
      fields: kept,
      ...more('fieldsMore', fields.length - Object.keys(kept).length),
      ...(row === undefined
        ? {}
        : { sample: len(row) > SAMPLE ? marker(row) : row }),
    },
    n === LISTED ? ROW : ROW_ONE,
  )
}

// ---- operations

type Fields<K extends Op['op']> = Record<
  Exclude<keyof Extract<Op, { op: K }>, 'op'>,
  [type: string, optional: boolean]
>
type Entry = {
  op: Op['op']
  fields: { name: string; type: string; optional: boolean }[]
  example: Op
}
/** One operation: its fields (every one but `op`, checked against the `Op` type) and an example. */
function entry<K extends Op['op']>(
  op: K,
  fields: Fields<K>,
  example: Extract<Op, { op: K }>,
): Entry {
  return {
    op,
    fields: Object.entries(fields as Record<string, [string, boolean]>).map(
      ([name, [type, optional]]) => ({
        name,
        type: type as string,
        optional: optional as boolean,
      }),
    ),
    example,
  }
}

const T = { page: 'home' }
const ROOT = 'homeroot'
const tree = ['tree', false] as [string, boolean]
const id = ['string', false] as [string, boolean]

/**
 * The 26 operations in the order of the spec's table. Each example is accepted by `plan` after the ones before it, applied in
 * order as one growing batch sequence, starting from a site whose home page holds one text, `t`, with the kit registry.
 */
export const OPERATIONS: readonly Entry[] = [
  entry(
    'add',
    {
      tree,
      parent: ['string', false],
      index: ['number', false],
      node: ['node', false],
    },
    {
      op: 'add',
      tree: T,
      parent: ROOT,
      index: 1,
      node: {
        id: 'box',
        kind: 'column',
        children: [
          {
            id: 'lst',
            kind: 'list',
            children: [{ id: 'row', kind: 'column' }],
          },
          {
            id: 'bt',
            kind: 'text',
            props: { level: 'p', runs: [{ text: 'Hi' }] },
          },
          {
            id: 'sub',
            kind: 'text',
            props: { level: 'p', runs: [{ text: 'Label' }] },
          },
        ],
      },
    },
  ),
  entry('remove', { tree, id }, { op: 'remove', tree: T, id: 'bt' }),
  entry(
    'move',
    {
      tree,
      id,
      parent: ['string', false],
      index: ['number', false],
      slot: ['object', true],
    },
    { op: 'move', tree: T, id: 'lst', parent: ROOT, index: 2 },
  ),
  entry(
    'setProps',
    {
      tree,
      id,
      props: ['object (a value, or null to remove it)', false],
      name: ['string', true],
    },
    { op: 'setProps', tree: T, id: 't', props: { level: 'h2' }, name: 'Title' },
  ),
  entry(
    'setText',
    { tree, id, text: ['string', false] },
    { op: 'setText', tree: T, id: 't', text: 'Welcome' },
  ),
  entry(
    'setStyle',
    {
      tree,
      id,
      layer: [
        "string ('base', 'tablet', 'phone', 'hover', 'dark') | object",
        false,
      ],
      decl: ['object (a style value, or null to remove it)', false],
    },
    {
      op: 'setStyle',
      tree: T,
      id: 't',
      layer: 'base',
      decl: { italic: true },
    },
  ),
  entry(
    'setHidden',
    {
      tree,
      id,
      layout: ["string ('desktop', 'tablet', 'phone')", false],
      hidden: ['boolean', false],
    },
    { op: 'setHidden', tree: T, id: 't', layout: 'phone', hidden: true },
  ),
  entry(
    'setSlot',
    { tree, id, slot: ['object', true], placement: ['object | null', true] },
    { op: 'setSlot', tree: T, id: 't', slot: {} },
  ),
  entry(
    'setRequired',
    { tree, id, required: ['boolean | null', false] },
    { op: 'setRequired', tree: T, id: 'lst', required: true },
  ),
  entry(
    'bindData',
    {
      tree,
      id,
      repeat: ['object | null', true],
      bind: ['object | null', true],
      showIf: ['object | null', true],
      showIfAny: ['list | null', true],
    },
    {
      op: 'bindData',
      tree: T,
      id: 'lst',
      repeat: { source: 'projects', max: 6 },
    },
  ),
  entry(
    'setStates',
    { tree, id, state: ['list | null', true], on: ['list | null', true] },
    {
      op: 'setStates',
      tree: T,
      id: 'box',
      state: [{ name: 'tab', values: ['one', 'two'], initial: 'one' }],
    },
  ),
  entry(
    'insertBlock',
    {
      tree,
      parent: ['string', false],
      index: ['number', false],
      block: ['string', false],
      look: ['string', false],
      settings: ['object', true],
      id: ['string', true],
    },
    {
      op: 'insertBlock',
      tree: T,
      parent: ROOT,
      index: 3,
      block: 'stamp',
      look: 'default',
      id: 'st1',
    },
  ),
  entry(
    'setBlockSetting',
    {
      tree,
      id,
      key: ['string', false],
      value: ['string | number | boolean', false],
    },
    { op: 'setBlockSetting', tree: T, id: 'st1', key: 'title', value: 'Hello' },
  ),
  entry('updateBlock', { tree, id }, { op: 'updateBlock', tree: T, id: 'st1' }),
  entry(
    'makeComponent',
    { tree, id, component: ['string', false], name: ['string', false] },
    {
      op: 'makeComponent',
      tree: T,
      id: 'box',
      component: 'card',
      name: 'Card',
    },
  ),
  entry(
    'setInstance',
    { tree, id, set: ['object', true], overrides: ['object', true] },
    {
      op: 'setInstance',
      tree: T,
      id: 'box',
      overrides: { sub: { hide: { phone: true } } },
    },
  ),
  entry('detach', { tree, id }, { op: 'detach', tree: T, id: 'box' }),
  entry(
    'removeComponent',
    { component: ['string', false] },
    { op: 'removeComponent', component: 'card' },
  ),
  entry(
    'addPage',
    {
      title: ['string', false],
      slug: ['string', false],
      page: ['string', true],
      index: ['number', true],
      on: ['boolean', true],
      inMenu: ['boolean', true],
      inFooter: ['boolean', true],
      icon: ['string', true],
    },
    { op: 'addPage', title: 'About', slug: '/about', page: 'about' },
  ),
  entry(
    'removePage',
    { page: ['string', false] },
    { op: 'removePage', page: 'about' },
  ),
  entry(
    'setPage',
    {
      page: ['string', false],
      title: ['string', true],
      slug: ['string', true],
      on: ['boolean', true],
      inMenu: ['boolean', true],
      inFooter: ['boolean', true],
      icon: ['string', true],
    },
    { op: 'setPage', page: 'home', title: 'Start' },
  ),
  entry(
    'movePage',
    { page: ['string', false], index: ['number', false] },
    { op: 'movePage', page: 'home', index: 0 },
  ),
  entry(
    'setSite',
    { name: ['string', true], languages: ['list', true] },
    { op: 'setSite', name: 'Ada Lovelace' },
  ),
  entry(
    'setLook',
    { look: ['object', false] },
    {
      op: 'setLook',
      look: {
        id: 'warm',
        name: 'Warm',
        family: 'Minimal',
        brand: '#aa5522',
        ink: '#111111',
        bg: '#ffffff',
        headingFont: 'sys:serif',
        bodyFont: 'sys:sans',
        corners: 8,
        dark: 'auto',
      },
    },
  ),
  entry(
    'setSiteStyles',
    { styles: ['object (a part, or null to remove it)', false] },
    {
      op: 'setSiteStyles',
      styles: { colors: [{ id: 'sun', name: 'Sun', value: '#ffcc00' }] },
    },
  ),
  entry(
    'setFonts',
    { fonts: ['list', false] },
    { op: 'setFonts', fonts: ['sys:serif'] },
  ),
]

// ---- the query

const bad = (message: string, more: Partial<Problem> = {}): Refusal =>
  refuse('INVALID_OPERATION', message, more)

/** A head whose first page can take an insert. */
function headOf(site: unknown): Head | undefined {
  if (!isObj(site) || !isObj(site.doc)) return undefined
  const p = arr(site.doc.pages)[0]
  if (!isObj(p) || typeof p.id !== 'string') return undefined
  if (!isObj(p.root) || typeof p.root.id !== 'string') return undefined
  return site as unknown as Head
}

/**
 * What an agent may insert and with which settings, and the operations it may send. The rows are paged within READ_CAP; one row
 * is at most 4,000 characters of JSON by construction (a lists is cut, a name clipped, a too-big field replaced by `{ cut: n }`).
 * It never throws: whatever is wrong with the query is a refusal.
 */
export function catalogue(
  registry: Registry,
  query: {
    what: What
    id?: string
    cursor?: string
    site?: Head
  },
): { ok: true; rows: unknown[]; cut: boolean; cursor?: string } | Refusal {
  try {
    if (!isObj(query))
      return bad('The query must be an object.', { path: 'query' })
    if (!WHATS.includes(query.what))
      return bad('Unknown "what".', { path: 'what', allowed: [...WHATS] })
    if (query.id !== undefined && typeof query.id !== 'string')
      return bad('"id" must be a string.', { path: 'id' })
    let site: Head | undefined
    if (query.site !== undefined) {
      site = headOf(query.site)
      if (!site)
        return bad('"site" must be { doc, revision } with a first page.', {
          path: 'site',
        })
    }
    const one = query.id !== undefined
    const n = one ? LISTED_ONE : LISTED
    // The entries as [name, build]: a row is built only when it is asked for.
    let entries: [string, () => Row][]
    let unknown: 'UNKNOWN_KIND' | 'UNKNOWN_BLOCK' | 'UNKNOWN_SOURCE' | undefined
    if (query.what === 'kinds') {
      unknown = 'UNKNOWN_KIND'
      const extra = [...registry.kinds()].sort((a, b) =>
        a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
      )
      entries = [...Object.entries(KINDS), ...extra].map(([k, spec]) => [
        k,
        () => kindRow(k, spec as KindSpec, n),
      ])
    } else if (query.what === 'blocks') {
      unknown = 'UNKNOWN_BLOCK'
      entries = registry.blocks().map(b => [b.id, () => blockRow(b, site, n)])
    } else if (query.what === 'sources') {
      unknown = 'UNKNOWN_SOURCE'
      entries = registry.sources().map(s => [s.name, () => sourceRow(s, n)])
    } else entries = OPERATIONS.map(o => [o.op, () => fit({ ...o }, ROW_ONE)])
    if (one) {
      const hit = entries.find(([name]) => name === query.id)
      if (!hit) {
        const allowed = entries
          .slice(0, ALLOWED)
          .map(([name]) => cut(name, TEXT))
        return unknown
          ? refuse(
              unknown,
              `No ${query.what.slice(0, -1)} "${cut(query.id!, TEXT)}".`,
              {
                path: 'id',
                allowed,
              },
            )
          : bad(`No operation "${cut(query.id!, TEXT)}".`, {
              path: 'id',
              allowed: [...OP_NAMES],
            })
      }
      return capped({ ok: true as const, rows: [hit[1]()], cut: false })
    }
    const rows = entries.map(([, build]) => build())
    return capped(
      paged(rows, 0, query.cursor, (page, cutIt, cursor) => ({
        ok: true as const,
        rows: page,
        cut: cutIt,
        ...(cursor ? { cursor } : {}),
      })) as
        { ok: true; rows: unknown[]; cut: boolean; cursor?: string } | Refusal,
    )
  } catch {
    return bad(
      'The query or the registry is not in the shape the catalogue expects.',
    )
  }
}
