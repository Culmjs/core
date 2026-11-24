import assert from 'node:assert/strict'
import { test } from 'node:test'
import { emptySite, KINDS } from '../../src/document/index.ts'
import { STATES } from '../../src/document/layers.ts'
import type { Node } from '../../src/document/index.ts'
import { READ_CAP } from '../../src/ops/cap.ts'
import { catalogue, OPERATIONS } from '../../src/ops/catalogue.ts'
import { OP_NAMES, plan } from '../../src/ops/plan.ts'
import { createRegistry } from '../../src/registry/index.ts'
import type { BlockDef, Plugin } from '../../src/registry/index.ts'
import { LOOK, kitRegistry, sampleRegistry, siteWith, text } from '../kit.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ok = (r: any): any => {
  assert.equal(r.ok, true, JSON.stringify(r))
  return r
}
const size = (r: unknown) => JSON.stringify(r).length
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const refused = (r: any) => {
  assert.equal(r.ok, false, JSON.stringify(r).slice(0, 300))
  return r.problems[0] as { code: string; allowed?: string[]; path?: string }
}
const all = (registry = kitRegistry(), what = 'blocks' as const) => {
  const rows: Record<string, unknown>[] = []
  let cursor: string | undefined
  do {
    const r = ok(catalogue(registry, { what, cursor }))
    rows.push(...r.rows)
    cursor = r.cursor
  } while (cursor)
  return rows
}
/** Every setting row of the detail view of one entry, over all its pages; each reply is checked against the cap. */
const detailRows = (
  registry: ReturnType<typeof kitRegistry>,
  what: 'kinds' | 'blocks',
  id: string,
) => {
  const rows: Record<string, unknown>[] = []
  let cursor: string | undefined
  do {
    const r = ok(catalogue(registry, { what, id, cursor }))
    assert.ok(size(r) <= READ_CAP, `${size(r)}`)
    for (const x of r.rows) assert.ok(size(x) <= 6000, `row ${size(x)}`)
    rows.push(...r.rows)
    cursor = r.cursor
  } while (cursor)
  return rows
}
/** The detail reply of one block: its header holds the ready insert. */
const one = (
  registry: ReturnType<typeof kitRegistry>,
  id: string,
  site?: unknown,
) =>
  ok(
    catalogue(registry, {
      what: 'blocks',
      id,
      ...(site ? { site } : {}),
    } as never),
  )
const plugin = (name: string, more: Partial<Plugin>): Plugin => ({
  name,
  version: 1,
  api: [1],
  runs: ['build'],
  trust: 'declarative',
  ...more,
})
/** A block of `n` select settings of `k` short options each. */
const selects = (
  id: string,
  n: number,
  k: number,
  value = (i: number, j: number) => `o${i}x${j}`,
): BlockDef => ({
  id,
  version: 1,
  name: id,
  category: 'utility',
  looks: [{ id: 'default', name: 'Default', tree: sampleBlockTree() }],
  settings: Array.from({ length: n }, (_, i) => ({
    key: `sel${i}`,
    label: `Select ${i}`,
    type: 'select' as const,
    options: Array.from({ length: k }, (_, j) => ({
      label: `Option ${j}`,
      value: value(i, j),
    })),
    actions: [{ do: 'set' as const, path: 'x.props.runs.0.text' }],
  })),
})
const request = (ops: unknown[], key = 'k') => ({
  site: 's',
  baseRevision: 0,
  key,
  ops: ops as never,
})

test('every core kind and every plug-in kind appears', () => {
  const rows = all(kitRegistry(), 'kinds' as never) as unknown as string[]
  assert.deepEqual(
    rows.map(r => r.slice(0, r.indexOf('('))),
    [...Object.keys(KINDS), 'badge'],
  )
  const textRow = rows.find(r => r.startsWith('text(leaf): ')) as string
  for (const k of ['level', 'runs']) assert.ok(textRow.includes(k), k)
  for (const r of rows) assert.ok(r.length <= 4000, `${r}`)
  // the detail view has the styles as group names then single properties
  const d = ok(catalogue(kitRegistry(), { what: 'kinds', id: 'column' }))
  assert.ok(d.styles.includes('LAYOUT'), JSON.stringify(d.styles))
  assert.equal(d.kind, 'column')
  // every setting of a kind is a row of its detail view
  for (const k of ['button', 'text', 'badge']) {
    const keys = detailRows(kitRegistry(), 'kinds', k).map(r => r.key)
    const spec =
      k === 'badge'
        ? ['label', 'tip']
        : Object.keys(
            (KINDS as never as Record<string, { props: object }>)[k].props,
          )
    assert.deepEqual(keys, spec, k)
  }
})

test('every registered block appears with every look and setting; every source with its fields and first sample row', () => {
  const r = kitRegistry()
  const blocks = all(r)
  assert.deepEqual(
    blocks.map(b => b.block),
    ['demo', 'stamp'],
  )
  const demo = blocks[0] as never as {
    name: string
    category: string
    looks: string[]
  }
  assert.deepEqual(demo.looks, ['default'])
  assert.equal(demo.category, 'utility')
  const detail = detailRows(r, 'blocks', 'demo') as never as {
    key: string
    label: string
    min?: number
    max?: number
  }[]
  assert.deepEqual(
    detail.map(x => x.key),
    ['heading', 'limit', 'hidenote', 'upper'],
  )
  assert.equal(detail[1].min, 1)
  assert.equal(detail[1].max, 200)
  assert.equal(detail[0].label, 'Heading')

  const reg = createRegistry()
  reg.use({
    name: 'data',
    version: 1,
    api: [1],
    runs: ['build'],
    trust: 'declarative',
    guide: undefined,
    sources: [
      {
        name: 'talks',
        guide: 'Talks given.',
        fields: { title: 'text', year: 'number' },
        sample: [
          { title: 'First', year: 2020 },
          { title: 'Second', year: 2021 },
        ],
      },
      { name: 'empty', fields: { a: 'text' }, sample: [] },
    ],
  } as Plugin)
  const s = all(reg, 'sources' as never)
  assert.deepEqual(s[0], {
    source: 'talks',
    guide: 'Talks given.',
    fields: ['title', 'year'],
  })
  assert.deepEqual(s[1], { source: 'empty', fields: ['a'] })
  const d = ok(catalogue(reg, { what: 'sources', id: 'talks' }))
  assert.deepEqual(d.fields, { title: 'text', year: 'number' })
  assert.deepEqual(d.sample, { title: 'First', year: 2020 })
  assert.deepEqual(d.rows, [])
  assert.equal(
    'sample' in ok(catalogue(reg, { what: 'sources', id: 'empty' })),
    false,
  )
  assert.deepEqual(
    all(kitRegistry(), 'sources' as never).map(x => x.source),
    ['projects'],
  )
})

test('for each block, a batch of only its ready insert operation is accepted by plan', () => {
  for (const registry of [kitRegistry(), sampleRegistry()]) {
    // with a site given
    const doc = siteWith([text('t', 'Hello')])
    const names = all(registry).map(r => r.block as string)
    for (const name of names) {
      const row = one(registry, name, { doc, revision: 3 })
      assert.equal(row.insert.tree.page, doc.pages[0].id)
      assert.equal(row.insert.parent, doc.pages[0].root.id)
      assert.equal('id' in row.insert, false)
      ok(plan(doc, registry, request([row.insert])))
    }
    // without it, on emptySite
    const empty = emptySite('Ada', LOOK)
    for (const name of names) {
      const row = one(registry, name)
      assert.deepEqual(row.insert.tree, { page: 'home' })
      assert.equal(row.insert.parent, 'homeroot')
      ok(plan(empty, registry, request([row.insert])))
    }
  }
})

test('a ready operation sets each select to its first option and each number to its minimum', () => {
  const block: BlockDef = {
    id: 'pick',
    version: 1,
    name: 'Pick',
    category: 'utility',
    looks: [
      { id: 'a', name: 'A', tree: sampleBlockTree() },
      { id: 'b', name: 'B', tree: sampleBlockTree() },
    ],
    settings: [
      {
        key: 'size',
        label: 'Size',
        type: 'select',
        options: [
          { label: 'Small', value: 's' },
          { label: 'Large', value: 'l' },
        ],
        actions: [{ do: 'set', path: 'x.props.runs.0.text' }],
      },
      {
        key: 'count',
        label: 'Count',
        type: 'number',
        min: 3,
        max: 9,
        actions: [{ do: 'set', path: 'x.props.runs.0.text' }],
      },
      {
        key: 'free',
        label: 'Free',
        type: 'number',
        actions: [{ do: 'set', path: 'x.props.runs.0.text' }],
      },
      {
        key: 'words',
        label: 'Words',
        type: 'text',
        actions: [{ do: 'set', path: 'x.props.runs.0.text' }],
      },
    ],
  }
  const reg = createRegistry()
  reg.use({
    name: 'p',
    version: 1,
    api: [1],
    runs: ['build'],
    trust: 'declarative',
    blocks: [block],
  })
  const row = one(reg, 'pick')
  assert.equal(row.insert.look, 'a')
  assert.deepEqual(row.insert.settings, { size: 's', count: 3, free: 0 })
})

function sampleBlockTree(): Node {
  return {
    id: 'root',
    kind: 'column',
    name: 'Pick',
    slot: {},
    children: [text('x', 'x')],
  }
}

test('OPERATIONS has one entry per name in OP_NAMES, in that order', () => {
  assert.deepEqual(
    OPERATIONS.map(o => o.op),
    [...OP_NAMES],
  )
  const rows = all(kitRegistry(), 'operations' as never) as unknown as string[]
  assert.deepEqual(
    rows.map(r => r.slice(0, r.indexOf('('))),
    [...OP_NAMES],
  )
})

test('every operation example is accepted by plan on its fixture', () => {
  const registry = kitRegistry()
  let doc = siteWith([text('t', 'Hello')])
  for (const [i, entry] of OPERATIONS.entries()) {
    const r = plan(doc, registry, request([entry.example], `k${i}`))
    assert.equal(r.ok, true, `${entry.op}: ${JSON.stringify(r)}`)
    if (r.ok) doc = r.doc
  }
})

test('the fields of each entry are exactly the keys of its example plus its optional fields', () => {
  for (const e of OPERATIONS) {
    const names = e.fields.map(f => f.name)
    assert.equal(new Set(names).size, names.length, e.op)
    assert.ok(!names.includes('op'), e.op)
    for (const k of Object.keys(e.example))
      if (k !== 'op') assert.ok(names.includes(k), `${e.op}.${k}`)
    for (const f of e.fields)
      if (!(f.name in e.example))
        assert.equal(f.optional, true, `${e.op}.${f.name} is not optional`)
    assert.equal(e.example.op, e.op)
    for (const f of e.fields) assert.equal(typeof f.type, 'string')
  }
})

test('with 300 registered blocks, replies page through within READ_CAP and reach every block', () => {
  const reg = createRegistry()
  for (let i = 0; i < 300; i++)
    reg.use({
      name: `plug${i}`,
      version: 1,
      api: [1],
      runs: ['build'],
      trust: 'declarative',
      blocks: [
        {
          id: `blk${i}`,
          version: 1,
          name: `Block ${i}`,
          category: 'utility',
          looks: [{ id: 'default', name: 'Default', tree: sampleBlockTree() }],
          settings: [],
        },
      ],
    })
  const seen: string[] = []
  let cursor: string | undefined
  let pages = 0
  let largest = 0
  do {
    const r = ok(catalogue(reg, { what: 'blocks', cursor }))
    assert.ok(size(r) <= READ_CAP, `${size(r)}`)
    largest = Math.max(largest, size(r))
    seen.push(...r.rows.map((x: { block: string }) => x.block))
    cursor = r.cursor
    pages++
    assert.equal(r.cut, cursor !== undefined)
  } while (cursor)
  assert.ok(pages > 1)
  assert.deepEqual(
    seen,
    Array.from({ length: 300 }, (_, i) => `blk${i}`),
  )
  assert.equal(
    refused(catalogue(reg, { what: 'blocks', cursor: 'x' })).code,
    'INVALID_OPERATION',
  )
})

test('an unknown what and an unknown id are refused with allowed', () => {
  const r = kitRegistry()
  const w = refused(catalogue(r, { what: 'nope' as never }))
  assert.equal(w.code, 'INVALID_OPERATION')
  assert.deepEqual(w.allowed, [
    'guide',
    'kinds',
    'operations',
    'recipes',
    'blocks',
    'sources',
    'effects',
  ])
  const k = refused(catalogue(r, { what: 'kinds', id: 'zzz' }))
  assert.equal(k.code, 'UNKNOWN_KIND')
  assert.ok(k.allowed!.includes('text') && k.allowed!.includes('badge'))
  const b = refused(catalogue(r, { what: 'blocks', id: 'zzz' }))
  assert.equal(b.code, 'UNKNOWN_BLOCK')
  assert.deepEqual(b.allowed, ['demo', 'stamp'])
  const s = refused(catalogue(r, { what: 'sources', id: 'zzz' }))
  assert.equal(s.code, 'UNKNOWN_SOURCE')
  assert.deepEqual(s.allowed, ['projects'])
  const o = refused(catalogue(r, { what: 'operations', id: 'zzz' }))
  assert.equal(o.code, 'INVALID_OPERATION')
  assert.deepEqual(o.allowed, [...OP_NAMES])
})

test('id narrows to one entry', () => {
  const r = kitRegistry()
  assert.equal(ok(catalogue(r, { what: 'kinds', id: 'badge' })).kind, 'badge')
  const b = ok(catalogue(r, { what: 'blocks', id: 'stamp' }))
  assert.equal(b.block, 'stamp')
  assert.equal(b.insert.block, 'stamp')
  assert.deepEqual(
    b.rows.map((x: { key: string }) => x.key),
    ['title', 'shout'],
  )
  const op = ok(catalogue(r, { what: 'operations', id: 'setText' }))
  assert.equal(op.rows.length, 1)
  assert.equal(op.rows[0].op, 'setText')
  assert.equal(op.cut, false)
})

test('a list view is a terse row per block and says where the detail is', () => {
  const reg = createRegistry()
  reg.use(plugin('ten', { blocks: [selects('ten', 10, 10)] }))
  const r = ok(catalogue(reg, { what: 'blocks' }))
  assert.equal(r.detail, 'call again with id for full settings')
  assert.deepEqual(r.rows[0], {
    block: 'ten',
    name: 'ten',
    category: 'utility',
    looks: ['default'],
  })
  assert.ok(ok(catalogue(reg, { what: 'kinds' })).detail)
  assert.ok(ok(catalogue(reg, { what: 'sources' })).detail)
})

test('with id, 20 selects of 10 options return every setting with every option across pages', () => {
  const reg = createRegistry()
  reg.use(plugin('twenty', { blocks: [selects('twenty', 20, 10)] }))
  const rows = detailRows(reg, 'blocks', 'twenty') as never as {
    key: string
    options: { value: string }[]
    moreOptions?: number
  }[]
  assert.equal(rows.length, 20)
  rows.forEach((x, i) => {
    assert.equal(x.key, `sel${i}`)
    assert.deepEqual(
      x.options.map(o => o.value),
      Array.from({ length: 10 }, (_, j) => `o${i}x${j}`),
    )
    assert.equal(x.moreOptions, undefined)
  })
})

test('a block with 200 settings pages to completion in the detail view, each setting a row of at most 6,000', () => {
  const reg = createRegistry()
  reg.use(
    plugin('two', {
      blocks: [selects('two', 200, 50, (i, j) => `${'v'.repeat(70)}${i}x${j}`)],
    }),
  )
  const rows = detailRows(reg, 'blocks', 'two')
  assert.equal(rows.length, 200)
  assert.deepEqual(
    rows.map(x => x.key),
    Array.from({ length: 200 }, (_, i) => `sel${i}`),
  )
  const first = ok(catalogue(reg, { what: 'blocks', id: 'two' }))
  assert.ok(first.cut && first.cursor)
  assert.ok(size({ ...first, rows: [], cut: false, cursor: undefined }) <= 4200)
})

test('a detail row holds at most 50 options of at most 80 characters each, and counts the rest', () => {
  const reg = createRegistry()
  reg.use(
    plugin('opt', {
      blocks: [selects('opt', 1, 300, (_, j) => `${'q"'.repeat(60)}${j}`)],
    }),
  )
  const [row] = detailRows(reg, 'blocks', 'opt') as never as {
    options: { label: string; value: string }[]
    moreOptions: number
  }[]
  assert.ok(row.options.length <= 50)
  assert.equal(row.options.length + row.moreOptions, 300)
  for (const o of row.options)
    assert.ok(size(o.value) <= 80 && size(o.label) <= 80)
})

test('leaving selects out of a ready insert keeps it small and accepted by plan', () => {
  const reg = createRegistry()
  // 60 selects, one of them with an option value too long to state
  const b = selects('sixty', 60, 2, (i, j) =>
    i === 3 ? 'z'.repeat(200) : `${'k'.repeat(40)}${i}x${j}`,
  )
  reg.use(plugin('sixty', { blocks: [b] }))
  const row = one(reg, 'sixty')
  assert.ok(size(row.insert) <= 2000, `${size(row.insert)}`)
  const n = Object.keys(row.insert.settings).length
  assert.ok(n > 0 && n < 60, `${n}`)
  assert.equal('sel3' in row.insert.settings, false)
  ok(plan(emptySite('Ada', LOOK), reg, request([row.insert])))
})

test('the detail view insert is complete for a block with many settings, and plan accepts it', () => {
  const reg = createRegistry()
  reg.use(plugin('four', { blocks: [selects('four', 400, 3)] }))
  const rows = detailRows(reg as never, 'blocks', 'four')
  assert.equal(rows.length, 400)
  const detail = one(reg, 'four').insert
  const all = Object.keys(detail.settings)
  assert.ok(all.length > 0 && all.every(k => rows.some(r => r.key === k)))
  ok(plan(emptySite('Ada', LOOK), reg, request([detail])))
})

test('a ready insert is never a marker: a page or root id of the caller too long to be valid falls back to home, and a look that cannot be stated whole leaves the insert out', () => {
  const reg = kitRegistry()
  const huge = 'p'.repeat(100000)
  const site = {
    doc: {
      pages: [{ id: huge, root: { id: huge, kind: 'column', children: [] } }],
    },
    revision: 1,
  } as never
  for (const what of ['blocks'] as const) {
    for (const name of ['demo', 'stamp']) {
      const r = one(reg, name, site)
      assert.ok(size(r) <= 4000, `${size(r)}`)
      assert.equal(
        r.insert.op,
        'insertBlock',
        JSON.stringify(r.insert).slice(0, 80),
      )
      assert.deepEqual(r.insert.tree, { page: 'home' })
      assert.equal(r.insert.parent, 'homeroot')
    }
    const d = ok(catalogue(reg, { what, id: 'stamp', site }))
    assert.equal(d.insert.op, 'insertBlock')
  }
  // a look id over 80 characters is cut in `looks`, so an insert that named it whole would not match what the row shows
  const longLook = 'l'.repeat(200)
  const lr = createRegistry()
  lr.use(
    plugin('looky', {
      blocks: [
        {
          ...selects('looky', 1, 2),
          looks: [
            { id: longLook, name: 'L', tree: selects('x', 0, 0).looks[0].tree },
          ],
        },
      ],
    }),
  )
  const row = ok(catalogue(lr, { what: 'blocks' })).rows[0]
  assert.equal(size(row.looks[0]), 80)
  const detail = ok(catalogue(lr, { what: 'blocks', id: 'looky' }))
  assert.equal('insert' in detail, false)
})

test("the ready insert gives the first settings in the block's order, skips one that cannot be stated, and has no settings when none is needed", () => {
  const reg = createRegistry()
  const b = selects('sixty', 60, 2, (i, j) =>
    i === 3 ? 'z'.repeat(200) : `${'k'.repeat(40)}${i}x${j}`,
  )
  reg.use(plugin('sixty', { blocks: [b] }))
  const row = one(reg, 'sixty')
  const keys = Object.keys(row.insert.settings)
  // the first n settings but sel3, each with its first option
  assert.deepEqual(
    keys,
    [0, 1, 2, ...Array.from({ length: keys.length - 3 }, (_, k) => k + 4)].map(
      i => `sel${i}`,
    ),
  )
  for (const k of keys)
    assert.equal(row.insert.settings[k], `${'k'.repeat(40)}${k.slice(3)}x0`)
  // nothing to give: no settings key at all, and the insert still plans
  const bare = createRegistry()
  bare.use(plugin('bare', { blocks: [selects('bare', 0, 0)] }))
  const r = one(bare, 'bare')
  assert.equal('settings' in r.insert, false)
  ok(plan(emptySite('Ada', LOOK), bare, request([r.insert])))
})

test('the setStyle layer text lists every layer name and the when form', () => {
  const op = OPERATIONS.find(o => o.op === 'setStyle')!
  const t = op.fields.find(f => f.name === 'layer')!.type
  for (const name of STATES) assert.ok(t.includes(`'${name}'`), name)
  assert.ok(t.includes('{ when: { state: string, is: string } }'))
})

test('a site without pages refuses nothing: blocks fall back to home and homeroot', () => {
  const r = kitRegistry()
  const site = { doc: { pages: [] }, revision: 1 } as never
  for (const what of ['kinds', 'sources', 'operations'] as const)
    ok(catalogue(r, { what, site }))
  const row = one(r, 'demo', site)
  assert.deepEqual(row.insert.tree, { page: 'home' })
  assert.equal(row.insert.parent, 'homeroot')
})

test('a block, kind or source with huge declarations stays within a bounded row', () => {
  const long = 'é"\\'.repeat(2000)
  const options = Array.from({ length: 400 }, (_, i) => ({
    label: `${long}${i}`,
    value: `${long}${i}`,
  }))
  const reg = createRegistry()
  reg.use({
    name: 'big',
    version: 1,
    api: [1],
    runs: ['build'],
    trust: 'declarative',
    blocks: [
      {
        id: 'bigblock',
        version: 1,
        name: long,
        category: long,
        guide: '"'.repeat(500),
        looks: Array.from({ length: 300 }, (_, i) => ({
          id: `l${i}`,
          name: long,
          tree: sampleBlockTree(),
        })),
        settings: Array.from({ length: 300 }, (_, i) => ({
          key: `k${i}`,
          label: long,
          type: 'select' as const,
          options,
          actions: [{ do: 'set' as const, path: 'x.props.runs.0.text' }],
        })),
      },
    ],
    sources: [
      {
        name: 'bigsource',
        guide: '\n'.repeat(500),
        fields: Object.fromEntries(
          Array.from({ length: 300 }, (_, i) => [`f${i}${long}`, 'text']),
        ) as never,
        sample: [
          Object.fromEntries(
            Array.from({ length: 300 }, (_, i) => [`f${i}`, long]),
          ),
        ],
      },
    ],
    kinds: {
      wide: {
        ...KINDS.column,
        props: Object.fromEntries(
          Array.from({ length: 300 }, (_, i) => [
            `p${i}`,
            { type: 'select', options: options.map(o => o.value) },
          ]),
        ),
        styles: Object.keys(KINDS.column).length ? KINDS.column.styles : [],
      },
    },
  } as Plugin)
  for (const what of ['blocks', 'sources', 'kinds'] as const) {
    for (const r of all(reg, what as never)) assert.ok(size(r) <= 4000, what)
    let cursor: string | undefined
    do {
      const r = ok(catalogue(reg, { what, cursor }))
      assert.ok(size(r) <= READ_CAP, what)
      cursor = r.cursor
    } while (cursor)
  }
  for (const [what, id] of [
    ['blocks', 'bigblock'],
    ['sources', 'bigsource'],
    ['kinds', 'wide'],
  ] as const) {
    let cursor: string | undefined
    do {
      const r = ok(catalogue(reg, { what, id, cursor }))
      assert.ok(size(r) <= READ_CAP, `${what}: ${size(r)}`)
      assert.ok(size({ ...r, rows: [] }) <= 4200, `${what} header`)
      for (const x of r.rows) assert.ok(size(x) <= 6000, `${what} row`)
      cursor = r.cursor
    } while (cursor)
  }
})

test('catalogue never throws, whatever it is given', () => {
  const r = kitRegistry()
  const odd: unknown[] = [
    undefined,
    null,
    7,
    'blocks',
    [],
    {},
    { what: 7 },
    { what: 'blocks', id: 7 },
    { what: 'blocks', id: {} },
    { what: 'blocks', cursor: 7 },
    { what: 'blocks', cursor: '0:99999' },
    { what: 'blocks', cursor: '5:0' },
    { what: 'blocks', site: 7 },
    { what: 'blocks', site: { doc: {}, revision: 1 } },
    { what: 'blocks', site: { doc: { pages: [{}] }, revision: 1 } },
    { what: 'blocks', site: { doc: { pages: [{ id: 'p', root: null }] } } },
    { what: 'operations', id: '__proto__' },
    { what: 'kinds', id: 'constructor' },
    { what: 'sources', id: 'toString' },
  ]
  for (const q of odd) {
    assert.doesNotThrow(() => {
      const out = catalogue(r, q as never) as { ok: boolean }
      assert.equal(typeof out.ok, 'boolean')
    }, JSON.stringify(q))
  }
  assert.doesNotThrow(() => catalogue(null as never, { what: 'blocks' }))
  assert.equal(
    refused(catalogue(r, { what: 'blocks', site: 7 as never })).code,
    'INVALID_OPERATION',
  )
  assert.equal(refused(catalogue(r, null as never)).code, 'INVALID_OPERATION')
  assert.equal(
    refused(catalogue(r, { what: 'blocks', id: 7 as never })).code,
    'INVALID_OPERATION',
  )
})

// ---- token cuts: terse lists, detail by id
const whole = (what: 'operations' | 'blocks', registry = kitRegistry()) =>
  ok(catalogue(registry, { what }))

test('operations list: 27 strings and a legend, at most 2,500 characters; rows[0] is "add(tree:T, parent:string, index:number, node:N)"; no row has an example', () => {
  const r = whole('operations')
  assert.equal(r.rows.length, 27)
  for (const row of r.rows) assert.equal(typeof row, 'string')
  assert.equal(r.rows[0], 'add(tree:T, parent:string, index:number, node:N)')
  assert.deepEqual(Object.keys(r.legend), ['T', 'N', 'L', 'U', 'V'])
  assert.ok(size(r) <= 2500, `${size(r)}`)
  assert.equal(JSON.stringify(r.rows).includes('example'), false)
})

test('every type in an operation line is at most 24 characters or a legend key, and optional fields end in "?"', () => {
  const r = whole('operations')
  const keys = Object.keys(r.legend)
  for (const row of r.rows as string[]) {
    const m = /^(\w+)\((.*)\)$/.exec(row)
    assert.ok(m, row)
    const op = OPERATIONS.find(o => o.op === m[1])!
    const fields = m[2] ? m[2].split(', ') : []
    assert.equal(fields.length, op.fields.length, row)
    fields.forEach((f, i) => {
      const [name, type] = f.split(':')
      assert.equal(name.endsWith('?'), op.fields[i].optional, f)
      assert.ok(type.length <= 24 || keys.includes(type), f)
    })
  }
})

test('operations id=<op> still returns fields and the example, and the examples are still accepted by plan in order', () => {
  let doc = siteWith([text('t', 'Hello')])
  for (const [i, e] of OPERATIONS.entries()) {
    const d = ok(catalogue(kitRegistry(), { what: 'operations', id: e.op }))
    assert.deepEqual(d.rows[0].example, e.example)
    assert.equal(d.rows[0].fields.length, e.fields.length)
    const p = plan(doc, kitRegistry(), request([d.rows[0].example], `k${i}`))
    assert.equal(p.ok, true, e.op)
    if (p.ok) doc = p.doc
  }
})

test('blocks list rows have exactly block, name, category, looks and guide; guide is at most 60 characters (the starter list at most 1,500 is in tools stable.spec)', () => {
  const r = whole('blocks')
  for (const row of r.rows) {
    for (const k of Object.keys(row))
      assert.ok(['block', 'name', 'category', 'looks', 'guide'].includes(k), k)
    for (const k of ['block', 'name', 'category', 'looks'])
      assert.ok(k in row, k)
    assert.ok(size(row.guide ?? '') <= 62, row.guide)
  }
})

test('blocks id=<block> still has every setting and the ready insert', () => {
  const d = ok(catalogue(kitRegistry(), { what: 'blocks', id: 'stamp' }))
  assert.equal(d.insert.op, 'insertBlock')
  assert.ok(d.rows.length > 0)
})

test('the guide names behind, front, gradient, shape and measure', () => {
  const g = ok(catalogue(kitRegistry(), { what: 'guide' }))
  assert.ok(g.rows.every((r: unknown) => typeof r === 'string'))
  const all = g.rows.join(' ')
  for (const w of ['behind', 'front', 'gradient', 'shape', 'measure'])
    assert.ok(all.includes(w), w)
})

test('kinds lists one line per kind and kinds id=shape shows the hint of geometry, fill and stroke', () => {
  const list = ok(catalogue(kitRegistry(), { what: 'kinds' }))
  assert.ok(list.rows.every((r: unknown) => typeof r === 'string'))
  assert.ok(
    list.rows.some((r: string) => /^shape\(leaf\): .*geometry/.test(r)),
    JSON.stringify(list.rows),
  )
  const rows = detailRows(kitRegistry(), 'kinds', 'shape')
  for (const k of ['geometry', 'fill', 'stroke']) {
    const r = rows.find(x => x.key === k)
    assert.equal(typeof r?.hint, 'string', k)
    assert.ok((r!.hint as string).length <= 300, k)
  }
})

test('the recipes list has recipe, name, guide (at most 60) and ops; an id gives the batch at the first page', () => {
  const list = ok(catalogue(kitRegistry(), { what: 'recipes' }))
  assert.deepEqual(
    list.rows.map((r: { recipe: string }) => r.recipe),
    ['hero', 'split', 'cta-band', 'buttons', 'divider', 'card'],
  )
  for (const r of list.rows) {
    assert.deepEqual(Object.keys(r), ['recipe', 'name', 'guide', 'ops'])
    assert.ok(r.guide.length <= 60 && typeof r.ops === 'number')
  }
  const site = { doc: { pages: [{ id: 'p9', root: { id: 'r9' } }] } } as never
  const one = ok(
    catalogue(kitRegistry(), { what: 'recipes', id: 'card', site }),
  )
  assert.equal(one.recipe, 'card')
  assert.deepEqual(one.ops[0].tree, { page: 'p9' })
  assert.equal(one.ops[0].parent, 'r9')
  assert.equal(one.ops.at(-1).op, 'makeComponent')
})

test('an unknown recipe id is refused, INVALID_OPERATION at path id, with the allowed recipe ids', () => {
  const r = refused(catalogue(kitRegistry(), { what: 'recipes', id: 'zzz' }))
  assert.equal(r.code, 'INVALID_OPERATION')
  assert.equal(r.path, 'id')
  assert.deepEqual(r.allowed, [
    'hero',
    'split',
    'cta-band',
    'buttons',
    'divider',
    'card',
  ])
})

test('the guide names {google:, up:lato, set:name, foldOn and borderBottom, and no longer says "(no lookups needed)"', () => {
  const all = ok(catalogue(kitRegistry(), { what: 'guide' })).rows.join(' ')
  for (const w of ['{google:', 'up:lato', 'set:name', 'foldOn', 'borderBottom'])
    assert.ok(all.includes(w), w)
  assert.ok(!all.includes('(no lookups needed)'))
})

test('catalogue kinds id=icon gives the name hint with both forms', () => {
  const d = ok(catalogue(kitRegistry(), { what: 'kinds', id: 'icon' }))
  assert.match(JSON.stringify(d), /set:name/)
})
