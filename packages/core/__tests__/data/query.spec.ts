import assert from 'node:assert/strict'
import { test } from 'node:test'
import { rowsOf } from '../../src/data/index.ts'
import type { Row } from '../../src/registry/index.ts'

const rows: Row[] = [
  { title: 'A', years: '2021', kind: 'research' },
  { title: 'B', years: '2024', kind: 'portfolio' },
  { title: 'C', years: '2023', kind: 'research' },
]
const titles = (r: unknown) => (r as Row[]).map(x => x.title)

test('filter, sort, skip and max apply in that order', () => {
  assert.deepEqual(
    titles(
      rowsOf(rows, {
        source: 'projects',
        filter: { field: 'kind', is: 'research' },
        sort: { field: 'years', dir: 'desc' },
        skip: 1,
        max: 5,
      }),
    ),
    ['A'],
  )
  assert.deepEqual(
    titles(
      rowsOf(rows, {
        source: 'projects',
        sort: { field: 'years', dir: 'asc' },
        max: 2,
      }),
    ),
    ['A', 'C'],
  )
})

test('exclude runs after filter; a list field passes when it holds the value', () => {
  const tagged: Row[] = [
    { title: 'A', tags: ['x', 'y'] },
    { title: 'B', tags: ['y'] },
    { title: 'C', tags: ['x'] },
  ]
  const r = { source: 'projects' }
  assert.deepEqual(
    titles(rowsOf(tagged, { ...r, filter: { field: 'tags', is: 'x' } })),
    ['A', 'C'],
  )
  assert.deepEqual(
    titles(
      rowsOf(tagged, {
        ...r,
        filter: { field: 'tags', is: 'x' },
        exclude: { field: 'tags', is: 'y' },
      }),
    ),
    ['C'],
  )
})

test('a row with no value for the sort field comes last, either way round', () => {
  const some: Row[] = [
    { title: 'none' },
    { title: 'B', years: '2024' },
    { title: 'A', years: '2021' },
  ]
  for (const dir of ['asc', 'desc'] as const)
    assert.equal(
      titles(rowsOf(some, { source: 's', sort: { field: 'years', dir } })).at(
        -1,
      ),
      'none',
    )
})

test('the 200 cap applies after the filter', () => {
  const many: Row[] = Array.from({ length: 300 }, (_, i) => ({
    title: String(i),
    on: i >= 290,
  }))
  assert.equal(
    rowsOf(many, { source: 's', filter: { field: 'on', is: true }, max: 200 })
      .length,
    10,
  )
  assert.equal(rowsOf(many, { source: 's', max: 999 }).length, 200)
})

test('skip and max that are negative, fractional or not numbers cannot reach rows they should not', () => {
  const some = (repeat: object) =>
    titles(rowsOf(rows, { source: 's', ...repeat } as never))
  assert.deepEqual(some({ max: -1 }), [])
  assert.deepEqual(some({ skip: -5, max: 1 }), ['A'])
  assert.deepEqual(some({ skip: 'x', max: 'y' }), ['A', 'B', 'C'])
  assert.deepEqual(some({ skip: 1.9, max: 1.9 }), ['B'])
})

test('a filter that reads the enclosing row takes its value from there, or falls back to `is`', () => {
  const repeat = {
    source: 's',
    filter: {
      field: 'kind',
      is: 'portfolio',
      of: { from: 'item', field: 'want' },
    },
  } as const
  const scope = (want: unknown) => ({ items: [{ want }], values: {} })
  assert.deepEqual(titles(rowsOf(rows, repeat, scope('research'))), ['A', 'C'])
  assert.deepEqual(titles(rowsOf(rows, repeat, scope(undefined))), ['B'])
  const site = {
    source: 's',
    filter: {
      field: 'kind',
      is: 'portfolio',
      of: { from: 'site', field: 'a.b' },
    },
  } as const
  assert.deepEqual(
    titles(rowsOf(rows, site, { items: [], values: { 'a.b': 'research' } })),
    ['A', 'C'],
  )
})

test('group makes one row per value, with its label, count and items', () => {
  const g = rowsOf(rows, {
    source: 's',
    group: { field: 'kind', dir: 'asc' },
  })
  assert.deepEqual(
    g.map(x => [x.key, x.label, x.count, titles(x.items)]),
    [
      ['portfolio', 'portfolio', 1, ['B']],
      ['research', 'research', 2, ['A', 'C']],
    ],
  )
})

test('a plain value becomes { value }; null, booleans, lists and NaN are skipped; a source that is not a list has no rows', () => {
  assert.deepEqual(
    rowsOf(['x', 3, null, true, [1], NaN, { a: 1 }] as never, { source: 's' }),
    [{ value: 'x' }, { value: 3 }, { a: 1 }],
  )
  assert.deepEqual(rowsOf(undefined as never, { source: 's' }), [])
  assert.deepEqual(rowsOf('abc' as never, { source: 's' }), [])
})

test('sort order does not depend on the locale', async () => {
  const { execFileSync } = await import('node:child_process')
  const want = ['a', 'z', 'ä']
  const data = ['z', 'ä', 'a'].map(title => ({ title }))
  const here = (r: unknown) => (r as Row[]).map(x => x.title)
  assert.deepEqual(
    here(rowsOf(data, { source: 'p', sort: { field: 'title', dir: 'asc' } })),
    want,
  )
  // ponytail: the locale may not be installed; the order must be the same either way.
  const src = new URL('../../src/data/index.ts', import.meta.url).href
  const code = `import(${JSON.stringify(src)}).then(m=>console.log(JSON.stringify(m.rowsOf(${JSON.stringify(data)},{source:'p',sort:{field:'title',dir:'asc'}}).map(r=>r.title))))`
  for (const LC_ALL of ['sv_SE.UTF-8', 'en_US.UTF-8'])
    assert.deepEqual(
      JSON.parse(
        execFileSync(
          process.execPath,
          ['--conditions=@culmjs/source', '--import', 'tsx', '-e', code],
          { env: { ...process.env, LC_ALL, LANG: LC_ALL }, encoding: 'utf8' },
        ),
      ),
      want,
      LC_ALL,
    )
})
