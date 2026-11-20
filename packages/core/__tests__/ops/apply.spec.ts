import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { SiteDocument } from '../../src/document/index.ts'
import { apply, restore } from '../../src/ops/apply.ts'
import { memoryStore } from '../../src/ops/memoryStore.ts'
import type { Allow, SiteStore } from '../../src/ops/types.ts'
import { createRegistry } from '../../src/registry/index.ts'
import { kitRegistry, siteWith, text } from '../kit.ts'

const reg = kitRegistry()
const T = { page: 'home' }
const base = () => siteWith([text('t1', 'One'), text('t2', 'Two')])
const set = (id: string, words: string) => ({
  op: 'setText',
  tree: T,
  id,
  text: words,
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
  assert.equal(h.doc.schemaVersion, 2)
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
