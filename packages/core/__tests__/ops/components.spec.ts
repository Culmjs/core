import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  find,
  walk,
  type Component,
  type Node,
  type SiteDocument,
} from '../../src/document/index.ts'
import { requiredRefs } from '../../src/document/required.ts'
import * as ops from '../../src/ops/components.ts'
import { rootOf } from '../../src/ops/trees.ts'
import type { OpResult, TreeRef } from '../../src/ops/types.ts'
import { validateSite } from '../../src/validate/index.ts'
import { node, sampleRegistry, siteWith, text } from '../kit.ts'

const reg = sampleRegistry()
const T = { page: 'home' }

const run = (
  name: keyof typeof ops,
  doc: SiteDocument,
  op: object,
  tree: TreeRef = T,
): OpResult =>
  (ops[name] as (d: SiteDocument, r: typeof reg, o: object) => OpResult)(
    doc,
    reg,
    { op: name, tree, ...op },
  )
const ok = (r: OpResult) => {
  assert.ok(r.ok, JSON.stringify(!r.ok && r.problems))
  return r
}
const invalid = (
  r: OpResult,
  more: object = {},
  code = 'INVALID_OPERATION',
) => {
  assert.ok(!r.ok)
  assert.equal(r.problems[0].code, code)
  assert.partialDeepStrictEqual(r.problems[0], more)
}
const at = (doc: SiteDocument, id: string, tree: TreeRef = T): Node =>
  find(rootOf(doc, tree)!, id)!
const idsOf = (n: Node) => {
  const out: string[] = []
  walk(n, w => out.push(w.id))
  return out
}
const problems = (doc: SiteDocument) => validateSite(doc, reg)

const button = (id: string, extra: Partial<Node> = {}): Node => ({
  id,
  kind: 'button',
  name: id,
  slot: {},
  props: { label: 'Go' },
  ...extra,
})
// A card: title, a button that opens a dialog panel, and the panel.
const card = (): Component => ({
  id: 'card',
  name: 'Card',
  root: node('root', 'box', [
    text('title', 'Hi'),
    button('go', { on: [{ on: 'click', do: { open: 'panel' } }] }),
    {
      ...node('panel', 'box', [text('msg', 'Hello')]),
      props: { layer: 'dialog' },
    },
  ]),
  props: [],
  variants: [],
})
const inst = (
  id: string,
  component: string,
  more: Partial<Node> = {},
): Node => ({
  id,
  kind: 'instance',
  name: id,
  slot: {},
  component,
  ...more,
})
const withCard = (...kids: Node[]): SiteDocument => {
  const doc = siteWith([text('t', 'x'), ...kids])
  doc.components = [card()]
  return doc
}
const deepFreeze = <T>(v: T): T => {
  if (typeof v === 'object' && v !== null && !Object.isFrozen(v)) {
    Object.freeze(v)
    for (const x of Object.values(v)) deepFreeze(x)
  }
  return v
}

// ---- makeComponent
test('makeComponent moves the subtree into doc.components and leaves an instance with the same id, slot and placement', () => {
  const doc = siteWith([
    node('b', 'box', [text('k', 'kid')], { grow: 1 }),
    text('t', 'x'),
  ])
  at(doc, 'b').placement = { mode: 'front' }
  at(doc, 'b').hide = { phone: true }
  assert.deepEqual(problems(doc), [])
  const r = ok(
    run('makeComponent', doc, { id: 'b', component: 'box1', name: 'My box' }),
  )
  const c = r.doc.components[0]
  assert.deepEqual(
    [c.id, c.name, c.props, c.variants, idsOf(c.root)],
    ['box1', 'My box', [], [], ['b', 'k']],
  )
  // the top of a tree has no position: the instance took it
  assert.deepEqual([c.root.slot, c.root.placement], [{}, undefined])
  assert.deepEqual(at(r.doc, 'b'), {
    id: 'b',
    kind: 'instance',
    name: 'b',
    slot: { grow: 1 },
    component: 'box1',
    placement: { mode: 'front' },
    hide: { phone: true },
  })
  assert.deepEqual(r.created, [])
  assert.deepEqual(r.changed, [{ tree: T, id: 'b' }])
  assert.deepEqual(problems(r.doc), [])
})

test('makeComponent works inside a component tree and the new component is a separate id space', () => {
  const doc = withCard()
  const r = ok(
    run(
      'makeComponent',
      doc,
      { id: 'msg', component: 'note', name: 'Note' },
      { component: 'card' },
    ),
  )
  assert.deepEqual(idsOf(r.doc.components[1].root), ['msg'])
  assert.equal(at(r.doc, 'msg', { component: 'card' }).kind, 'instance')
  assert.deepEqual(problems(r.doc), [])
})

test('makeComponent refusals: the root; a component id in use; an id that does not match the id rule; a subtree that holds an instance of itself', () => {
  const doc = withCard(node('b', 'box', [inst('i', 'card')]))
  invalid(
    run('makeComponent', doc, { id: 'homeroot', component: 'x', name: 'X' }),
  )
  invalid(
    run('makeComponent', doc, { id: 'b', component: 'card', name: 'X' }),
    { path: 'component' },
  )
  for (const bad of ['Has-Caps', '', 'a'.repeat(21), 'a.b', 5, undefined])
    invalid(run('makeComponent', doc, { id: 'b', component: bad, name: 'X' }), {
      path: 'component',
    })
  for (const bad of ['', '  ', 5, undefined])
    invalid(run('makeComponent', doc, { id: 'b', component: 'x', name: bad }), {
      path: 'name',
    })
  // an instance of the component being made: only possible in a document that is not valid yet
  const odd = withCard(node('b', 'box', [inst('i', 'later')]))
  invalid(
    run('makeComponent', odd, { id: 'b', component: 'later', name: 'X' }),
    { nodeId: 'i' },
  )
})

test('makeComponent refuses a subtree with a dotted id, and a reference across the edge of the subtree', () => {
  const doc = siteWith([node('b', 'box', [text('b.k', 'kid')]), text('t', 'x')])
  invalid(run('makeComponent', doc, { id: 'b', component: 'x', name: 'X' }), {
    nodeId: 'b.k',
  })
  // a trigger inside points out; a trigger outside points in
  const dlg = { ...node('dlg', 'box'), props: { layer: 'dialog' } }
  const out = siteWith([
    dlg,
    node('b', 'box', [
      button('go', { on: [{ on: 'click', do: { open: 'dlg' } }] }),
    ]),
  ])
  invalid(run('makeComponent', out, { id: 'b', component: 'x', name: 'X' }), {
    nodeId: 'go',
  })
  const inn = siteWith([
    button('go', { on: [{ on: 'click', do: { open: 'dlg' } }] }),
    node('b', 'box', [dlg]),
  ])
  invalid(run('makeComponent', inn, { id: 'b', component: 'x', name: 'X' }), {
    nodeId: 'go',
  })
  // both ends inside: fine
  const both = siteWith([
    node('b', 'box', [
      button('go', { on: [{ on: 'click', do: { open: 'dlg' } }] }),
      dlg,
    ]),
  ])
  assert.deepEqual(problems(both), [])
  const r = ok(
    run('makeComponent', both, { id: 'b', component: 'x', name: 'X' }),
  )
  assert.deepEqual(problems(r.doc), [])
})

test('makeComponent refuses the 101st component', () => {
  const doc = siteWith([node('b', 'box')])
  doc.components = Array.from({ length: 100 }, (_, i) => ({
    id: `c${i}`,
    name: 'C',
    root: node('r', 'box'),
    props: [],
    variants: [],
  }))
  invalid(run('makeComponent', doc, { id: 'b', component: 'x', name: 'X' }))
})

// ---- setInstance
test('setInstance writes set and overrides; null deletes one; refused on a node that is not an instance; unsafe keys refused', () => {
  const doc = withCard(inst('i', 'card', { set: { a: 'A', b: 'B' } }))
  const r1 = ok(
    run('setInstance', doc, {
      id: 'i',
      set: { a: 'Z', c: 1, b: null },
      overrides: { title: { hide: { phone: true } } },
    }),
  )
  assert.deepEqual(at(r1.doc, 'i').set, { a: 'Z', c: 1 })
  assert.deepEqual(at(r1.doc, 'i').overrides, {
    title: { hide: { phone: true } },
  })
  assert.deepEqual(r1.changed, [{ tree: T, id: 'i' }])
  assert.deepEqual(r1.created, [])
  // an object left empty is removed
  const r2 = ok(
    run('setInstance', r1.doc, {
      id: 'i',
      set: { a: null, c: null },
      overrides: { title: null },
    }),
  )
  assert.equal('set' in at(r2.doc, 'i'), false)
  assert.equal('overrides' in at(r2.doc, 'i'), false)
  invalid(run('setInstance', doc, { id: 't', set: { a: 1 } }), { nodeId: 't' })
  invalid(run('setInstance', doc, { id: 'i' }))
  invalid(run('setInstance', doc, { id: 'i', set: 5 }))
  invalid(run('setInstance', doc, { id: 'i', overrides: { title: 5 } }))
  for (const f of ['set', 'overrides'])
    invalid(
      run('setInstance', doc, {
        id: 'i',
        [f]: JSON.parse('{"__proto__":{"x":1}}'),
      }),
    )
  invalid(
    run('setInstance', doc, {
      id: 'i',
      overrides: { title: JSON.parse('{"props":{"constructor":1}}') },
    }),
  )
  assert.equal(({} as Record<string, unknown>).x, undefined)
})

// ---- detach
test('detach replaces the instance with its unrolled tree, every part with a fresh n-id, and created lists them', () => {
  const doc = withCard(inst('i', 'card', { hide: { phone: true } }))
  const r = ok(run('detach', doc, { id: 'i' }))
  const d = at(r.doc, 'i')
  assert.deepEqual(
    [d.kind, d.hide, idsOf(d)],
    ['box', { phone: true }, ['i', 'n1', 'n2', 'n3', 'n4']],
  )
  assert.deepEqual(
    r.created,
    ['n1', 'n2', 'n3', 'n4'].map(id => ({ tree: T, id })),
  )
  assert.deepEqual(r.changed, [{ tree: T, id: 'i' }])
  assert.equal(r.doc.components.length, 1)
})

test('detach keeps a trigger inside the subtree pointed at its target', () => {
  const doc = withCard(inst('i', 'card'))
  const r = ok(run('detach', doc, { id: 'i' }))
  const panel = at(r.doc, 'i').children![2]
  assert.equal(panel.id, 'n3')
  assert.deepEqual(at(r.doc, 'n2').on, [{ on: 'click', do: { open: 'n3' } }])
  // the component's own trigger is unchanged
  assert.deepEqual(r.doc.components[0].root.children![1].on, [
    { on: 'click', do: { open: 'panel' } },
  ])
})

test('detach rewrites props.opens that points inside', () => {
  const c = card()
  c.root.children![1] = button('go', {
    props: { label: 'Go', command: 'show-modal', opens: 'panel' },
  })
  const doc = withCard(inst('i', 'card'))
  doc.components = [c]
  assert.deepEqual(problems(doc), [])
  const r = ok(run('detach', doc, { id: 'i' }))
  assert.equal(at(r.doc, 'n2').props!.opens, 'n3')
  assert.deepEqual(problems(r.doc), [])
})

test('a document that validated before detach validates after it', () => {
  const doc = withCard(inst('i', 'card'), inst('j', 'card'))
  assert.deepEqual(problems(doc), [])
  const r = ok(run('detach', doc, { id: 'i' }))
  assert.deepEqual(problems(r.doc), [])
  // the other use still unrolls beside it, and the ids do not collide
  const r2 = ok(run('detach', r.doc, { id: 'j' }))
  assert.deepEqual(problems(r2.doc), [])
  assert.deepEqual(
    r2.created.map(c => c.id),
    ['n5', 'n6', 'n7', 'n8'],
  )
})

test("detach applies the use's set and overrides, and keeps slot content with its own ids", () => {
  const c = card()
  c.props = [
    {
      key: 'heading',
      label: 'Heading',
      type: 'text',
      part: 'title',
      field: 'text',
    },
    { key: 'more', label: 'More', type: 'slot', part: 'panel' },
  ] as Component['props']
  const doc = withCard(
    inst('i', 'card', {
      set: { heading: 'Yo' },
      overrides: { msg: { hide: { phone: true } } },
      children: [text('kid', 'slotted')],
    }),
  )
  doc.components = [c]
  assert.deepEqual(problems(doc), [])
  const r = ok(run('detach', doc, { id: 'i' }))
  assert.deepEqual(at(r.doc, 'n1').props!.runs, [{ text: 'Yo' }])
  assert.deepEqual(at(r.doc, 'n4').hide, { phone: true })
  assert.deepEqual(
    at(r.doc, 'n3').children!.map(k => k.id),
    ['n4', 'kid'],
  )
  assert.equal(
    r.created.some(c => c.id === 'kid'),
    false,
  )
  assert.deepEqual(problems(r.doc), [])
})

test('detach of a component that holds an instance of another leaves no dotted ids', () => {
  const doc = withCard(inst('i', 'outer'))
  doc.components.push({
    id: 'outer',
    name: 'Outer',
    root: node('o', 'box', [inst('in', 'card'), text('ot', 'x')]),
    props: [],
    variants: [],
  })
  assert.deepEqual(problems(doc), [])
  const r = ok(run('detach', doc, { id: 'i' }))
  const all = idsOf(at(r.doc, 'i'))
  // i (root), the nested card (n1 root, title, go, panel, msg) and ot
  assert.deepEqual(all, ['i', 'n1', 'n2', 'n3', 'n4', 'n5', 'n6'])
  assert.equal(
    all.some(id => id.includes('.')),
    false,
  )
  assert.deepEqual(at(r.doc, 'n3').on, [{ on: 'click', do: { open: 'n4' } }])
  assert.deepEqual(problems(r.doc), [])
})

test('detach is refused on a node that is not an instance and on an instance of a missing component', () => {
  const doc = withCard(inst('i', 'card'))
  invalid(run('detach', doc, { id: 't' }), { nodeId: 't' })
  invalid(run('detach', doc, { id: 'nope' }), { nodeId: 'nope' })
  const lost = withCard(inst('i', 'gone'))
  invalid(
    run('detach', lost, { id: 'i' }),
    { nodeId: 'i', allowed: ['card'] },
    'UNKNOWN_COMPONENT',
  )
})

test('a required node inside the component stays required in the detached copy', () => {
  const doc = withCard(inst('i', 'card'))
  doc.components[0].root.children![0] = text('title', 'Hi', { required: true })
  assert.deepEqual(problems(doc), [])
  const key = (d: SiteDocument) =>
    requiredRefs(d)
      .map(r => JSON.stringify(r.tree))
      .sort()
  assert.deepEqual(key(doc), ['{"component":"card"}'])
  const r = ok(run('detach', doc, { id: 'i' }))
  assert.equal(at(r.doc, 'n1').required, true)
  assert.deepEqual(
    requiredRefs(r.doc).map(x => x.id),
    ['n1'],
  )
})

test("detach works inside a component tree, with ids from that component's own space", () => {
  const doc = withCard()
  doc.components.push({
    id: 'outer',
    name: 'Outer',
    root: node('o', 'box', [inst('in', 'card')]),
    props: [],
    variants: [],
  })
  const r = ok(run('detach', doc, { id: 'in' }, { component: 'outer' }))
  assert.deepEqual(idsOf(rootOf(r.doc, { component: 'outer' })!), [
    'o',
    'in',
    'n1',
    'n2',
    'n3',
    'n4',
  ])
  assert.deepEqual(problems(r.doc), [])
})

// ---- removeComponent
test('removeComponent is refused while an instance uses it, naming the instances; accepted when none does', () => {
  const doc = withCard(inst('i', 'card'))
  doc.header.children = [inst('h', 'card')]
  doc.components.push({
    id: 'outer',
    name: 'Outer',
    root: node('o', 'box', [inst('in', 'card')]),
    props: [],
    variants: [],
  })
  const r = run('removeComponent', doc, { component: 'card' })
  invalid(r, { nodeId: 'h' })
  assert.match(!r.ok ? r.problems[0].message : '', /h, i, in|i, h, in|h.*i.*in/)
  invalid(
    run('removeComponent', doc, { component: 'nope' }),
    { allowed: ['card', 'outer'] },
    'UNKNOWN_COMPONENT',
  )
  invalid(
    run('removeComponent', doc, { component: 5 }),
    {},
    'UNKNOWN_COMPONENT',
  )
  // an unused component can go; one used only by another component is refused until that one goes
  const free = ok(run('removeComponent', doc, { component: 'outer' }))
  assert.deepEqual(
    free.doc.components.map(c => c.id),
    ['card'],
  )
  assert.deepEqual([free.created, free.changed], [[], []])
  const none = withCard()
  const gone = ok(run('removeComponent', none, { component: 'card' }))
  assert.deepEqual(gone.doc.components, [])
  assert.deepEqual(problems(gone.doc), [])
})

// ---- all four
test('no component operation changes its input', () => {
  const full = (): SiteDocument => {
    const doc = withCard(
      inst('i', 'card', {
        set: { a: 1 },
        overrides: { msg: { hide: { phone: true } } },
        children: [text('kid', 'k')],
      }),
      node('b', 'box', [text('bk', 'x')]),
    )
    doc.components.push({
      id: 'unused',
      name: 'U',
      root: node('u', 'box'),
      props: [],
      variants: [],
    })
    return doc
  }
  const calls: [keyof typeof ops, object][] = [
    ['makeComponent', { id: 'b', component: 'mine', name: 'Mine' }],
    [
      'setInstance',
      {
        id: 'i',
        set: { a: null, b: 2 },
        overrides: { msg: null, title: { hide: { tablet: true } } },
      },
    ],
    ['detach', { id: 'i' }],
    ['removeComponent', { component: 'unused' }],
  ]
  for (const [name, op] of calls) {
    const doc = deepFreeze(full())
    const before = structuredClone(doc)
    ok(run(name, doc, op))
    assert.deepEqual(doc, before, name)
  }
})
