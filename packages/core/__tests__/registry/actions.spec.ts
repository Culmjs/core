import assert from 'node:assert/strict'
import { test } from 'node:test'
import { find } from '../../src/document/index.ts'
import type { Node } from '../../src/document/index.ts'
import { applyAction, readAction } from '../../src/registry/actions.ts'
import type {
  ChooseAction,
  FilterAction,
  SetAction,
  ShowAction,
} from '../../src/registry/actions.ts'

const tree = (): Node => ({
  id: 'b',
  kind: 'column',
  name: 'B',
  slot: {},
  origin: { block: 'demo', version: 1, look: 'default' },
  children: [
    {
      id: 'b.title',
      kind: 'text',
      name: 'Title',
      slot: {},
      props: { runs: [{ text: 'Old' }], sample: true },
    },
    {
      id: 'b.list',
      kind: 'list',
      name: 'List',
      slot: {},
      repeat: { source: 'projects', max: 6 },
      children: [
        {
          id: 'b.item',
          kind: 'column',
          name: 'Item',
          slot: {},
          style: { base: { gap: 12, width: { n: 31, unit: '%' } } },
        },
      ],
    },
    { id: 'b.note', kind: 'text', name: 'Note', slot: {} },
  ],
})

test('set writes one value to every path and reads it back', () => {
  const a: SetAction = { do: 'set', path: ['list.repeat.max'] }
  const out = applyAction(tree(), a, 3)
  assert.equal(find(out, 'b.list')!.repeat!.max, 3)
  assert.equal(readAction(out, a), 3)
})

test('set wraps a number with a unit, and unsets on empty', () => {
  const a: SetAction = {
    do: 'set',
    path: 'item.style.base.width',
    as: { unit: 'px' },
    unsetWhenEmpty: true,
  }
  assert.deepEqual(
    find(applyAction(tree(), a, 300), 'b.item')!.style!.base!.width,
    { n: 300, unit: 'px' },
  )
  assert.equal(readAction(applyAction(tree(), a, 300), a), 300)
  assert.equal(
    'width' in find(applyAction(tree(), a, ''), 'b.item')!.style!.base!,
    false,
  )
})

test('set reads back only when its guard holds', () => {
  const a: SetAction = {
    do: 'set',
    path: 'list.repeat.max',
    readWhen: { path: 'list.repeat.source', is: 'other' },
  }
  assert.equal(readAction(tree(), a), undefined)
  assert.equal(
    readAction(tree(), { ...a, readWhen: { ...a.readWhen!, is: 'projects' } }),
    6,
  )
})

test('set skips a path whose node this look does not have, and never changes its input', () => {
  const t = tree()
  const before = structuredClone(t)
  const out = applyAction(
    t,
    { do: 'set', path: ['feature.repeat.max', 'list.repeat.max'] },
    2,
  )
  assert.equal(find(out, 'b.list')!.repeat!.max, 2)
  assert.deepEqual(t, before)
})

test('choose clears every owned key, applies the option, and reads back; no match reads the default', () => {
  const a: ChooseAction = {
    do: 'choose',
    default: '3',
    options: {
      '3': { write: { 'item.style.base.width': { n: 31, unit: '%' } } },
      '2': {
        write: {
          'item.style.base.width': { n: 48, unit: '%' },
          'item.style.base.gap': 20,
        },
      },
    },
  }
  const two = applyAction(tree(), a, '2')
  assert.deepEqual(find(two, 'b.item')!.style!.base, {
    gap: 20,
    width: { n: 48, unit: '%' },
  })
  assert.equal(readAction(two, a), '2')
  const three = applyAction(two, a, '3')
  assert.equal('gap' in find(three, 'b.item')!.style!.base!, false)
  assert.equal(readAction(three, a), '3')
  assert.equal(
    readAction(
      applyAction(tree(), { do: 'set', path: 'item.style.base.width' }, 'fill'),
      a,
    ),
    '3',
  )
})

test("choose can write and remove on the block's own root", () => {
  const a: ChooseAction = {
    do: 'choose',
    default: '',
    options: {
      '': {
        write: { '$root.showIf': { from: 'site', field: 'has.projects' } },
        remove: ['list.repeat.filter'],
      },
      research: {
        write: {
          '$root.showIf': { from: 'site', field: 'has.projects.research' },
          'list.repeat.filter': { field: 'kind', is: 'research' },
        },
      },
    },
  }
  const out = applyAction(tree(), a, 'research')
  assert.deepEqual(out.showIf, { from: 'site', field: 'has.projects.research' })
  assert.deepEqual(find(out, 'b.list')!.repeat!.filter, {
    field: 'kind',
    is: 'research',
  })
  assert.equal(readAction(out, a), 'research')
  assert.equal(
    find(applyAction(out, a, ''), 'b.list')!.repeat!.filter,
    undefined,
  )
})

test('show hides its nodes when the value and every listed sibling are empty', () => {
  const a: ShowAction = { do: 'show', nodes: ['note'], when: ['other'] }
  assert.equal(
    find(applyAction(tree(), a, '', { other: '' }), 'b.note')!.style!.base!
      .hidden,
    true,
  )
  assert.equal(
    find(applyAction(tree(), a, '', { other: 'x' }), 'b.note')!.style?.base
      ?.hidden,
    undefined,
  )
  assert.equal(
    find(applyAction(tree(), a, 'x', { other: '' }), 'b.note')!.style?.base
      ?.hidden,
    undefined,
  )
  const shown: ShowAction = { ...a, emptyIs: 'shown' }
  assert.equal(
    find(applyAction(tree(), shown, '', { other: '' }), 'b.note')!.style?.base
      ?.hidden,
    undefined,
  )
})

test("filter sets a list's filter, and on empty removes it or writes the fallback", () => {
  const a: FilterAction = { do: 'filter', list: 'list', field: 'kind' }
  const on = applyAction(tree(), a, 'research')
  assert.deepEqual(find(on, 'b.list')!.repeat!.filter, {
    field: 'kind',
    is: 'research',
  })
  assert.equal(readAction(on, a), 'research')
  assert.equal(
    find(applyAction(on, a, ''), 'b.list')!.repeat!.filter,
    undefined,
  )
  assert.deepEqual(
    find(applyAction(on, { ...a, empty: { is: 'none' } }, ''), 'b.list')!
      .repeat!.filter,
    { field: 'kind', is: 'none' },
  )
})

test('choose reads back in a look that lacks a part an option writes', () => {
  const a: ChooseAction = {
    do: 'choose',
    default: '3',
    options: {
      '3': { write: { 'item.style.base.width': { n: 31, unit: '%' } } },
      '2': {
        write: {
          'item.style.base.gap': 20,
          'feature.style.base.gap': 20,
        },
      },
    },
  }
  assert.equal(readAction(applyAction(tree(), a, '2'), a), '2')
})
