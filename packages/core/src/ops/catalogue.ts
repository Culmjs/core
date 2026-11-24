import { KINDS } from '../document/index.ts'
import { walkBlocks } from '../document/tree.ts'
import { split } from '../document/motionSteps.ts'
import { defaultEffectSteps } from '../registry/effect.ts'
import {
  paintedStrokes,
  presetTarget,
  targetProblem,
} from '../validate/motionTargets.ts'
import { STATES } from '../document/layers.ts'
import { ID_RE, STYLE_GROUPS } from '../document/kinds.ts'
import type { KindSpec, PropField, Problem } from '../document/index.ts'
import type {
  BlockDef,
  DataSource,
  EffectDef,
  Registry,
} from '../registry/index.ts'
import { paged, tagOf } from './cap.ts'
import { GUIDE as GUIDE_ROWS } from './guide.ts'
import { RECIPES } from './recipes.ts'
import { OP_NAMES } from './plan.ts'
import { capped, cut, len, marker } from './read.ts'
import { refuse } from './types.ts'
import type { Head, Op, TreeRef } from './types.ts'

type Refusal = { ok: false; problems: Problem[] }
type Row = Record<string, unknown>
type What =
  | 'guide'
  | 'kinds'
  | 'operations'
  | 'recipes'
  | 'blocks'
  | 'sources'
  | 'effects'
/** Composition first: the guide, then what to compose with, then finished examples. */
const WHATS: readonly What[] = [
  'guide',
  'kinds',
  'operations',
  'recipes',
  'blocks',
  'sources',
  'effects',
]

// ---- limits. Every bound is a serialised length (`JSON.stringify(v).length`), never a count of characters.
/** A name, label, id or note in a row. */
const TEXT = 100
/** A guide in a detail view (at most 500 characters when registered, but a registry is not trusted). */
const GUIDE = 500
/** A guide in a list row. */
const GUIDE_LIST = 60
/** A look id, option label or option value. */
const SHORT = 80
/** Entries per list in a header; `squeeze` takes more out when the header is over its limit. */
const LISTED = 100
/** Options listed in a setting row. */
const OPTIONS = 50
/** Looks listed in a list row. */
const LOOKS_LIST = 10
/** A list row. */
const ROW = 4000
/** The header of a detail view (everything but the paged rows). */
const HEADER = 4000
/** One setting row of a detail view. */
const SETTING = 6000
/** The `settings` of a ready insert. */
const INSERT_SETTINGS = 1500
/** A string value of a sample row, a field type or a nested value. */
const VALUE = 200
/** The sample row. */
const SAMPLE = 2000
/** Names listed in `allowed` of an unknown id. */
const ALLOWED = 50
const DETAIL = 'call again with id for full settings'

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const str = (v: unknown, budget = TEXT) =>
  typeof v === 'string' ? cut(v, budget) : ''
const num = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined
const withNum = (k: string, v: unknown) =>
  num(v) === undefined ? {} : { [k]: num(v) }

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

/** A value cut down: strings to VALUE, lists to 20, objects to 50 keys, depth to 4. */
function trim(v: unknown, depth = 0): unknown {
  if (typeof v === 'string') return cut(v, VALUE)
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'boolean' || v === null) return v
  if (depth >= 4 || typeof v !== 'object') return undefined
  if (Array.isArray(v))
    return v.slice(0, 20).map(x => trim(x, depth + 1) ?? null)
  const out: Row = {}
  for (const [k, x] of Object.entries(v).slice(0, 50)) {
    const y = trim(x, depth + 1)
    if (y !== undefined) out[cut(k, TEXT)] = y
  }
  return out
}

const moreKey = (k: string) => `more${k[0].toUpperCase()}${k.slice(1)}`

/**
 * Brings a row under `limit`: while it is over, one entry leaves the end of the longest of the lists (or objects) named by `keys`
 * and `more<Key>` counts it. Then, only if the row is still over, the largest other field (never the first, which names the row)
 * is replaced by the marker `{ cut: <length> }`; a marker is small, so the loop ends.
 */
function squeeze(row: Row, limit: number, keys: string[]): Row {
  const out = { ...row }
  const size = (k: string) => {
    const v = out[k]
    return Array.isArray(v) ? v.length : isObj(v) ? Object.keys(v).length : 0
  }
  while (len(out) > limit) {
    const k = keys.reduce((a, b) =>
      len(out[b]) > len(out[a]) && size(b) ? b : a,
    )
    if (!size(k)) break
    const v = out[k]
    const before = size(k)
    // Drop about as many entries as the excess is long (at least one); the average entry length keeps it from dropping many too many.
    const drop = Math.max(
      1,
      Math.floor(((len(out) - limit) * size(k)) / Math.max(1, len(v))),
    )
    if (Array.isArray(v)) out[k] = v.slice(0, Math.max(0, v.length - drop))
    else {
      const keep = Object.entries(v as Row)
      out[k] = Object.fromEntries(
        keep.slice(0, Math.max(0, keep.length - drop)),
      )
    }
    out[moreKey(k)] =
      ((out[moreKey(k)] as number | undefined) ?? 0) + before - size(k)
  }
  const rest = Object.keys(out).slice(1)
  while (len(out) > limit) {
    let big: string | undefined
    for (const k of rest)
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

/** A setting row whose options are cut to OPTIONS and then further until the row is at most SETTING. */
function settingRow(
  row: Row,
  options: { items: unknown[]; more: number } | undefined,
): Row {
  if (!options) return row
  const out: Row = { ...row, options: options.items }
  if (options.more) out.moreOptions = options.more
  return squeeze(out, SETTING, ['options'])
}

/** What a view of one entry is: the entry's header and its settings as rows. */
type Detail = { header: Row; rows: Row[] }
type Entryview = { name: string; list(): Row; detail(): Detail }

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

function kindView(kind: string, spec: KindSpec): Entryview {
  const props = Object.entries(isObj(spec.props) ? spec.props : {}).filter(
    (e): e is [string, PropField & Record<string, unknown>] => isObj(e[1]),
  )
  const header = () => {
    const styles = listed(styleNames(spec.styles), LISTED, x => str(x))
    const states = listed(spec.states, LISTED, x => trim(x))
    const bindable = listed(spec.bindable, LISTED, x => str(x))
    const parents =
      spec.parents === 'any'
        ? undefined
        : listed(spec.parents, LISTED, x => str(x))
    const c = spec.children
    return squeeze(
      {
        kind: cut(kind, TEXT),
        label: str(spec.label),
        role: str(spec.role),
        parents: parents ? parents.items : 'any',
        ...(parents?.more ? { moreParents: parents.more } : {}),
        ...(isObj(c)
          ? {
              children: {
                min: num(c.min) ?? 0,
                ...withNum('max', c.max),
                ...(Array.isArray(c.kinds)
                  ? { kinds: listed(c.kinds, 20, x => str(x)).items }
                  : {}),
              },
            }
          : {}),
        styles: styles.items,
        ...(styles.more ? { moreStyles: styles.more } : {}),
        states: states.items,
        ...(states.more ? { moreStates: states.more } : {}),
        bindable: bindable.items,
        ...(bindable.more ? { moreBindable: bindable.more } : {}),
        repeatable: spec.repeatable === true,
      },
      HEADER,
      ['styles', 'states', 'bindable', 'parents'].filter(
        k => k !== 'parents' || parents,
      ),
    )
  }
  return {
    name: kind,
    // `kind(role): prop, prop, ...`, as many settings as fit in a row.
    list: () =>
      cut(
        `${cut(kind, TEXT)}(${str(spec.role)})${props.length ? ': ' : ''}${props.map(([k]) => cut(k, TEXT)).join(', ')}`,
        ROW,
      ) as never,
    detail: () => ({
      header: header(),
      rows: props.map(([key, f]) =>
        settingRow(
          {
            key: cut(key, TEXT),
            type: str(f.type),
            ...withNum('min', f.min),
            ...withNum('max', f.max),
            ...withNum('maxLength', f.maxLength),
            ...(typeof f.hint === 'string' ? { hint: str(f.hint, 300) } : {}),
          },
          Array.isArray(f.options)
            ? listed(f.options, OPTIONS, o =>
                typeof o === 'string' ? cut(o, SHORT) : undefined,
              )
            : undefined,
        ),
      ),
    }),
  }
}

// ---- blocks

/**
 * Where a ready insert goes: the first page of the given site, else the pages `emptySite` makes. An id that is not a valid id (a
 * caller's document is not trusted, and one very long id would make the insert too big to state) falls back to the same default.
 */
function target(site: Head | undefined): {
  tree: { page: string }
  parent: string
} {
  const p: unknown = arr(site?.doc?.pages)[0]
  return isObj(p) &&
    typeof p.id === 'string' &&
    ID_RE.test(p.id) &&
    isObj(p.root) &&
    typeof p.root.id === 'string' &&
    ID_RE.test(p.root.id)
    ? { tree: { page: p.id }, parent: p.root.id }
    : { tree: { page: 'home' }, parent: 'homeroot' }
}

/**
 * The settings a batch needs to be accepted: a select its first option, a number its minimum (else 0); the rest stays as the
 * look has it. A value or key too long to state whole is left out (the look's own content then stands, which is always accepted),
 * and so is every setting after the object would pass INSERT_SETTINGS.
 */
function needed(settings: unknown): Record<string, string | number> {
  const out: Record<string, string | number> = {}
  for (const s of arr(settings)) {
    if (!isObj(s) || typeof s.key !== 'string' || len(s.key) > TEXT) continue
    let v: string | number | undefined
    if (s.type === 'select') {
      const first = arr(s.options)[0]
      if (
        isObj(first) &&
        typeof first.value === 'string' &&
        len(first.value) <= SHORT
      )
        v = first.value
    } else if (s.type === 'number') v = num(s.min) ?? 0
    if (v === undefined) continue
    if (len({ ...out, [s.key]: v }) > INSERT_SETTINGS) break
    out[s.key] = v
  }
  return out
}

function blockView(b: BlockDef, site: Head | undefined): Entryview {
  const first = arr(b.looks)[0]
  const settingsNeeded = needed(b.settings)
  // The insert names the block and the look whole, so it is left out when either is longer than the row can show (a registry is not trusted).
  const insert =
    isObj(first) &&
    typeof first.id === 'string' &&
    len(first.id) <= SHORT &&
    len(b.id) <= TEXT
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
      : {}
  const defs = arr(b.settings).filter(isObj)
  const head = (guide: number) => ({
    block: str(b.id),
    version: num(b.version) ?? 0,
    name: str(b.name),
    category: str(b.category),
    ...(typeof b.guide === 'string' ? { guide: str(b.guide, guide) } : {}),
  })
  return {
    name: b.id,
    list: () => ({
      block: str(b.id),
      name: str(b.name),
      category: str(b.category),
      looks: listed(b.looks, LOOKS_LIST, l =>
        isObj(l) ? str(l.id, SHORT) : undefined,
      ).items,
      ...(typeof b.guide === 'string'
        ? { guide: str(b.guide, GUIDE_LIST) }
        : {}),
    }),
    detail: () => {
      const looks = listed(b.looks, LISTED, l =>
        isObj(l)
          ? { id: str(l.id, SHORT), name: str(l.name, SHORT) }
          : undefined,
      )
      return {
        header: squeeze(
          {
            ...head(GUIDE),
            looks: looks.items,
            ...(looks.more ? { moreLooks: looks.more } : {}),
            ...insert,
          },
          HEADER,
          ['looks'],
        ),
        rows: defs.map(s =>
          settingRow(
            {
              key: str(s.key),
              label: str(s.label),
              type: str(s.type),
              ...withNum('min', s.min),
              ...withNum('max', s.max),
            },
            Array.isArray(s.options)
              ? listed(s.options, OPTIONS, o =>
                  isObj(o)
                    ? { label: str(o.label, SHORT), value: str(o.value, SHORT) }
                    : undefined,
                )
              : undefined,
          ),
        ),
      }
    },
  }
}

// ---- sources

function sourceView(s: DataSource): Entryview {
  const sample = arr(s.sample)[0]
  const fields = isObj(s.fields) ? Object.entries(s.fields) : []
  const row = isObj(sample) ? trim(sample) : undefined
  const head = (guide: number) => ({
    source: str(s.name),
    ...(typeof s.guide === 'string' ? { guide: str(s.guide, guide) } : {}),
  })
  return {
    name: s.name,
    list: () =>
      squeeze(
        {
          ...head(GUIDE_LIST),
          fields: fields.slice(0, LISTED).map(([k]) => cut(k, TEXT)),
          ...(fields.length > LISTED
            ? { moreFields: fields.length - LISTED }
            : {}),
        },
        ROW,
        ['fields'],
      ),
    detail: () => ({
      header: squeeze(
        {
          ...head(GUIDE),
          fields: Object.fromEntries(
            fields.slice(0, LISTED).map(([k, t]) => [cut(k, TEXT), trim(t)]),
          ),
          ...(fields.length > LISTED
            ? { moreFields: fields.length - LISTED }
            : {}),
          ...(row === undefined
            ? {}
            : { sample: len(row) > SAMPLE ? marker(row) : row }),
        },
        HEADER,
        ['fields'],
      ),
      rows: [],
    }),
  }
}

// ---- effects

function effectExample(e: EffectDef, site?: Head) {
  const steps = defaultEffectSteps(e)
  const at = (tree: TreeRef, id: string) => ({
    example: {
      op: 'setMotion',
      tree,
      id,
      motion: { trigger: 'load', effect: e.name },
    } satisfies Op,
  })
  // As with ready inserts, a self-only example works on emptySite's home root.
  if (!site && steps?.every(s => s.target === 'self')) return at(T, ROOT)
  if (site && steps) {
    const { pages, header, footer } = site.doc
    for (const [tree, root] of [
      ...pages.map(p => [{ page: p.id }, p.root] as const),
      ['header', header],
      ['footer', footer],
    ] as const) {
      if (
        typeof tree === 'object' &&
        (typeof tree.page !== 'string' || !tree.page || tree.page.length > 100)
      )
        continue
      let id: string | undefined,
        painted: ReturnType<typeof paintedStrokes> | undefined
      walkBlocks(root, (w, ns) => {
        if (
          !id &&
          w.kind !== 'instance' &&
          typeof w.id === 'string' &&
          w.id.length <= 41 &&
          w.id.split('.').every(s => ID_RE.test(s)) &&
          steps.every(
            s =>
              !(s.target === 'children' && !w.children?.length) &&
              !targetProblem(
                w,
                presetTarget(w, s.target, ns),
                'draw' in s.from,
                () => (painted ??= paintedStrokes(root)),
              ),
          )
        )
          id = w.id
      })
      if (id) return at(tree, id)
    }
  }
  const targets = steps?.map(({ target: t, from }) =>
    typeof t === 'object'
      ? `descendant "${t.id}"${t.part ? ('draw' in from ? ' with a painted path stroke' : ' with path geometry') : ''}`
      : split.some(unit => unit === t)
        ? 'a text owner'
        : t === 'path'
          ? 'draw' in from
            ? 'an owner with a painted path stroke'
            : 'a path owner'
          : t === 'children'
            ? 'an owner with children'
            : 'a node',
  )
  return {
    requires: `Choose ${[...new Set(targets ?? ['a compatible owner'])].join(' and ')} for the default settings.`,
  }
}

function effectView(e: EffectDef, site: Head | undefined): Entryview {
  const head = () => ({ name: str(e.name), tier: e.tier })
  return {
    name: e.name,
    list: head,
    detail: () => {
      return {
        header: {
          ...head(),
          ...effectExample(e, site),
        },
        rows: Object.entries(e.settings).map(([key, s]) => ({
          key: cut(key, TEXT),
          type: 'number',
          min: num(s.min),
          max: num(s.max),
          default: num(s.default),
        })),
      }
    },
  }
}

// ---- operations

/** Whether the key `P` of `E` may be left out. */
type Optional<E, P extends keyof E> = object extends Pick<E, P> ? true : false
/** For each field of the operation (but `op`): its type text, and whether it is optional, which must be what `Op` says. */
type Fields<K extends Op['op']> = {
  [P in Exclude<keyof Extract<Op, { op: K }>, 'op'>]-?: [
    type: string,
    optional: Optional<Extract<Op, { op: K }>, P>,
  ]
}
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

const LAYER = `${STATES.map(l => `'${l}'`).join(' | ')} | { when: { state: string, is: string } }`
const TREE = "'header' | 'footer' | { page: id } | { component: id }"
const NODE =
  'a node: { kind, id?, name?, slot?, props?, style?, children? ... }'
const UNSET = 'object: key -> value | null (null unsets)'
const VALUE_T =
  'string | number | boolean | list | object (as the setting takes)'
const T = { page: 'home' }
const ROOT = 'homeroot'
const tree: [string, false] = [TREE, false]
const id: [string, false] = ['string', false]

/**
 * The operations in the order of the spec's table. Each example is accepted by `plan` after the ones before it, applied in
 * order as one growing batch sequence, starting from a site whose home page holds one text, `t`, with the kit registry.
 */
export const OPERATIONS: readonly Entry[] = [
  entry(
    'add',
    {
      tree,
      parent: ['string', false],
      index: ['number', false],
      node: [NODE, false],
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
      props: [UNSET, false],
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
      layer: [LAYER, false],
      decl: [UNSET, false],
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
      layout: ['desktop|tablet|phone', false],
      hidden: ['boolean', false],
    },
    { op: 'setHidden', tree: T, id: 't', layout: 'phone', hidden: true },
  ),
  entry(
    'setSlot',
    {
      tree,
      id,
      slot: ['object', true],
      placement: ['object|null', true],
    },
    { op: 'setSlot', tree: T, id: 't', slot: {} },
  ),
  entry(
    'setRequired',
    { tree, id, required: ['boolean|null', false] },
    { op: 'setRequired', tree: T, id: 'lst', required: true },
  ),
  entry(
    'bindData',
    {
      tree,
      id,
      repeat: ['object|null', true],
      bind: ['object|null', true],
      showIf: ['object|null', true],
      showIfAny: ['list|null', true],
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
    {
      tree,
      id,
      state: ['list|null', true],
      on: ['list|null', true],
    },
    {
      op: 'setStates',
      tree: T,
      id: 'box',
      state: [{ name: 'tab', values: ['one', 'two'], initial: 'one' }],
    },
  ),
  entry(
    'setMotion',
    { tree, id, motion: ['Motion|null', false] },
    {
      op: 'setMotion',
      tree: T,
      id: 't',
      motion: { trigger: 'load', effect: 'rise' },
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
      value: [VALUE_T, false],
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
    { tree, id, set: [UNSET, true], overrides: [UNSET, true] },
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
    {
      name: ['string', true],
      languages: ['list', true],
      centreMaxWidth: ['boolean', true],
    },
    { op: 'setSite', name: 'My site' },
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
    { styles: [UNSET, false] },
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

/** The legend of the operations list: a type longer than 24 characters is one of these keys. */
const LEGEND: Record<string, string> = {
  T: TREE,
  N: NODE,
  L: LAYER,
  U: UNSET,
  V: VALUE_T,
}
const KEY_OF = new Map(Object.entries(LEGEND).map(([k, v]) => [v, k]))
/** `name(field:type, field?:type)`; a long type is its legend key. */
const line = (o: Entry) =>
  `${o.op}(${o.fields
    .map(
      f => `${f.name}${f.optional ? '?' : ''}:${KEY_OF.get(f.type) ?? f.type}`,
    )
    .join(', ')})`

// ---- the query

const bad = (message: string, more: Partial<Problem> = {}): Refusal =>
  refuse('INVALID_OPERATION', message, more)

type Reply = { ok: true; rows: unknown[]; cut: boolean; cursor?: string }

/**
 * What an agent may insert and with which settings, and the operations it may send.
 *
 * A list view (no `id`) pages compact rows of at most 4,000 characters: a block or kind with its settings as `{ key, type }`. A
 * detail view (`id`) has the entry's header (at most 4,000) in every reply and pages its settings as rows (at most 6,000 each),
 * so nothing is replaced by a marker for being long. Operations and the ready insert operation of a block are in both.
 * It never throws: whatever is wrong with the query or the registry is a refusal.
 */
export function catalogue(
  registry: Registry,
  query: {
    what: What
    id?: string
    cursor?: string
    site?: Head
  },
): Reply | Refusal {
  try {
    if (!isObj(query))
      return bad('The query must be an object.', { path: 'query' })
    if (!WHATS.includes(query.what))
      return bad('Unknown "what".', { path: 'what', allowed: [...WHATS] })
    if (query.id !== undefined && typeof query.id !== 'string')
      return bad('"id" must be a string.', { path: 'id' })
    if (
      query.site !== undefined &&
      !(isObj(query.site) && isObj(query.site.doc))
    )
      return bad('"site" must be { doc, revision }.', { path: 'site' })
    const site = query.site
    const revision = query.what === 'effects' ? (site?.revision ?? 0) : 0
    let views: Entryview[]
    let unknown: 'UNKNOWN_KIND' | 'UNKNOWN_BLOCK' | 'UNKNOWN_SOURCE' | undefined
    if (query.what === 'kinds') {
      unknown = 'UNKNOWN_KIND'
      const extra = [...registry.kinds()].sort((a, b) =>
        a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
      )
      views = [...Object.entries(KINDS), ...extra].map(([k, spec]) =>
        kindView(k, spec as KindSpec),
      )
    } else if (query.what === 'blocks') {
      unknown = 'UNKNOWN_BLOCK'
      views = registry.blocks().map(b => blockView(b, site))
    } else if (query.what === 'sources') {
      unknown = 'UNKNOWN_SOURCE'
      views = registry.sources().map(sourceView)
    } else if (query.what === 'effects') {
      views = registry.effects().map(e => effectView(e, site))
    } else if (query.what === 'guide') {
      if (query.id !== undefined)
        return bad('The guide has no entries by id.', { path: 'id' })
      views = GUIDE_ROWS.map(g => ({
        name: g,
        list: () => g as never,
        detail: () => ({ header: {}, rows: [] }),
      }))
    } else if (query.what === 'recipes') {
      views = RECIPES.map(r => ({
        name: r.id,
        list: () => ({
          recipe: r.id,
          name: r.name,
          guide: str(r.guide, GUIDE_LIST),
          ops: r.ops.length,
        }),
        detail: () => ({
          header: {
            recipe: r.id,
            name: r.name,
            guide: r.guide,
            ops: r.ops.map((o, i) =>
              i === 0
                ? { ...o, ...target(site) }
                : 'tree' in o
                  ? { ...o, tree: target(site).tree }
                  : o,
            ),
          },
          rows: [],
        }),
      }))
    } else
      views = OPERATIONS.map(o => ({
        name: o.op,
        list: () => line(o) as never,
        detail: () => ({ header: {}, rows: [{ ...o }] }),
      }))
    const wrap =
      (header: Row) => (page: unknown[], cutIt: boolean, cursor?: string) => ({
        ok: true as const,
        ...header,
        rows: page,
        cut: cutIt,
        ...(cursor ? { cursor } : {}),
      })
    if (query.id !== undefined) {
      const hit = views.find(v => v.name === query.id)
      if (!hit) {
        const allowed = views.slice(0, ALLOWED).map(v => cut(v.name, TEXT))
        if (query.what === 'effects')
          return bad(`No effect "${cut(query.id, TEXT)}".`, {
            path: 'id',
            allowed,
          })
        if (query.what === 'recipes')
          return bad(`No recipe "${cut(query.id, TEXT)}".`, {
            path: 'id',
            allowed: RECIPES.map(r => r.id),
          })
        return unknown
          ? refuse(
              unknown,
              `No ${query.what.slice(0, -1)} "${cut(query.id, TEXT)}".`,
              { path: 'id', allowed },
            )
          : bad(`No operation "${cut(query.id, TEXT)}".`, {
              path: 'id',
              allowed: [...OP_NAMES],
            })
      }
      const { header, rows } = hit.detail()
      return capped(
        paged(
          rows,
          revision,
          query.cursor,
          tagOf('catalogue', query.what, query.id),
          wrap(header),
        ) as Reply | Refusal,
      )
    }
    return capped(
      paged(
        views.map(v => v.list()),
        revision,
        query.cursor,
        tagOf('catalogue', query.what, null),
        wrap(
          query.what === 'operations'
            ? { legend: LEGEND }
            : query.what === 'guide' || query.what === 'recipes'
              ? {}
              : { detail: DETAIL },
        ),
      ) as Reply | Refusal,
    )
  } catch {
    return bad(
      'The query or the registry is not in the shape the catalogue expects.',
    )
  }
}
