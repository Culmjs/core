import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  KINDS,
  MAX_DEPTH,
  MAX_NODES,
  kindSpec,
} from '../../src/document/index.ts'
import { COMMANDS, ID_RE, LAYERS } from '../../src/document/kinds.ts'
import type { Node } from '../../src/document/index.ts'

const w = (kind: string, props = {}) =>
  ({ id: 'a', kind, name: 'A', slot: {}, props }) as unknown as Node

test('all 21 core kinds are registered with a display value', () => {
  assert.equal(Object.keys(KINDS).length, 21)
  for (const [k, s] of Object.entries(KINDS)) assert.ok(s.display(w(k)), k)
  assert.equal(KINDS.free.display(w('free')), 'grid')
  assert.equal(KINDS.row.display(w('row')), 'flex')
  assert.equal(KINDS['table-cell'].display(w('table-cell')), 'table-cell')
})

test('layout kinds are named Stack, Side by side, Grid, Box and Free for people', () => {
  assert.deepEqual(
    [
      KINDS.column.label,
      KINDS.row.label,
      KINDS.grid.label,
      KINDS.box.label,
      KINDS.free.label,
    ],
    ['Stack', 'Side by side', 'Grid', 'Box', 'Free'],
  )
})

test('tags follow kind, parent and grandparent', () => {
  const list = (marker: string) =>
    ({
      ...w('list'),
      repeat: { source: 'projects', marker },
    }) as Node
  assert.equal(KINDS.list.tag(null, list('decimal'), null), 'ol')
  assert.equal(KINDS.list.tag(null, list('disc'), null), 'ul')
  assert.equal(KINDS.box.tag('list', w('box'), null), 'li')
  assert.equal(KINDS.row.tag('free', w('row', { as: 'nav' }), null), 'nav')
  assert.equal(KINDS.text.tag('box', w('text', { level: 'h2' }), null), 'h2')
  assert.equal(KINDS['table-row'].tag('table', w('table-row'), null), 'tr')
})

test('a list holds one repeated child or up to 200 static ones and a table only rows', () => {
  assert.deepEqual(KINDS.list.children, {
    min: 1,
    max: 200,
    kinds: ['box', 'row', 'column', 'grid'],
  })
  for (const k of KINDS.list.children!.kinds!)
    assert.equal(
      KINDS[k as keyof typeof KINDS].tag('list', w(k), null),
      'li',
      k,
    )
  assert.ok(!KINDS.list.children!.kinds!.includes('text'))
  assert.deepEqual(KINDS.table.children?.kinds, ['table-row'])
  assert.equal(KINDS.embed.repeatable, false)
  assert.equal(KINDS.instance.repeatable, false)
})

test('ids', () => {
  for (const ok of ['a', 'hero1', 'x'.repeat(20)]) assert.ok(ID_RE.test(ok), ok)
  for (const bad of ['', 'a~1', 'x.y', 'A', 'x'.repeat(21)])
    assert.ok(!ID_RE.test(bad), bad)
})

test('a span text is inline and other text is block', () => {
  assert.equal(KINDS.text.display(w('text', { level: 'span' })), 'inline')
  assert.equal(KINDS.text.display(w('text', { level: 'h2' })), 'block')
  assert.equal(KINDS.text.tag('list', w('text'), null), 'p')
})

test('frame, search and art are not core kinds; a plug-in kind is found through extra', () => {
  for (const k of ['frame', 'search', 'art', 'toString'])
    assert.equal(kindSpec(k), undefined, k)
  const extra = new Map([['map', { ...KINDS.box, label: 'Map' }]])
  assert.equal(kindSpec('map', extra)?.label, 'Map')
  assert.equal(kindSpec('box', extra), KINDS.box)
})

test('limits', () => {
  assert.equal(MAX_NODES, 2000)
  assert.equal(MAX_DEPTH, 12)
})

test('KINDS cannot be changed', () => {
  assert.throws(() => (KINDS.free.parents as string[]).push('x'), TypeError)
  assert.throws(() => {
    ;(KINDS.text.props as Record<string, unknown>).x = { type: 'text' }
  }, TypeError)
  assert.throws(() => {
    ;(KINDS as Record<string, unknown>).extra = KINDS.text
  }, TypeError)
  assert.ok(Object.isFrozen(KINDS.details.props.marker.options))
})

test('a shared object is frozen itself, and nothing reachable from KINDS is left open', () => {
  // the lists that sel() keeps, and the child rule that many kinds share
  for (const shared of [LAYERS, COMMANDS, KINDS.box.children])
    assert.ok(Object.isFrozen(shared))
  assert.throws(() => (LAYERS as string[]).push('x'), TypeError)
  const open: string[] = []
  const seen = new Set<unknown>()
  const walk = (v: unknown, at: string) => {
    if (typeof v !== 'object' || v === null || seen.has(v)) return
    seen.add(v)
    if (!Object.isFrozen(v)) open.push(at)
    for (const [k, x] of Object.entries(v)) walk(x, `${at}.${k}`)
  }
  walk(KINDS, 'KINDS')
  assert.deepEqual(open, [])
})
