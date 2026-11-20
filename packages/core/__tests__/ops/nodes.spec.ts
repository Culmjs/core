import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compilePage } from '../../src/compile/index.ts'
import {
  find,
  type Component,
  type Node,
  type SiteDocument,
} from '../../src/document/index.ts'
import * as ops from '../../src/ops/nodes.ts'
import { rootOf } from '../../src/ops/trees.ts'
import type { OpResult } from '../../src/ops/types.ts'
import { insertBlock } from '../../src/registry/index.ts'
import { node, sampleRegistry, siteWith, text } from '../kit.ts'

const reg = sampleRegistry()
const T = { page: 'home' }

const base = (): SiteDocument =>
  siteWith([
    text('t', 'Old', {
      props: { level: 'p', runs: [{ text: 'Old' }], sample: true },
    }),
    node('b', 'box', [node('c', 'box'), node('d', 'box')]),
    node('e', 'row'),
    node('f', 'free'),
  ])

// Every call goes through `any`: operations come from outside and may carry anything.
const run = (name: keyof typeof ops, doc: SiteDocument, op: object): OpResult =>
  (ops[name] as (d: SiteDocument, r: typeof reg, o: object) => OpResult)(
    doc,
    reg,
    { op: name, tree: T, ...op },
  )

const ok = (r: OpResult) => {
  assert.ok(r.ok, JSON.stringify(!r.ok && r.problems))
  return r
}
const nodeOf = (doc: SiteDocument, id: string): Node =>
  find(rootOf(doc, T)!, id)!
const refused = (r: OpResult, code: string, more: object = {}) => {
  assert.ok(!r.ok)
  assert.equal(r.problems[0].code, code)
  assert.partialDeepStrictEqual(r.problems[0], more)
}
const invalid = (r: OpResult, more: object = {}) =>
  refused(r, 'INVALID_OPERATION', more)
const ref = (id: string) => ({ tree: T, id })

// ---- all operations: unknown tree, unknown id
const targeted: [keyof typeof ops, object][] = [
  ['remove', {}],
  ['move', { parent: 'b', index: 0 }],
  ['setProps', { props: {} }],
  ['setText', { text: 'x' }],
  ['setStyle', { layer: 'base', decl: {} }],
  ['setHidden', { layout: 'phone', hidden: true }],
  ['setSlot', { slot: {} }],
  ['setRequired', { required: true }],
  ['bindData', { showIf: null }],
  ['setStates', { on: null }],
]
for (const [name, extra] of targeted) {
  test(`${name} refuses an unknown tree`, () =>
    invalid(run(name, base(), { ...extra, tree: { page: 'nope' }, id: 't' }), {
      path: 'tree',
    }))
  test(`${name} refuses an unknown id`, () =>
    invalid(run(name, base(), { ...extra, id: 'zz' }), { nodeId: 'zz' }))
  test(`${name} refuses a missing id`, () =>
    invalid(run(name, base(), { ...extra })))
}
test('add refuses an unknown tree', () =>
  invalid(
    run('add', base(), {
      tree: 'nowhere',
      parent: 'b',
      index: 0,
      node: { kind: 'box' },
    }),
  ))

// ---- add
const add = (op: object, doc = base()) =>
  run('add', doc, {
    tree: T,
    parent: 'b',
    index: 1,
    node: { kind: 'box' },
    ...op,
  })

test('add inserts a subtree with ids, slots and names filled in', () => {
  const doc = base()
  const r = ok(
    add(
      {
        node: {
          kind: 'column',
          children: [{ kind: 'text', id: 'mine' }, { kind: 'box' }],
        },
      },
      doc,
    ),
  )
  const b = nodeOf(r.doc, 'b')
  assert.deepEqual(
    b.children!.map(c => c.id),
    ['c', 'n1', 'd'],
  )
  const col = b.children![1]
  assert.deepEqual(
    col.children!.map(c => c.id),
    ['mine', 'n2'],
  )
  assert.equal(col.name, 'Stack')
  assert.deepEqual(col.slot, {})
  assert.deepEqual(r.created, [ref('n1'), ref('mine'), ref('n2')])
  assert.deepEqual(r.changed, [ref('b')])
})
test('add gives a free parent its slot', () => {
  const r = ok(add({ parent: 'f', index: 0 }))
  assert.deepEqual(nodeOf(r.doc, 'n1').slot, { x: 0, y: 0, w: 6, h: 4, z: 0 })
})
test('add keeps a given slot and name', () => {
  const r = ok(
    add({
      parent: 'e',
      index: 0,
      node: { kind: 'box', name: 'Mine', slot: { grow: 2 } },
    }),
  )
  assert.equal(nodeOf(r.doc, 'n1').name, 'Mine')
  assert.deepEqual(nodeOf(r.doc, 'n1').slot, { grow: 2 })
})
test('add refuses an unknown parent', () =>
  invalid(add({ parent: 'zz' }), { path: 'parent' }))
for (const index of [-1, 3, 1.5, '1', null, NaN])
  test(`add refuses index ${String(index)}`, () =>
    invalid(add({ index }), { path: 'index' }))
test('add refuses a given id already used', () =>
  invalid(add({ node: { kind: 'box', id: 'c' } }), { nodeId: 'c' }))
test('add refuses a given id that is not well formed', () => {
  invalid(add({ node: { kind: 'box', id: 'Bad Id' } }), { nodeId: 'Bad Id' })
  invalid(add({ node: { kind: 'box', id: '' } }))
})
test('add refuses a given id with a dot', () =>
  invalid(add({ node: { kind: 'box', id: 'b1.title' } }), {
    nodeId: 'b1.title',
  }))
test('add refuses two nodes of the subtree with one id', () =>
  invalid(
    add({
      node: { kind: 'box', id: 'x', children: [{ kind: 'box', id: 'x' }] },
    }),
    { nodeId: 'x' },
  ))
test('add refuses a node that is not an object', () => {
  for (const n of [
    undefined,
    null,
    'box',
    3,
    [],
    { kind: 3 },
    { kind: 'box', children: 'no' },
  ])
    invalid(add({ node: n }), { path: 'node' })
})
test('add refuses an unsafe key anywhere in the node', () => {
  const n = JSON.parse('{"kind":"box","props":{"__proto__":{"x":1}}}')
  invalid(add({ node: n }))
  assert.equal(({} as Record<string, unknown>).x, undefined)
})
test('add assigns the same ids on the same document twice', () => {
  const doc = base()
  const op = {
    node: {
      kind: 'box',
      children: [{ kind: 'text' }, { kind: 'text', id: 'n2' }],
    },
  }
  const a = ok(add(op, doc)),
    b = ok(add(op, doc))
  assert.deepEqual(a, b)
  assert.deepEqual(
    a.created.map(r => r.id),
    ['n1', 'n3', 'n2'],
  )
})
test('add may put a node into a component tree', () => {
  const doc = base()
  doc.components.push({
    id: 'k',
    name: 'K',
    root: node('kroot', 'column'),
  } as unknown as Component)
  const r = ok(
    run('add', doc, {
      tree: { component: 'k' },
      parent: 'kroot',
      index: 0,
      node: { kind: 'box' },
    }),
  )
  assert.equal(r.doc.components[0].root.children![0].id, 'n1')
})

// ---- remove
test('remove takes the subtree out', () => {
  const r = ok(run('remove', base(), { id: 'c' }))
  assert.deepEqual(
    nodeOf(r.doc, 'b').children!.map(c => c.id),
    ['d'],
  )
  assert.deepEqual(r.created, [])
  assert.deepEqual(r.changed, [ref('b')])
})
test('remove refuses the root', () => {
  const doc = base()
  invalid(run('remove', doc, { id: doc.pages[0].root.id }), {
    nodeId: doc.pages[0].root.id,
  })
})
test('remove refuses a subtree that holds a required node', () => {
  const doc = base()
  nodeOf(doc, 'd').required = true
  refused(run('remove', doc, { id: 'b' }), 'POLICY_VIOLATION', {
    rule: 'required',
    nodeId: 'd',
  })
  refused(run('remove', doc, { id: 'd' }), 'POLICY_VIOLATION', {
    rule: 'required',
    nodeId: 'd',
  })
})
test('remove refuses a field whose form is not released, allows it when released', () => {
  const doc = siteWith([node('fm', 'form', [node('fld', 'field')])])
  refused(run('remove', doc, { id: 'fld' }), 'POLICY_VIOLATION', {
    rule: 'required',
    nodeId: 'fld',
  })
  nodeOf(doc, 'fm').required = false
  ok(run('remove', doc, { id: 'fld' }))
})

// ---- move
const mv = (op: object, doc = base()) =>
  run('move', doc, { id: 'c', parent: 'e', index: 0, ...op })
test('move puts the node under another parent', () => {
  const r = ok(mv({}))
  assert.deepEqual(
    nodeOf(r.doc, 'e').children!.map(c => c.id),
    ['c'],
  )
  assert.deepEqual(
    nodeOf(r.doc, 'b').children!.map(c => c.id),
    ['d'],
  )
  assert.deepEqual(nodeOf(r.doc, 'c').slot, { grow: 0, align: 'stretch' })
  assert.deepEqual(r.created, [])
  assert.deepEqual(r.changed, [ref('c')])
})
test('move within one parent counts the index after the node leaves', () => {
  const r = ok(mv({ parent: 'b', index: 1 }))
  assert.deepEqual(
    nodeOf(r.doc, 'b').children!.map(c => c.id),
    ['d', 'c'],
  )
  invalid(mv({ parent: 'b', index: 2 }), { path: 'index' })
})
test('move writes a given slot', () => {
  const r = ok(mv({ slot: { grow: 3 } }))
  assert.deepEqual(nodeOf(r.doc, 'c').slot, { grow: 3 })
})
test('move refuses the root', () => {
  const doc = base()
  invalid(mv({ id: doc.pages[0].root.id }, doc), {
    nodeId: doc.pages[0].root.id,
  })
})
test('move refuses an unknown parent', () =>
  invalid(mv({ parent: 'zz' }), { path: 'parent' }))
test('move refuses a parent inside the moved subtree', () => {
  invalid(mv({ id: 'b', parent: 'c' }), { path: 'parent' })
  invalid(mv({ id: 'b', parent: 'b' }), { path: 'parent' })
})
for (const index of [-1, 2, 0.5, 'x', undefined])
  test(`move refuses index ${String(index)}`, () => {
    // e is empty: only 0 is a place
    invalid(mv({ index }), { path: 'index' })
  })
test('move refuses an unsafe slot key', () =>
  invalid(mv({ slot: JSON.parse('{"__proto__":{"x":1}}') }), {
    path: 'slot.__proto__',
  }))

// ---- setProps
test('setProps writes, deletes with null, renames, and clears the sample mark', () => {
  const r = ok(
    run('setProps', base(), {
      id: 't',
      props: { level: 'h2', extra: 1 },
      name: 'Title',
    }),
  )
  const t = nodeOf(r.doc, 't')
  assert.equal(t.name, 'Title')
  assert.deepEqual(t.props, {
    level: 'h2',
    extra: 1,
    runs: [{ text: 'Old' }],
    sample: false,
  })
  assert.deepEqual(r.changed, [ref('t')])
  const r2 = ok(run('setProps', r.doc, { id: 't', props: { extra: null } }))
  assert.equal('extra' in nodeOf(r2.doc, 't').props!, false)
})
test('setProps refuses props that are not an object', () => {
  for (const props of [undefined, null, 'x', [], 3])
    invalid(run('setProps', base(), { id: 't', props }), { path: 'props' })
})
test('setProps refuses a name that is not a string', () =>
  invalid(run('setProps', base(), { id: 't', props: {}, name: 3 }), {
    path: 'name',
  }))
test('setProps refuses an unsafe key', () => {
  invalid(
    run('setProps', base(), {
      id: 't',
      props: JSON.parse('{"__proto__":{"x":1}}'),
    }),
    { path: 'props.__proto__' },
  )
  invalid(
    run('setProps', base(), {
      id: 't',
      props: JSON.parse('{"a":{"constructor":1}}'),
    }),
    { path: 'props.a.constructor' },
  )
})

// ---- setText
test('setText writes one run and clears the sample mark', () => {
  const r = ok(run('setText', base(), { id: 't', text: 'New' }))
  assert.deepEqual(nodeOf(r.doc, 't').props, {
    level: 'p',
    runs: [{ text: 'New' }],
    sample: false,
  })
  assert.deepEqual(r.changed, [ref('t')])
})
test('setText refuses text that is not a string', () =>
  invalid(run('setText', base(), { id: 't', text: 3 }), { path: 'text' }))
test('setText refuses a kind with no runs setting', () =>
  invalid(run('setText', base(), { id: 'b', text: 'x' }), {
    nodeId: 'b',
    allowed: [],
  }))
test('setText output is in the live page', () => {
  const doc = base()
  const registry = sampleRegistry()
  const r = ok(run('setText', doc, { id: 't', text: 'New' }))
  const page = compilePage(r.doc, 'home', { registry, mode: 'live' })
  assert.ok(page.ok)
  assert.ok(page.html.includes('New'))
  assert.ok(!page.html.includes('Old'))
})
test('an inner part of a block is reachable by its dotted id', () => {
  const b = insertBlock(reg, 'demo', 'default', 'b1')
  assert.ok(b.ok)
  const doc = siteWith([b.root])
  const r = ok(run('setText', doc, { id: 'b1.title', text: 'Hi' }))
  assert.deepEqual(r.changed, [ref('b1.title')])
  assert.deepEqual(nodeOf(r.doc, 'b1.title').props!.runs, [{ text: 'Hi' }])
})

// ---- setStyle
test('setStyle sets and deletes properties and drops an empty layer', () => {
  const r = ok(
    run('setStyle', base(), {
      id: 'c',
      layer: 'hover',
      decl: { gap: 4, hidden: true },
    }),
  )
  assert.deepEqual(nodeOf(r.doc, 'c').style, {
    hover: { gap: 4, hidden: true },
  })
  const r2 = ok(
    run('setStyle', r.doc, { id: 'c', layer: 'hover', decl: { gap: null } }),
  )
  assert.deepEqual(nodeOf(r2.doc, 'c').style, { hover: { hidden: true } })
  const r3 = ok(
    run('setStyle', r2.doc, {
      id: 'c',
      layer: 'hover',
      decl: { hidden: null },
    }),
  )
  assert.equal('hover' in (nodeOf(r3.doc, 'c').style ?? {}), false)
  assert.deepEqual(r3.changed, [ref('c')])
})
test('setStyle appends a when layer that does not exist and edits it after', () => {
  const when = { when: { state: 'tab', is: 'a' } }
  const r = ok(
    run('setStyle', base(), { id: 'c', layer: when, decl: { gap: 1 } }),
  )
  assert.deepEqual(nodeOf(r.doc, 'c').style!.when, [
    { state: 'tab', is: 'a', decl: { gap: 1 } },
  ])
  const r2 = ok(
    run('setStyle', r.doc, { id: 'c', layer: when, decl: { hidden: true } }),
  )
  assert.deepEqual(nodeOf(r2.doc, 'c').style!.when, [
    { state: 'tab', is: 'a', decl: { gap: 1, hidden: true } },
  ])
  const r3 = ok(
    run('setStyle', r2.doc, {
      id: 'c',
      layer: when,
      decl: { gap: null, hidden: null },
    }),
  )
  assert.equal(nodeOf(r3.doc, 'c').style?.when, undefined)
})
test('setStyle refuses an unknown layer name and lists the names', () => {
  for (const layer of [
    'bogus',
    'when',
    3,
    null,
    { when: { state: 1, is: 'a' } },
  ]) {
    const r = run('setStyle', base(), { id: 'c', layer, decl: {} })
    invalid(r, { path: 'layer' })
  }
  const r = run('setStyle', base(), { id: 'c', layer: 'bogus', decl: {} })
  assert.ok(
    !r.ok &&
      r.problems[0].allowed!.includes('base') &&
      r.problems[0].allowed!.includes('dark'),
  )
})
test('setStyle refuses decl that is not an object', () => {
  for (const decl of [undefined, null, [], 'x'])
    invalid(run('setStyle', base(), { id: 'c', layer: 'base', decl }), {
      path: 'decl',
    })
})
test('setStyle refuses an unsafe key', () =>
  invalid(
    run('setStyle', base(), {
      id: 'c',
      layer: 'base',
      decl: JSON.parse('{"__proto__":{"x":1}}'),
    }),
    { path: 'decl.__proto__' },
  ))

// ---- setHidden
test('setHidden writes and deletes hide[layout]', () => {
  const r = ok(
    run('setHidden', base(), { id: 'c', layout: 'phone', hidden: true }),
  )
  assert.deepEqual(nodeOf(r.doc, 'c').hide, { phone: true })
  assert.deepEqual(r.changed, [ref('c')])
  const r2 = ok(
    run('setHidden', r.doc, { id: 'c', layout: 'phone', hidden: false }),
  )
  assert.equal(nodeOf(r2.doc, 'c').hide, undefined)
})
test('setHidden refuses another layout and lists the three', () => {
  const r = run('setHidden', base(), { id: 'c', layout: 'watch', hidden: true })
  invalid(r, { path: 'layout', allowed: ['desktop', 'tablet', 'phone'] })
})
test('setHidden refuses hidden that is not a boolean', () =>
  invalid(
    run('setHidden', base(), { id: 'c', layout: 'phone', hidden: 'yes' }),
    { path: 'hidden' },
  ))

// ---- setSlot
test('setSlot replaces the slot and sets or deletes the placement', () => {
  const r = ok(
    run('setSlot', base(), {
      id: 'c',
      slot: { grow: 2 },
      placement: { mode: 'front', x: 1 },
    }),
  )
  assert.deepEqual(nodeOf(r.doc, 'c').slot, { grow: 2 })
  assert.deepEqual(nodeOf(r.doc, 'c').placement, { mode: 'front', x: 1 })
  const r2 = ok(run('setSlot', r.doc, { id: 'c', placement: null }))
  assert.equal(nodeOf(r2.doc, 'c').placement, undefined)
  assert.deepEqual(nodeOf(r2.doc, 'c').slot, { grow: 2 })
  assert.deepEqual(r2.changed, [ref('c')])
})
test('setSlot refuses neither slot nor placement', () =>
  invalid(run('setSlot', base(), { id: 'c' })))
test('setSlot refuses values that are not objects and unsafe keys', () => {
  invalid(run('setSlot', base(), { id: 'c', slot: 'x' }), { path: 'slot' })
  invalid(run('setSlot', base(), { id: 'c', placement: 3 }), {
    path: 'placement',
  })
  invalid(
    run('setSlot', base(), { id: 'c', slot: JSON.parse('{"__proto__":{}}') }),
    { path: 'slot.__proto__' },
  )
})

// ---- setRequired
test('setRequired writes true and false and deletes with null', () => {
  const r = ok(run('setRequired', base(), { id: 'c', required: true }))
  assert.equal(nodeOf(r.doc, 'c').required, true)
  const r2 = ok(run('setRequired', r.doc, { id: 'c', required: false }))
  assert.equal(nodeOf(r2.doc, 'c').required, false)
  const r3 = ok(run('setRequired', r2.doc, { id: 'c', required: null }))
  assert.equal('required' in nodeOf(r3.doc, 'c'), false)
  assert.deepEqual(r3.changed, [ref('c')])
})
test('setRequired refuses any other value', () => {
  for (const required of [undefined, 'true', 1, {}])
    invalid(run('setRequired', base(), { id: 'c', required }), {
      path: 'required',
    })
})

// ---- bindData
test('bindData replaces each given field and deletes with null', () => {
  const repeat = { source: 'projects' }
  const bind = { a: { from: 'item', field: 'title' } }
  const showIf = { from: 'site', field: 'x' }
  const r = ok(
    run('bindData', base(), {
      id: 'c',
      repeat,
      bind,
      showIf,
      showIfAny: [showIf, showIf],
    }),
  )
  const c = nodeOf(r.doc, 'c')
  assert.deepEqual(
    [c.repeat, c.bind, c.showIf, c.showIfAny],
    [repeat, bind, showIf, [showIf, showIf]],
  )
  const r2 = ok(
    run('bindData', r.doc, { id: 'c', repeat: null, showIfAny: null }),
  )
  const c2 = nodeOf(r2.doc, 'c')
  assert.equal('repeat' in c2 || 'showIfAny' in c2, false)
  assert.deepEqual(c2.bind, bind)
  assert.deepEqual(r2.changed, [ref('c')])
})
test('bindData refuses none of the four fields', () =>
  invalid(run('bindData', base(), { id: 'c' })))
test('bindData refuses wrongly typed fields', () => {
  invalid(run('bindData', base(), { id: 'c', repeat: 'x' }), { path: 'repeat' })
  invalid(run('bindData', base(), { id: 'c', bind: [] }), { path: 'bind' })
  invalid(run('bindData', base(), { id: 'c', showIf: 3 }), { path: 'showIf' })
  invalid(run('bindData', base(), { id: 'c', showIfAny: {} }), {
    path: 'showIfAny',
  })
})
test('bindData refuses an unsafe key in bind', () =>
  invalid(
    run('bindData', base(), {
      id: 'c',
      bind: JSON.parse('{"__proto__":{"x":1}}'),
    }),
    { path: 'bind.__proto__' },
  ))

// ---- setStates
test('setStates replaces each given field and deletes with null', () => {
  const state = [{ name: 'tab', values: ['a', 'b'], initial: 'a' }]
  const on = [{ on: 'click', do: { toggle: 'tab' } }]
  const r = ok(run('setStates', base(), { id: 'c', state, on }))
  assert.deepEqual(
    [nodeOf(r.doc, 'c').state, nodeOf(r.doc, 'c').on],
    [state, on],
  )
  const r2 = ok(run('setStates', r.doc, { id: 'c', on: null }))
  assert.equal('on' in nodeOf(r2.doc, 'c'), false)
  assert.deepEqual(nodeOf(r2.doc, 'c').state, state)
  assert.deepEqual(r2.changed, [ref('c')])
})
test('setStates refuses neither field and non-arrays', () => {
  invalid(run('setStates', base(), { id: 'c' }))
  invalid(run('setStates', base(), { id: 'c', state: {} }), { path: 'state' })
  invalid(run('setStates', base(), { id: 'c', on: 'x' }), { path: 'on' })
})
test('setStates refuses an unsafe key', () =>
  invalid(
    run('setStates', base(), {
      id: 'c',
      on: JSON.parse('[{"on":"click","do":{"__proto__":{}}}]'),
    }),
    { path: 'on.0.do.__proto__' },
  ))

// ---- shared
test('unsafe keys are refused and Object.prototype is unchanged', () => {
  const bad = JSON.parse('{"__proto__":{"x":1}}')
  invalid(run('setProps', base(), { id: 't', props: bad }))
  invalid(run('setStyle', base(), { id: 'c', layer: 'base', decl: bad }))
  invalid(run('bindData', base(), { id: 'c', bind: bad }))
  assert.equal(({} as Record<string, unknown>).x, undefined)
})
test('no operation changes its input', () => {
  const calls: [keyof typeof ops, object][] = [
    [
      'add',
      {
        parent: 'b',
        index: 0,
        node: { kind: 'box', children: [{ kind: 'text' }] },
      },
    ],
    ['remove', { id: 'c' }],
    ['move', { id: 'c', parent: 'e', index: 0 }],
    ['setProps', { id: 't', props: { level: 'h1' }, name: 'N' }],
    ['setText', { id: 't', text: 'New' }],
    ['setStyle', { id: 'c', layer: 'base', decl: { gap: 2 } }],
    [
      'setStyle',
      { id: 'c', layer: { when: { state: 's', is: 'v' } }, decl: { gap: 2 } },
    ],
    ['setHidden', { id: 'c', layout: 'tablet', hidden: true }],
    ['setSlot', { id: 'c', slot: { grow: 1 }, placement: { mode: 'front' } }],
    ['setRequired', { id: 'c', required: true }],
    [
      'bindData',
      {
        id: 'c',
        bind: { a: { from: 'item', field: 'f' } },
        showIf: { from: 'site', field: 'x' },
      },
    ],
    [
      'setStates',
      {
        id: 'c',
        state: [{ name: 's', values: 'on-off', initial: 'on' }],
        on: [],
      },
    ],
  ]
  for (const [name, op] of calls) {
    const doc = base()
    const before = structuredClone(doc)
    ok(run(name, doc, op))
    assert.deepEqual(doc, before, name)
  }
})
