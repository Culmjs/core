import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkRows } from '../../src/registry/index.ts'
import type { DataSource } from '../../src/registry/index.ts'

const src: DataSource = {
  name: 'projects',
  fields: {
    title: 'text',
    years: 'text',
    done: 'boolean',
    count: 'number',
    tags: 'list',
    links: { rows: { label: 'text', href: 'text' } },
  },
  sample: [],
}

test('checkRows accepts matching rows and rows with fields left out', () => {
  assert.deepEqual(
    checkRows(src, [
      {
        title: 'A',
        done: true,
        count: 2,
        tags: ['x'],
        links: [{ label: 'l', href: 'https://a.b' }],
      },
      {},
    ]),
    [],
  )
})

test('null for a declared field counts as absent', () => {
  assert.deepEqual(checkRows(src, [{ title: null, links: null }]), [])
})

test('checkRows names the row and field of each mismatch and never throws', () => {
  assert.equal(checkRows(src, [{ title: 3 }])[0]?.path, 'projects.0.title')
  assert.equal(
    checkRows(src, [{ links: [{ label: 1 }] }])[0]?.path,
    'projects.0.links.0.label',
  )
  assert.equal(checkRows(src, [{ nope: 1 }])[0]?.path, 'projects.0.nope')
  assert.equal(
    checkRows(src, [{ links: [{ x: 1 }] }])[0]?.path,
    'projects.0.links.0.x',
  )
  assert.equal(checkRows(src, [{ links: 'x' }])[0]?.path, 'projects.0.links')
  assert.equal(checkRows(src, [{ count: 'x' }])[0]?.code, 'INVALID_DOCUMENT')
  for (const bad of [null, 'x', [null], [3], [[]], { a: 1 }]) {
    assert.ok(checkRows(src, bad).length > 0)
  }
})

test('checkRows reports a source whose fields are not an object', () => {
  for (const fields of [null, undefined, 'x', 3, []])
    assert.equal(
      checkRows({ ...src, fields } as unknown as DataSource, [{}]).length,
      1,
    )
})

test('checkRows reports a nested collection whose rows are not an object', () => {
  const bad = {
    ...src,
    fields: { links: { rows: null } },
  } as unknown as DataSource
  assert.equal(checkRows(bad, [{ links: [{ a: 1 }] }]).length, 1)
})

test('checkRows gives one problem for a bad source, whatever the rows', () => {
  const nul = { name: 'x', fields: null, sample: [] } as unknown as DataSource
  assert.equal(checkRows(null as unknown as DataSource, []).length, 1)
  assert.equal(checkRows(nul, []).length, 1)
  assert.equal(checkRows(nul, [{}, {}, {}]).length, 1)
  assert.equal(checkRows(nul, 'x').length, 1)
})

test('a nested rows that is not an object gives one problem at the field path', () => {
  const bad = {
    name: 'x',
    fields: { links: { rows: null } },
    sample: [],
  } as unknown as DataSource
  const out = checkRows(bad, [{ links: [{ a: 1 }, { a: 2 }] }])
  assert.equal(out.length, 1)
  assert.equal(out[0].path, 'x.0.links')
})
