import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Node, Problem, SiteDocument } from '../../src/document/index.ts'
import {
  MAX_OPS,
  MAX_REQUEST_CHARS,
  OP_NAMES,
  plan,
} from '../../src/ops/plan.ts'
import type {
  Allow,
  ChangeRequest,
  Op,
  PlanResult,
} from '../../src/ops/types.ts'
import { validateSite } from '../../src/validate/index.ts'
import { OPERATIONS } from '../../src/ops/catalogue.ts'
import { diffAll } from '../../src/ops/diff.ts'
import {
  bigPage,
  kitRegistry,
  node,
  sampleRegistry,
  siteWith,
  text,
  twoPages,
} from '../kit.ts'

const reg = sampleRegistry()
const T = { page: 'home' }
const base = (): SiteDocument =>
  twoPages(
    [text('t1', 'One'), text('t2', 'Two'), node('b', 'box')],
    [text('a1', 'About')],
  )
const req = (ops: unknown[], more: object = {}): ChangeRequest =>
  ({ site: 's', baseRevision: 0, key: 'k', ops, ...more }) as ChangeRequest
const run = (
  ops: unknown[],
  doc = base(),
  allow?: Allow,
  more: object = {},
): PlanResult => plan(doc, reg, req(ops, more), allow)
const ok = (r: PlanResult) => {
  assert.ok(r.ok, JSON.stringify(!r.ok && r.problems))
  return r
}
const refused = (r: PlanResult): Problem[] => {
  assert.ok(!r.ok, 'expected a refusal')
  return r.problems
}
const setText = (id: string, t: string, tree: object = T) => ({
  op: 'setText',
  tree,
  id,
  text: t,
})

test('a later operation uses an id an earlier one created', () => {
  const r = ok(
    run([
      {
        op: 'add',
        tree: T,
        parent: 'homeroot',
        index: 0,
        node: { kind: 'box', id: 'x1' },
      },
      {
        op: 'add',
        tree: T,
        parent: 'x1',
        index: 0,
        node: { kind: 'box', id: 'x2' },
      },
    ]),
  )
  assert.deepEqual(r.created, [
    { tree: T, id: 'x1' },
    { tree: T, id: 'x2' },
  ])
})

test('two pages swap slugs in one batch', () => {
  const r = ok(
    run([
      { op: 'setPage', page: 'home', slug: '/tmp' },
      { op: 'setPage', page: 'about', slug: '/' },
      { op: 'setPage', page: 'home', slug: '/about' },
    ]),
  )
  assert.deepEqual(
    r.doc.pages.map(p => p.slug),
    ['/about', '/'],
  )
})

test('a batch that ends invalid returns no document, and the problem carries the index of the last operation that changed its node', () => {
  // a text node given a level the kind does not allow
  const r = run([
    setText('t2', 'a'),
    setText('t1', 'b'),
    { op: 'setProps', tree: T, id: 't1', props: { level: 'h9' } },
    setText('t2', 'c'),
  ])
  const ps = refused(r)
  const hit = ps.find(p => p.nodeId === 't1')
  assert.ok(hit, JSON.stringify(ps))
  assert.equal(hit.op, 2)
})

test('a problem that names no node carries no index', () => {
  const ps = refused(
    run([
      { op: 'addPage', title: 'X', slug: '/dup' },
      { op: 'addPage', title: 'Y', slug: '/dup' },
    ]),
  )
  const dup = ps.filter(p => p.nodeId === undefined)
  assert.ok(dup.length > 0, JSON.stringify(ps))
  for (const p of dup) assert.equal(p.op, undefined)
})

test('a refusal stops the batch and carries its index', () => {
  const ps = refused(
    run([
      setText('t1', 'a'),
      setText('t2', 'b'),
      { op: 'remove', tree: T, id: 'nope' },
      setText('t1', 'c'),
    ]),
  )
  assert.equal(ps[0].op, 2)
  assert.ok(ps.every(p => p.op === 2))
})

test('201 operations: RESOURCE_LIMIT_EXCEEDED; 200 are planned', () => {
  const ops = (n: number) =>
    Array.from({ length: n }, (_, i) => setText('t1', `v${i}`))
  assert.equal(MAX_OPS, 200)
  const ps = refused(run(ops(201)))
  assert.equal(ps[0].code, 'RESOURCE_LIMIT_EXCEEDED')
  ok(run(ops(200)))
})

test('a request over 1,000,000 characters: RESOURCE_LIMIT_EXCEEDED', () => {
  assert.equal(MAX_REQUEST_CHARS, 1_000_000)
  const ps = refused(run([setText('t1', 'x'.repeat(1_000_001))]))
  assert.equal(ps[0].code, 'RESOURCE_LIMIT_EXCEEDED')
  // a cycle cannot be measured: refused, not thrown
  const loop: Record<string, unknown> = {}
  loop.me = loop
  assert.equal(refused(run([loop]))[0].code, 'INVALID_OPERATION')
})

const deepFreeze = <T>(v: T): T => {
  if (typeof v === 'object' && v !== null && !Object.isFrozen(v)) {
    Object.freeze(v)
    for (const x of Object.values(v)) deepFreeze(x)
  }
  return v
}
test('plan never changes its input', () => {
  const doc = deepFreeze(base())
  const before = structuredClone(doc)
  const request = deepFreeze(
    req([
      { op: 'setText', tree: T, id: 't1', text: 'z' },
      {
        op: 'insertBlock',
        tree: T,
        parent: 'homeroot',
        index: 0,
        block: 'demo',
        look: 'default',
        id: 'blk',
      },
      { op: 'makeComponent', tree: T, id: 'b', component: 'box1', name: 'Box' },
      { op: 'addPage', title: 'New', slug: '/new' },
    ]),
  )
  const reqBefore = structuredClone(request)
  ok(plan(doc, reg, request))
  assert.deepEqual(doc, before)
  assert.deepEqual(request, reqBefore)
})

test('allow is called once per operation with the working copy, and its problem becomes POLICY_VIOLATION with the given rule and the index', () => {
  const seen: [string, string][] = []
  const allow: Allow = (op, doc) => {
    const page = doc.pages[0]
    const t = (page.root.children ?? []).find(c => c.id === 't1')
    seen.push([(op as Op).op, JSON.stringify(t?.props)])
    if (seen.length === 2)
      return { code: 'INVALID_NODE', message: 'no way', rule: 'frozen' }
    return undefined
  }
  const ps = refused(
    run(
      [setText('t1', 'first'), setText('t1', 'second'), setText('t1', 'third')],
      base(),
      allow,
    ),
  )
  assert.equal(seen.length, 2)
  assert.ok(seen[1][1].includes('first'), 'second call sees the first result')
  assert.ok(!seen[0][1].includes('first'))
  assert.deepEqual(
    [ps[0].code, ps[0].rule, ps[0].message, ps[0].op],
    ['POLICY_VIOLATION', 'frozen', 'no way', 1],
  )
  // an allow that throws refuses
  const thrown = refused(
    run([setText('t1', 'a')], base(), () => {
      throw new Error('host bug')
    }),
  )
  assert.deepEqual(
    [thrown[0].code, thrown[0].rule, thrown[0].op],
    ['POLICY_VIOLATION', 'allow', 0],
  )
})

test('pages lists the affected pages', () => {
  assert.deepEqual(ok(run([setText('a1', 'x', { page: 'about' })])).pages, [
    'about',
  ])
  assert.deepEqual(
    ok(run([setText('t1', 'x'), setText('a1', 'y', { page: 'about' })])).pages,
    ['home', 'about'],
  )
})

test('created and changed are merged without duplicates, by tree and id', () => {
  const r = ok(
    run([
      setText('t1', 'a'),
      setText('t1', 'b'),
      {
        op: 'add',
        tree: T,
        parent: 'homeroot',
        index: 0,
        node: { kind: 'box', id: 'x1' },
      },
      { op: 'setProps', tree: T, id: 'x1', props: {}, name: 'Named' },
      {
        op: 'add',
        tree: T,
        parent: 'homeroot',
        index: 0,
        node: { kind: 'box', id: 'x2' },
      },
      { op: 'remove', tree: T, id: 'x2' },
      { op: 'remove', tree: T, id: 't2' },
    ]),
  )
  const key = (l: { tree: unknown; id: string }[]) => l.map(x => x.id)
  assert.ok(key(r.created).includes('x1'))
  assert.ok(!key(r.created).includes('x2'))
  assert.ok(!key(r.changed).includes('x1'), 'created, so not changed')
  assert.ok(!key(r.changed).includes('x2'))
  assert.ok(
    !key(r.changed).includes('t2'),
    'removed nodes are in the diff, not here',
  )
  assert.equal(key(r.changed).filter(i => i === 't1').length, 1)
})

const linked = (): SiteDocument => {
  const doc = base()
  doc.pages[0].root.children!.push(
    node('lk', 'box', [
      {
        ...text('lt', 'go'),
        props: { level: 'p', runs: [{ text: 'go', link: { page: '/about' } }] },
      },
    ]),
  )
  return doc
}
test('a link that now leads to no page is reported once, by node id', () => {
  const textOf = (r: PlanResult) => {
    const n = ok(r).notes.filter(x =>
      x.text.startsWith('These links now lead to no page'),
    )
    return n
  }
  const gone = textOf(run([{ op: 'removePage', page: 'about' }], linked()))
  assert.equal(gone.length, 1)
  assert.deepEqual(gone[0].ids, ['lt'])
  assert.equal(gone[0].kind, 'info')
  assert.equal(
    textOf(run([{ op: 'setPage', page: 'about', slug: '/other' }], linked()))
      .length,
    1,
  )
  assert.equal(
    textOf(run([{ op: 'setPage', page: 'about', on: false }], linked())).length,
    1,
  )
  assert.equal(textOf(run([setText('t1', 'x')], linked())).length, 0)
  const both = run(
    [
      { op: 'setPage', page: 'about', slug: '/other' },
      {
        op: 'setProps',
        tree: T,
        id: 'lt',
        props: { runs: [{ text: 'go', link: { page: '/other' } }] },
      },
    ],
    linked(),
  )
  assert.equal(textOf(both).length, 0)
})

test('a valid document stays valid after every accepted batch', () => {
  const batches: unknown[][] = [
    [setText('t1', 'x')],
    [
      {
        op: 'add',
        tree: T,
        parent: 'homeroot',
        index: 1,
        node: { kind: 'box' },
      },
    ],
    [{ op: 'move', tree: T, id: 't2', parent: 'b', index: 0 }],
    [{ op: 'remove', tree: T, id: 't2' }],
    [{ op: 'setHidden', tree: T, id: 't1', layout: 'phone', hidden: true }],
    [
      {
        op: 'insertBlock',
        tree: T,
        parent: 'homeroot',
        index: 0,
        block: 'demo',
        look: 'default',
      },
    ],
    [{ op: 'makeComponent', tree: T, id: 'b', component: 'box1', name: 'Box' }],
    [{ op: 'addPage', title: 'N', slug: '/n' }],
    [{ op: 'movePage', page: 'about', index: 0 }],
    [{ op: 'setSite', name: 'Other' }],
    [{ op: 'setProps', tree: T, id: 't1', props: {}, name: 'Renamed' }],
    [{ op: 'setPage', page: 'about', title: 'Other title' }],
    [{ op: 'removePage', page: 'about' }],
  ]
  for (const ops of batches) {
    const r = ok(run(ops))
    assert.deepEqual(validateSite(r.doc, reg), [], JSON.stringify(ops))
  }
})

for (const bad of [
  { op: 'paint' },
  { op: 'remove' },
  { op: 'remove', tree: { page: 'nope' }, id: 'x' },
  {
    op: 'add',
    tree: { page: 'home' },
    parent: 'homeroot',
    index: -1,
    node: {},
  },
  {
    op: 'add',
    tree: { page: 'home' },
    parent: 'homeroot',
    index: 1.5,
    node: {},
  },
  null,
  7,
  'remove',
  [],
])
  test(`malformed operation ${JSON.stringify(bad)} is INVALID_OPERATION with op 0 and no throw`, () => {
    const ps = refused(run([bad]))
    assert.equal(ps[0].code, 'INVALID_OPERATION')
    assert.equal(ps[0].op, 0)
    assert.ok(!/\n\s+at /.test(ps[0].message), 'no stack trace')
  })

test('OP_NAMES is the 26 operations of the spec, in the order of its table, each once', () => {
  assert.deepEqual(
    [...OP_NAMES],
    [
      'add',
      'remove',
      'move',
      'setProps',
      'setText',
      'setStyle',
      'setHidden',
      'setSlot',
      'setRequired',
      'bindData',
      'setStates',
      'insertBlock',
      'setBlockSetting',
      'updateBlock',
      'makeComponent',
      'setInstance',
      'detach',
      'removeComponent',
      'addPage',
      'removePage',
      'setPage',
      'movePage',
      'setSite',
      'setLook',
      'setSiteStyles',
      'setFonts',
    ],
  )
  assert.equal(new Set(OP_NAMES).size, OP_NAMES.length)
})

test('a refusal carries problems and no document, whichever step refused', () => {
  const veto: Allow = () => ({ code: 'POLICY_VIOLATION', message: 'no' })
  for (const r of [
    run([], base(), undefined, { ops: 'x' }), // the shape of the request
    run([{ op: 'paint' }]), // an unknown operation
    run([setText('nope', 'x')]), // an operation refuses
    run([setText('t1', 'ok')], base(), veto), // allow refuses
    run([{ op: 'setProps', tree: T, id: 't1', props: { level: 'h9' } }]), // validation refuses at the end
  ]) {
    assert.ok(!r.ok)
    assert.equal('doc' in r, false)
    assert.ok(r.problems.length > 0)
  }
})

test('an unknown operation name lists the allowed names', () => {
  assert.equal(OP_NAMES.length, 26)
  const ps = refused(run([{ op: 'paint' }]))
  assert.deepEqual(ps[0].allowed, OP_NAMES)
})

test('ops that is not a list, a missing key, a fractional baseRevision: INVALID_OPERATION, no throw', () => {
  for (const r of [
    run([], base(), undefined, { ops: 'x' }),
    run([], base(), undefined, { key: undefined }),
    run([], base(), undefined, { key: '' }),
    run([], base(), undefined, { key: 'k'.repeat(201) }),
    run([], base(), undefined, { baseRevision: 1.5 }),
    plan(base(), reg, null as unknown as ChangeRequest),
  ])
    assert.equal(refused(r)[0].code, 'INVALID_OPERATION')
  ok(run([], base(), undefined, { key: 'k'.repeat(200) }))
})

test('hostile input is refused through plan with the operation index', () => {
  // a payload holding a function
  const fn = refused(
    run([
      setText('t1', 'ok'),
      {
        op: 'add',
        tree: T,
        parent: 'homeroot',
        index: 0,
        node: { kind: 'box', props: { f: () => 1 } },
      },
    ]),
  )
  assert.deepEqual([fn[0].code, fn[0].op], ['INVALID_OPERATION', 1])
  // a malformed style.when in the input document
  const doc = base()
  ;(doc.pages[0].root.children![0] as Node).style = { when: 'x' } as never
  const when = refused(
    run(
      [
        {
          op: 'setStyle',
          tree: T,
          id: 't1',
          layer: { when: { state: 's', is: 'v' } },
          decl: { gap: 1 },
        },
      ],
      doc,
    ),
  )
  assert.deepEqual([when[0].code, when[0].op], ['INVALID_OPERATION', 0])
})

test('planning 50 operations on a 2,000-node page', t => {
  const doc = bigPage(2000)
  const ops = Array.from({ length: 50 }, (_, i) =>
    setText(`t${i}x0`, `new ${i}`),
  )
  const t0 = performance.now()
  const r = plan(doc, reg, req(ops))
  const ms = Math.round(performance.now() - t0)
  t.diagnostic(`plan50: ${ms} ms`)
  assert.ok(r.ok, JSON.stringify(!r.ok && r.problems.slice(0, 2)))
})

const hostile: [string, () => unknown][] = [
  [
    'a Proxy whose getPrototypeOf throws',
    () =>
      new Proxy(
        {},
        {
          getPrototypeOf() {
            throw new Error('trap')
          },
          get() {
            throw new Error('trap')
          },
        },
      ),
  ],
  [
    'an Error whose message getter throws',
    () =>
      Object.defineProperty(new Error('x'), 'message', {
        get() {
          throw new Error('inner')
        },
      }),
  ],
  [
    'an Error whose message is an object',
    () => Object.assign(new Error('x'), { message: { a: 1 } }),
  ],
  ['null', () => null],
  ['a Symbol', () => Symbol('s')],
]
for (const [name, make] of hostile)
  test(`a thrown ${name} is refused with a string message`, () => {
    const viaOp = refused(
      run([
        {
          get op(): string {
            throw make()
          },
        },
      ]),
    )
    const viaAllow = refused(
      run([setText('t1', 'a')], base(), () => {
        throw make()
      }),
    )
    for (const p of [viaOp[0], viaAllow[0]]) {
      assert.equal(typeof p.message, 'string')
      assert.ok(p.message.length > 0 && p.message.length <= 400)
    }
    assert.equal(viaAllow[0].op, 0)
    assert.equal(viaOp[0].code, 'INVALID_OPERATION')
    assert.equal(viaAllow[0].code, 'POLICY_VIOLATION')
  })

test('the note lists every new dead link, not one that was dead before', () => {
  const dead = (r: PlanResult) =>
    ok(r)
      .notes.filter(x => x.text.startsWith('These links now lead'))
      .flatMap(x => x.ids)
  const retarget = (slug: string) => ({
    op: 'setProps',
    tree: T,
    id: 'lt',
    props: { runs: [{ text: 'go', link: { page: slug } }] },
  })
  // retargeted to a missing slug
  assert.deepEqual(dead(run([retarget('/nowhere')], linked())), ['lt'])
  // a new node with a link to a missing page
  assert.deepEqual(
    dead(
      run([
        {
          op: 'add',
          tree: T,
          parent: 'homeroot',
          index: 0,
          node: {
            kind: 'text',
            id: 'nw',
            props: {
              level: 'p',
              runs: [{ text: 'x', link: { page: '/gone' } }],
            },
          },
        },
      ]),
    ),
    ['nw'],
  )
  // already dead before the batch: not listed
  const before = linked()
  before.pages[1].on = false
  assert.deepEqual(dead(run([setText('t1', 'x')], before)), [])
})

test('after plan, created and changed are the ids of the diff, for each of the 26 operations', () => {
  const registry = kitRegistry()
  const pair = (t: unknown, id: string) => `${JSON.stringify(t)}|${id}`
  let doc = siteWith([text('t', 'Hello')])
  let seen = 0
  for (const [i, entry] of OPERATIONS.entries()) {
    const r = plan(doc, registry, req([entry.example], { key: `k${i}` }))
    assert.ok(r.ok, `${entry.op}: ${JSON.stringify(!r.ok && r.problems)}`)
    const d = diffAll(doc, r.doc)
    const added = d.trees.flatMap(t => t.added.map(id => pair(t.tree, id)))
    const other = d.trees.flatMap(t =>
      [...t.moved, ...t.changed.map(c => c.id)].map(id => pair(t.tree, id)),
    )
    const created = r.created.map(c => pair(c.tree, c.id))
    const changed = r.changed.map(c => pair(c.tree, c.id))
    assert.deepEqual(
      [...created].sort(),
      [...added].sort(),
      `${entry.op}: created`,
    )
    assert.deepEqual(
      [...changed].sort(),
      [...new Set(other)].filter(x => !added.includes(x)).sort(),
      `${entry.op}: changed`,
    )
    // a removed node is in neither list, and no node is in both
    for (const t of d.trees)
      for (const id of t.removed) {
        assert.ok(!created.includes(pair(t.tree, id)), entry.op)
        assert.ok(!changed.includes(pair(t.tree, id)), entry.op)
      }
    assert.ok(!changed.some(c => created.includes(c)), entry.op)
    seen += created.length + changed.length
    doc = r.doc
  }
  assert.ok(
    seen > 20,
    'the chain must change nodes for the test to mean something',
  )
})

test('add does not report the parent as changed, and remove names no id (the diff has it under removed)', () => {
  const add = ok(
    run([
      {
        op: 'add',
        tree: T,
        parent: 'homeroot',
        index: 0,
        node: { kind: 'box', id: 'x1' },
      },
    ]),
  )
  assert.deepEqual(add.created, [{ tree: T, id: 'x1' }])
  assert.deepEqual(add.changed, [])
  const rm = ok(run([{ op: 'remove', tree: T, id: 't1' }]))
  assert.deepEqual(rm.created, [])
  assert.deepEqual(rm.changed, [])
  // a text set to the same words changes nothing, and the diff is empty
  const same = ok(run([setText('t1', 'One')]))
  assert.deepEqual(same.changed, [])
  assert.deepEqual(same.pages, [])
})

test('an operation that cannot be written as JSON is refused with its own index, not without one', () => {
  const cyc: Record<string, unknown> = {}
  cyc.self = cyc
  for (const bad of [cyc, { n: 1n }]) {
    const ps = refused(
      run([
        setText('t1', 'a'),
        setText('t2', 'b'),
        { op: 'setText', tree: T, id: 't1', text: bad },
      ]),
    )
    assert.deepEqual([ps[0].code, ps[0].op], ['INVALID_OPERATION', 2])
  }
})

test('a veto from allow is bound: only text fields are copied, a hostile result is still POLICY_VIOLATION', () => {
  const boom = {
    toString() {
      throw new Error('hostile')
    },
  }
  const one = (veto: unknown) =>
    refused(run([setText('t1', 'a')], base(), () => veto as never))[0]
  // fields of the wrong type are dropped, a text message is kept
  assert.deepEqual(
    one({
      code: 'INVALID_NODE',
      message: 'no way',
      rule: 'frozen',
      nodeId: 't1',
      path: 'props',
      allowed: ['a', 'b'],
      extra: 'dropped',
    }),
    {
      code: 'POLICY_VIOLATION',
      message: 'no way',
      rule: 'frozen',
      nodeId: 't1',
      path: 'props',
      allowed: ['a', 'b'],
      op: 0,
    },
  )
  assert.deepEqual(
    one({ message: 'm', rule: 5, nodeId: {}, path: [], allowed: 'x' }),
    {
      code: 'POLICY_VIOLATION',
      message: 'm',
      op: 0,
    },
  )
  // a message that is no text, an object whose toString throws, a getter that throws, a value that is no object
  for (const veto of [
    { message: boom },
    { message: 7 },
    { message: undefined },
    true,
    'no',
    {
      get message() {
        throw new Error('getter')
      },
    },
  ])
    assert.deepEqual(one(veto), {
      code: 'POLICY_VIOLATION',
      message: 'Not allowed.',
      op: 0,
    })
  // a long text is cut
  assert.ok(one({ message: 'x'.repeat(5000) }).message.length <= 500)
})

test('an allow that throws a value with no message says so in words', () => {
  for (const thrown of [{}, undefined, null, Object.create(null)]) {
    const p = refused(
      run([setText('t1', 'a')], base(), () => {
        throw thrown
      }),
    )[0]
    assert.deepEqual([p.code, p.rule, p.op], ['POLICY_VIOLATION', 'allow', 0])
    assert.equal(p.message, 'allow failed: unknown error')
  }
})
