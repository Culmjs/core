import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Node } from '../../src/document/index.ts'
import { outlineOf } from '../../src/measure/outline.ts'
import { node, sampleRegistry, text } from '../kit.ts'

const box = (x: number, y: number, w: number, h: number) => ({
  x,
  y,
  w,
  h,
  z: 0,
})

function root(): Node {
  const col: Node = {
    ...node('col', 'column', [
      text('a', 'a'),
      text('b', 'b', { style: { phone: { order: -1 } } }),
      text('c', 'c', { hide: { tablet: true } }),
    ]),
    slot: box(0, 0, 12, 4),
  }
  return {
    ...node('root', 'free'),
    props: { cols: 24 },
    children: [
      col,
      {
        ...text('over', 'o'),
        slot: box(6, 2, 12, 4),
        placement: { mode: 'front' },
      },
      { ...text('away', 'w'), slot: box(0, 20, 6, 2) },
    ],
  }
}

const find = (o: ReturnType<typeof outlineOf>, id: string) =>
  o.nodes.find(x => x.id === id)!

test('the outline gives reading order per layout', () => {
  const o = outlineOf(root(), sampleRegistry())
  assert.deepEqual(find(o, 'a').order, { desktop: 0, tablet: 0, phone: 1 })
  assert.deepEqual(find(o, 'b').order, { desktop: 1, tablet: 1, phone: 0 })
  assert.deepEqual(find(o, 'c').order, { desktop: 2, tablet: null, phone: 2 })
  assert.deepEqual(find(o, 'c').hidden, {
    desktop: false,
    tablet: true,
    phone: false,
  })
  assert.deepEqual(
    [find(o, 'a').depth, find(o, 'a').parent, find(o, 'root').parent],
    [2, 'col', null],
  )
})

test("the outline names a section's block and look", () => {
  const r = root()
  r.children![2].origin = { block: 'demo', version: 1, look: 'default' }
  assert.deepEqual(find(outlineOf(r, sampleRegistry()), 'away').section, {
    id: 'demo',
    name: 'Demo',
    look: 'default',
  })
  r.children![2].origin = { block: 'gone', version: 1, look: 'x' }
  assert.equal(
    find(outlineOf(r, sampleRegistry()), 'away').section!.name,
    'gone',
  )
})

// In-flow blocks in a Free area are pushed apart, so an overlap is a block placed in front or behind.
test('the outline gives boxes and overlaps only under a free node', () => {
  const o = outlineOf(root(), sampleRegistry())
  assert.deepEqual(find(o, 'col').box!.desktop, box(0, 0, 12, 4))
  assert.equal(find(o, 'a').box, undefined)
  assert.equal(find(o, 'root').box, undefined)
  assert.deepEqual(
    o.overlaps.filter(x => x.layout === 'desktop'),
    [{ a: 'col', b: 'over', layout: 'desktop' }],
  )
  assert.equal(
    o.overlaps.some(x => x.a === 'away' || x.b === 'away'),
    false,
  )
})
