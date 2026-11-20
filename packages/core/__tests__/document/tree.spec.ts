import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  count,
  find,
  insert,
  move,
  parentOf,
  remove,
  replace,
  walk,
} from '../../src/document/index.ts'
import {
  blockIds,
  localTarget,
  orderedChildren,
  refsTo,
  slotFor,
} from '../../src/document/tree.ts'
import type { Node } from '../../src/document/index.ts'
import { node as t } from '../kit.ts'

const page = t('root', 'free', [
  t('row', 'row', [t('a', 'text'), t('b', 'image')], {
    x: 0,
    y: 0,
    w: 24,
    h: 4,
    z: 0,
  }),
])

test('walk visits depth first with parents and depth', () => {
  const seen: string[] = []
  walk(page, (w, p, d) => seen.push(`${w.id}:${p?.id ?? '-'}:${d}`))
  assert.deepEqual(seen, ['root:-:0', 'row:root:1', 'a:row:2', 'b:row:2'])
  assert.equal(count(page), 4)
})

test('moving into a Free area writes a Free slot; into a Row a flow slot', () => {
  const moved = move(page, 'a', 'root', 1, { x: 3, y: 9 })
  assert.deepEqual(find(moved, 'a')!.slot, { x: 3, y: 9, w: 6, h: 4, z: 0 })
  assert.deepEqual(slotFor('row', t('z', 'text')), {
    grow: 0,
    align: 'stretch',
  })
  assert.equal(Object.keys(find(page, 'a')!.slot).length, 0, 'input unchanged')
})

test('a copied block gets <root>.<local> ids and resolves targets', () => {
  const look = t('sec', 'column', [t('title', 'text'), t('more', 'button')])
  look.children![1].props = { opens: 'title' }
  const copy = blockIds('s1', look)
  assert.deepEqual(
    copy.children!.map(c => c.id),
    ['s1.title', 's1.more'],
  )
  assert.equal(copy.children![1].props!.opens, 's1.title')
  assert.equal(localTarget(copy, 'title.props.level')!.node.id, 's1.title')
  assert.deepEqual(localTarget(copy, 'title.props.level')!.path, [
    'props',
    'level',
  ])
  assert.equal(localTarget(copy, 'nope.props.x'), null)
  assert.deepEqual(
    refsTo(copy, 's1.title').map(w => w.id),
    ['s1.more'],
  )
})

test('a copied block never shares a style object between nodes', () => {
  const shared = { base: { color: 'muted' as const } }
  const look = t('sec', 'column', [t('one', 'text'), t('two', 'text')])
  look.children![0].style = shared
  look.children![1].style = shared
  const copy = blockIds('s1', look)
  assert.notStrictEqual(copy.children![0].style, copy.children![1].style)
  copy.children![0].style!.base!.hidden = true
  assert.equal(copy.children![1].style!.base!.hidden, undefined)
  assert.equal(Object.hasOwn(shared.base, 'hidden'), false)
})

test('insert, remove, replace and parentOf leave the input alone', () => {
  assert.equal(parentOf(page, 'a')!.id, 'row')
  assert.equal(count(remove(page, 'a')), 3)
  assert.equal(
    find(insert(page, 'row', 0, t('n', 'text')), 'row')!.children![0].id,
    'n',
  )
  assert.equal(find(replace(page, 'b', t('c', 'icon')), 'c')!.kind, 'icon')
  assert.equal(count(page), 4)
})

test('refsTo also finds a trigger that points at the block', () => {
  const root = {
    id: 'r',
    kind: 'box',
    name: 'R',
    slot: {},
    children: [
      { id: 'dlg', kind: 'box', name: 'Dialog', slot: {} },
      {
        id: 'go',
        kind: 'button',
        name: 'Go',
        slot: {},
        on: [{ on: 'hover', do: { open: 'dlg' } }],
      },
      {
        id: 'set',
        kind: 'button',
        name: 'Set',
        slot: {},
        on: [{ on: 'click', do: { set: 'dlg', to: 'x' } }],
      },
    ],
  } as Node
  assert.deepEqual(
    refsTo(root, 'dlg').map(w => w.id),
    ['go'],
  )
})

test("localTarget resolves $root to the block's own root", () => {
  const root = t('r1', 'column', [t('r1.title', 'text')])
  assert.deepEqual(localTarget(root, '$root.showIf'), {
    node: root,
    path: ['showIf'],
  })
  assert.equal(localTarget(root, 'title.props.runs')?.node.id, 'r1.title')
  assert.equal(localTarget(root, 'missing.props.x'), null)
})

test("blockIds renames a look's local ids under the root id and keeps the tree's shape", () => {
  const look = t('work', 'column', [t('title', 'text')])
  const out = blockIds('abc', look)
  assert.equal(out.id, 'abc')
  assert.equal(out.children![0].id, 'abc.title')
  assert.equal(look.id, 'work')
})

test("a Free area's children read in spatial order", () => {
  const at = (id: string, x: number, y: number) =>
    t(id, 'text', undefined, { x, y, w: 4, h: 2, z: 0 })
  const free = t('f', 'free', [
    at('right', 10, 0),
    at('low', 0, 5),
    at('top', 0, 0),
  ])
  assert.deepEqual(
    orderedChildren(free).map(c => c.id),
    ['top', 'right', 'low'],
  )
})
