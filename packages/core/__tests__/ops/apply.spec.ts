import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { SiteDocument } from '../../src/document/index.ts'
import { SCHEMA_VERSION } from '../../src/document/migrate.ts'
import { apply, restore } from '../../src/ops/apply.ts'
import { diffSites, type SiteDiff } from '../../src/ops/diff.ts'
import { memoryStore } from '../../src/ops/memoryStore.ts'
import type { Allow, SiteStore } from '../../src/ops/types.ts'
import { createRegistry } from '../../src/registry/index.ts'
import { kitRegistry, siteWith, text, twoPages } from '../kit.ts'
import type { Node } from '../../src/document/index.ts'

const reg = kitRegistry()
const T = { page: 'home' }
const base = () => siteWith([text('t1', 'One'), text('t2', 'Two')])
const set = (id: string, words: string) => ({
  op: 'setText',
  tree: T,
  id,
  text: words,
})
const inst = (id: string): Node => ({
  id,
  kind: 'instance',
  name: id,
  slot: {},
  component: 'card',
})
const A = (ops: unknown[], key = 'k', baseRevision = 0, site = 's') =>
  ({ site, baseRevision, key, ops }) as Parameters<typeof apply>[2]

test('restore calls allow once with { op: "restore", to } and the restored document', async () => {
  const store = memoryStore({ s: base() })
  assert.ok((await apply(store, reg, A([set('t1', 'A')]))).ok)
  const calls: unknown[][] = []
  const allow: Allow = (op, doc) => {
    calls.push([op, doc])
    return undefined
  }
  const r = await restore(
    store,
    reg,
    { site: 's', to: 0, baseRevision: 1, key: 'r' },
    allow,
  )
  assert.ok(r.ok)
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0][0], { op: 'restore', to: 0 })
  assert.deepEqual(calls[0][1], base())
})

test('restore: a veto from allow is POLICY_VIOLATION with the rule, and a throwing allow is rule allow', async () => {
  const store = memoryStore({ s: base() })
  const req = { site: 's', to: 0, baseRevision: 0, key: 'r' }
  const veto = await restore(store, reg, req, () => ({
    code: 'POLICY_VIOLATION',
    message: 'no',
    rule: 'frozen',
  }))
  assert.ok(!veto.ok)
  assert.equal(veto.problems[0].code, 'POLICY_VIOLATION')
  assert.equal(veto.problems[0].rule, 'frozen')
  const boom = await restore(store, reg, req, () => {
    throw new Error('x')
  })
  assert.ok(!boom.ok)
  assert.equal(boom.problems[0].code, 'POLICY_VIOLATION')
  assert.equal(boom.problems[0].rule, 'allow')
  const h = await store.head('s')
  assert.ok('revision' in h && h.revision === 0)
})

test('restore of a document that no longer validates is refused with its problems', async () => {
  const store = memoryStore({ s: base() })
  const ins = {
    op: 'insertBlock',
    tree: T,
    parent: 'homeroot',
    index: 0,
    block: 'demo',
    look: 'default',
    id: 'st',
  }
  assert.ok((await apply(store, reg, A([ins], 'a', 0))).ok)
  assert.ok(
    (await apply(store, reg, A([{ op: 'remove', tree: T, id: 'st' }], 'b', 1)))
      .ok,
  )
  const refused = await restore(store, createRegistry(), {
    site: 's',
    to: 1,
    baseRevision: 2,
    key: 'r',
  })
  assert.ok(!refused.ok)
  assert.ok(refused.problems.length > 0)
  const h = await store.head('s')
  assert.ok('revision' in h && h.revision === 2)
})

test('restore migrates an older schema', async () => {
  const old = base() as SiteDocument & { schemaVersion: number }
  old.schemaVersion = 1
  const store = memoryStore({ s: old })
  const r = await restore(store, reg, {
    site: 's',
    to: 0,
    baseRevision: 0,
    key: 'r',
  })
  assert.ok(r.ok, JSON.stringify(!r.ok && r.problems))
  const h = await store.head('s')
  assert.ok('doc' in h)
  assert.equal(h.doc.schemaVersion, SCHEMA_VERSION)
})

test('a head that does not load is returned as the refusal by apply and by restore', async () => {
  const store = memoryStore({})
  const a = await apply(store, reg, A([set('t1', 'A')]))
  assert.ok(!a.ok)
  assert.equal(a.problems[0].code, 'INVALID_DOCUMENT')
  const r = await restore(store, reg, {
    site: 's',
    to: 0,
    baseRevision: 0,
    key: 'r',
  })
  assert.ok(!r.ok)
  assert.equal(r.problems[0].code, 'INVALID_DOCUMENT')
})

const exploding = (): SiteStore & { calls: number } => {
  const s = {
    calls: 0,
    head: async () => {
      s.calls++
      throw new Error('database down')
    },
    get: async () => {
      s.calls++
      throw new Error('database down')
    },
    replay: async () => {
      s.calls++
      return undefined
    },
    commit: async () => {
      s.calls++
      throw new Error('database down')
    },
  }
  return s
}

test('an exception thrown by the store rejects the promise', async () => {
  const s = exploding()
  await assert.rejects(apply(s, reg, A([set('t1', 'A')])), /database down/)
  await assert.rejects(
    restore(s, reg, { site: 's', to: 0, baseRevision: 0, key: 'r' }),
    /database down/,
  )
})

test('a bad request is INVALID_OPERATION and never reaches the store', async () => {
  const s = exploding()
  const cyc: Record<string, unknown> = {}
  cyc.self = cyc
  const bads: unknown[] = [
    undefined,
    null,
    'x',
    [],
    { baseRevision: 0, ops: [] },
    { site: 's', baseRevision: 0, ops: [] },
    { key: 'k', baseRevision: 0, ops: [] },
    { site: '', key: 'k', baseRevision: 0, ops: [] },
    { site: 's', key: '', baseRevision: 0, ops: [] },
    { site: 's', key: 'k'.repeat(201), baseRevision: 0, ops: [] },
    { site: 's', key: 1, baseRevision: 0, ops: [] },
    { site: 1, key: 'k', baseRevision: 0, ops: [] },
    { site: 's', key: 'k', baseRevision: 0.5, ops: [] },
    { site: 's', key: 'k', baseRevision: '0', ops: [] },
    { site: 's', key: 'k', baseRevision: 0, ops: 'x' },
    { site: 's', key: 'k', baseRevision: 0, ops: [cyc] },
    { site: 's', key: 'k', baseRevision: 0, ops: [{ n: 1n }] },
  ]
  for (const b of bads) {
    const r = await apply(s, reg, b as never)
    assert.ok(!r.ok)
    assert.equal(r.problems[0].code, 'INVALID_OPERATION')
  }
  const rbads: unknown[] = [
    null,
    { site: 's', baseRevision: 0, key: 'k' },
    { site: 's', to: 1.5, baseRevision: 0, key: 'k' },
    { site: 's', to: 0, baseRevision: 'a', key: 'k' },
    { site: 's', to: 0, baseRevision: 0 },
    { to: 0, baseRevision: 0, key: 'k' },
    { site: 's', to: 0, baseRevision: 0, key: '' },
    { site: 's', to: 0, baseRevision: 0, key: 'k'.repeat(201) },
  ]
  for (const b of rbads) {
    const r = await restore(s, reg, b as never)
    assert.ok(!r.ok)
    assert.equal(r.problems[0].code, 'INVALID_OPERATION')
  }
  assert.equal(s.calls, 0)
})

test('a conflict from the store carries its code first', async () => {
  const store = memoryStore({ s: base() })
  const real = store.commit
  store.commit = async (...a) => {
    await real(...a) // another writer got there first
    return {
      ok: false,
      code: 'REVISION_CONFLICT',
      problems: [{ code: 'INVALID_DOCUMENT', message: 'more' }],
    }
  }
  const r = await apply(store, reg, A([set('t1', 'A')]))
  assert.ok(!r.ok)
  assert.deepEqual(
    r.problems.map(p => p.code),
    ['REVISION_CONFLICT', 'INVALID_DOCUMENT'],
  )
})

test('a request whose ops change on each read commits the batch whose request string was recorded', async () => {
  const store = memoryStore({ s: base() })
  const batches = [[set('t1', 'FIRST')], [set('t1', 'SECOND')]]
  let n = 0
  const sly = {
    site: 's',
    baseRevision: 0,
    key: 'k',
    get ops() {
      return batches[Math.min(n++, 1)]
    },
  }
  const r = await apply(store, reg, sly as never)
  assert.ok(r.ok)
  const h = await store.head('s')
  assert.ok('doc' in h)
  const t1 = (h.doc.pages[0].root.children ?? [])[0]
  assert.match(JSON.stringify(t1.props), /FIRST/)
  const again = await apply(store, reg, A(batches[0]))
  assert.deepEqual(again, r)
})

test('a request whose key changes between reads uses one key throughout', async () => {
  const store = memoryStore({ s: base() })
  let n = 0
  const sly = {
    site: 's',
    baseRevision: 0,
    ops: [set('t1', 'A')],
    get key() {
      return `k${n++}`
    },
  }
  assert.ok((await apply(store, reg, sly as never)).ok)
  assert.equal(n, 1)
  assert.ok(await store.replay('s', 'k0'))
})

test('a request with a throwing getter is INVALID_OPERATION and never reaches the store', async () => {
  const s = exploding()
  const boom = () => {
    throw new Error('getter')
  }
  const ok = { site: 's', baseRevision: 0, key: 'k', to: 0, ops: [] }
  for (const f of ['key', 'to', 'site', 'baseRevision', 'ops']) {
    const bad = Object.defineProperty({ ...ok }, f, { get: boom })
    const rs = []
    if (f !== 'to') rs.push(await apply(s, reg, bad as never))
    if (f !== 'ops') rs.push(await restore(s, reg, bad as never))
    for (const r of rs) {
      assert.ok(!r.ok)
      assert.equal(r.problems[0].code, 'INVALID_OPERATION')
    }
  }
  assert.equal(s.calls, 0)
})

test('CUJ 2: one batch adds a menu page and changes a text in a component used on three pages; the result, the diff and the pages agree', async () => {
  const doc = twoPages([{ ...inst('i1'), slot: {} }], [inst('i2')], {})
  doc.pages.push({
    ...doc.pages[1],
    id: 'contact',
    title: 'Contact',
    slug: '/contact',
    inMenu: false,
    root: { ...doc.pages[1].root, id: 'contactroot', children: [inst('i3')] },
  })
  doc.components = [
    {
      id: 'card',
      name: 'Card',
      root: {
        id: 'croot',
        kind: 'column',
        name: 'Card',
        slot: {},
        children: [text('ct', 'Old')],
      },
      props: [],
      variants: [],
    },
  ]
  const store = memoryStore({ s: doc })
  const r = await apply(
    store,
    reg,
    A([
      {
        op: 'addPage',
        title: 'News',
        slug: '/news',
        page: 'news',
        inMenu: true,
      },
      { op: 'setText', tree: { component: 'card' }, id: 'ct', text: 'New' },
    ]),
  )
  assert.ok(r.ok, JSON.stringify(!r.ok && r.problems))
  assert.deepEqual([...r.pages].sort(), ['about', 'contact', 'home', 'news'])
  const a = await store.get('s', 0)
  const b = await store.get('s', r.revision)
  const d = diffSites(a!, b!) as SiteDiff
  assert.equal(d.ok, true)
  assert.equal(d.cut, false)
  // the ids the diff lists are the ids the result lists, and no others
  const listed = d.trees.flatMap(t =>
    [...t.added, ...t.moved, ...t.changed.map(c => c.id)].map(
      id => `${JSON.stringify(t.tree)}|${id}`,
    ),
  )
  const reported = [...r.created, ...r.changed].map(
    c => `${JSON.stringify(c.tree)}|${c.id}`,
  )
  assert.deepEqual([...reported].sort(), [...listed].sort())
  assert.ok(reported.includes('{"component":"card"}|ct'))
  // the menu entry is the page's own setting: it is in `site`, and no tree of another page changed
  assert.ok(d.site.includes('pages.news'))
  assert.deepEqual(d.trees.map(t => JSON.stringify(t.tree)).sort(), [
    '{"component":"card"}',
    '{"page":"news"}',
  ])
  assert.deepEqual([...d.pages].sort(), ['about', 'contact', 'home', 'news'])
})

test('restore names the nodes it brings back as created and the ones it rewrites as changed, as the diff does', async () => {
  const store = memoryStore({ s: base() })
  const gone = await apply(
    store,
    reg,
    A([{ op: 'remove', tree: T, id: 't2' }, set('t1', 'Edited')], 'k1'),
  )
  assert.ok(gone.ok)
  const back = await restore(store, reg, {
    site: 's',
    to: 0,
    baseRevision: 1,
    key: 'r',
  })
  assert.ok(back.ok, JSON.stringify(!back.ok && back.problems))
  assert.deepEqual(back.created, [{ tree: T, id: 't2' }])
  assert.deepEqual(back.changed, [{ tree: T, id: 't1' }])
})

test('a request with no baseRevision is INVALID_OPERATION and the store is not called', async () => {
  const calls: string[] = []
  const inner = memoryStore({ s: base() })
  const store: SiteStore = {
    head: async s => (calls.push('head'), inner.head(s)),
    get: async (s, r) => (calls.push('get'), inner.get(s, r)),
    replay: async (s, k) => (calls.push('replay'), inner.replay(s, k)),
    commit: async (s, c) => (calls.push('commit'), inner.commit(s, c)),
  }
  const noBase = { site: 's', key: 'k', ops: [set('t1', 'A')] }
  const r = await apply(store, reg, noBase as never)
  assert.ok(!r.ok)
  assert.equal(r.problems[0].code, 'INVALID_OPERATION')
  assert.equal(r.problems[0].path, 'baseRevision')
  const r2 = await restore(store, reg, { site: 's', to: 0, key: 'k' } as never)
  assert.ok(!r2.ok)
  assert.equal(r2.problems[0].code, 'INVALID_OPERATION')
  assert.deepEqual(calls, [])
})

test('apply and restore hold a key to 1 to 200 characters, before the store is called; 200 is accepted', async () => {
  const s = exploding()
  for (const key of ['', 'k'.repeat(201), 'k'.repeat(100000)]) {
    const a = await apply(s, reg, { site: 's', key, baseRevision: 0, ops: [] })
    assert.ok(!a.ok)
    assert.deepEqual(
      [a.problems[0].code, a.problems[0].path],
      ['INVALID_OPERATION', 'key'],
    )
    const r = await restore(s, reg, { site: 's', to: 0, baseRevision: 0, key })
    assert.ok(!r.ok)
    assert.deepEqual(
      [r.problems[0].code, r.problems[0].path],
      ['INVALID_OPERATION', 'key'],
    )
  }
  assert.equal(s.calls, 0)
  const store = memoryStore({ s: base() })
  const key = 'k'.repeat(200)
  assert.ok(
    (await restore(store, reg, { site: 's', to: 0, baseRevision: 0, key })).ok,
  )
})

test('restore: a hostile veto is POLICY_VIOLATION with the text fields only, as in plan', async () => {
  const store = memoryStore({ s: base() })
  const req = { site: 's', to: 0, baseRevision: 0, key: 'r' }
  const boom = {
    toString() {
      throw new Error('hostile')
    },
  }
  const r = await restore(
    store,
    reg,
    req,
    () => ({ message: boom, rule: 5, extra: 1 }) as never,
  )
  assert.ok(!r.ok)
  assert.deepEqual(r.problems, [
    { code: 'POLICY_VIOLATION', message: 'Not allowed.' },
  ])
  const t = await restore(store, reg, req, () => {
    throw {}
  })
  assert.ok(!t.ok)
  assert.equal(t.problems[0].message, 'allow failed: unknown error')
})

test('apply migrates an older head before it plans', async () => {
  const old = base() as SiteDocument & { schemaVersion: number }
  old.schemaVersion = 1
  const store = memoryStore({ s: old })
  const r = await apply(store, reg, A([set('t1', 'A')]))
  assert.ok(r.ok, JSON.stringify(!r.ok && r.problems))
  const h = await store.head('s')
  assert.ok('doc' in h)
  assert.equal(h.doc.schemaVersion, SCHEMA_VERSION)
})
