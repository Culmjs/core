import assert from 'node:assert/strict'
import { test } from 'node:test'
import { emptySite, KINDS } from '../../src/document/index.ts'
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
const request = (ops: unknown[], key = 'k') => ({
  site: 's',
  baseRevision: 0,
  key,
  ops: ops as never,
})

test('every core kind and every plug-in kind appears', () => {
  const rows = all(kitRegistry(), 'kinds' as never)
  assert.deepEqual(
    rows.map(r => r.kind),
    [...Object.keys(KINDS), 'badge'],
  )
  const text = rows.find(r => r.kind === 'text') as Record<string, unknown>
  for (const k of [
    'label',
    'role',
    'parents',
    'settings',
    'styles',
    'states',
    'bindable',
    'repeatable',
  ])
    assert.ok(k in text, k)
  for (const r of rows) assert.ok(size(r) <= 4000, `${r.kind}: ${size(r)}`)
  // styles are group names then single properties, not one long list of every property
  const styles = (
    rows.find(r => r.kind === 'column') as never as {
      styles: string[]
    }
  ).styles
  assert.ok(styles.includes('LAYOUT'), JSON.stringify(styles))
})

test('every registered block appears with every look and setting; every source with its fields and first sample row', () => {
  const r = kitRegistry()
  const blocks = all(r)
  assert.deepEqual(
    blocks.map(b => b.block),
    ['demo', 'stamp'],
  )
  const demo = blocks[0] as never as {
    version: number
    name: string
    category: string
    looks: { id: string; name: string }[]
    settings: { key: string; label: string; type: string; min?: number }[]
  }
  assert.equal(demo.version, 1)
  assert.deepEqual(demo.looks, [{ id: 'default', name: 'Default' }])
  assert.deepEqual(
    demo.settings.map(s => s.key),
    ['heading', 'limit', 'hidenote', 'upper'],
  )
  assert.equal(demo.settings[1].min, 1)

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
    fields: { title: 'text', year: 'number' },
    sample: { title: 'First', year: 2020 },
  })
  assert.deepEqual(s[1], { source: 'empty', fields: { a: 'text' } })
  assert.deepEqual(
    all(kitRegistry(), 'sources' as never).map(x => x.source),
    ['projects'],
  )
})

test('for each block, a batch of only its ready insert operation is accepted by plan', () => {
  for (const registry of [kitRegistry(), sampleRegistry()]) {
    // with a site given
    const doc = siteWith([text('t', 'Hello')])
    const withSite = ok(
      catalogue(registry, {
        what: 'blocks',
        site: { doc, revision: 3 },
      }),
    )
    for (const row of withSite.rows) {
      assert.equal(row.insert.tree.page, doc.pages[0].id)
      assert.equal(row.insert.parent, doc.pages[0].root.id)
      assert.equal('id' in row.insert, false)
      ok(plan(doc, registry, request([row.insert])))
    }
    // without it, on emptySite
    const empty = emptySite('Ada', LOOK)
    for (const row of ok(catalogue(registry, { what: 'blocks' })).rows) {
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
  const row = ok(catalogue(reg, { what: 'blocks' })).rows[0]
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
  const rows = all(kitRegistry(), 'operations' as never)
  assert.deepEqual(
    rows.map(r => r.op),
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
  assert.deepEqual(w.allowed, ['kinds', 'blocks', 'sources', 'operations'])
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
  assert.deepEqual(
    ok(catalogue(r, { what: 'kinds', id: 'badge' })).rows.map(
      (x: { kind: string }) => x.kind,
    ),
    ['badge'],
  )
  assert.deepEqual(
    ok(catalogue(r, { what: 'blocks', id: 'stamp' })).rows.map(
      (x: { block: string }) => x.block,
    ),
    ['stamp'],
  )
  const op = ok(catalogue(r, { what: 'operations', id: 'setText' }))
  assert.equal(op.rows.length, 1)
  assert.equal(op.rows[0].op, 'setText')
  assert.equal(op.cut, false)
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
    const r = ok(catalogue(reg, { what, id }))
    assert.equal(r.rows.length, 1)
    assert.ok(size(r) <= READ_CAP / 2, `${what}: ${size(r)}`)
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
