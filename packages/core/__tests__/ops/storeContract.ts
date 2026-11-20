import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { SiteDocument } from '../../src/document/index.ts'
import { apply, restore } from '../../src/ops/apply.ts'
import type { ApplyResult, SiteStore } from '../../src/ops/types.ts'
import type { Registry } from '../../src/registry/index.ts'
import { siteWith, text } from '../kit.ts'

const T = { page: 'home' }
const doc = () => siteWith([text('t1', 'One'), text('t2', 'Two')])
const set = (id: string, words: string) => ({
  op: 'setText',
  tree: T,
  id,
  text: words,
})
const req = (site: string, baseRevision: number, key: string, ops: unknown[]) =>
  ({ site, baseRevision, key, ops }) as Parameters<typeof apply>[2]
const ok = (r: ApplyResult) => {
  assert.ok(r.ok, JSON.stringify(!r.ok && r.problems))
  return r
}
const code = (r: ApplyResult) => {
  assert.ok(!r.ok, 'expected a refusal')
  return r.problems[0].code
}
const headOf = async (store: SiteStore, site: string) => {
  const h = await store.head(site)
  assert.ok('revision' in h, 'the site has a head')
  return h
}

/** The tests every store must pass. Revisions are compared relative to the first head, never to 0. */
export function storeContract(
  name: string,
  make: (
    doc: SiteDocument,
  ) => Promise<{ store: SiteStore; site: string; registry: Registry }>,
): void {
  describe(name, () => {
    test('of two batches from one revision the second is REVISION_CONFLICT and nothing is written', async () => {
      const { store, site, registry } = await make(doc())
      const r0 = (await headOf(store, site)).revision
      ok(await apply(store, registry, req(site, r0, 'a', [set('t1', 'A')])))
      const after = await headOf(store, site)
      const second = await apply(
        store,
        registry,
        req(site, r0, 'b', [set('t2', 'B')]),
      )
      assert.equal(code(second), 'REVISION_CONFLICT')
      assert.deepEqual(await headOf(store, site), after)
      assert.equal(after.revision, r0 + 1)
    })

    test('a batch whose last operation is refused leaves the stored site unchanged', async () => {
      const { store, site, registry } = await make(doc())
      const before = await headOf(store, site)
      const r = await apply(
        store,
        registry,
        req(site, before.revision, 'k', [set('t1', 'A'), set('nope', 'B')]),
      )
      assert.ok(!r.ok)
      assert.deepEqual(await headOf(store, site), before)
    })

    test('the same key and content twice returns the first result and applies once', async () => {
      const { store, site, registry } = await make(doc())
      const r0 = (await headOf(store, site)).revision
      const request = req(site, r0, 'k', [set('t1', 'A')])
      const first = ok(await apply(store, registry, request))
      const again = ok(await apply(store, registry, request))
      assert.deepEqual(again, first)
      assert.equal(first.revision, r0 + 1)
      assert.equal((await headOf(store, site)).revision, r0 + 1)
    })

    test('the same key with other content is KEY_CONFLICT', async () => {
      const { store, site, registry } = await make(doc())
      const r0 = (await headOf(store, site)).revision
      ok(await apply(store, registry, req(site, r0, 'k', [set('t1', 'A')])))
      const other = await apply(
        store,
        registry,
        req(site, r0, 'k', [set('t1', 'B')]),
      )
      assert.equal(code(other), 'KEY_CONFLICT')
      assert.equal((await headOf(store, site)).revision, r0 + 1)
    })

    test('two copies of one retry sent together both receive the first result', async () => {
      const { store, site, registry } = await make(doc())
      const r0 = (await headOf(store, site)).revision
      const request = req(site, r0, 'k', [set('t1', 'A')])
      const [a, b] = await Promise.all([
        apply(store, registry, request),
        apply(store, registry, request),
      ])
      assert.equal(ok(a).revision, ok(b).revision)
      assert.equal((await headOf(store, site)).revision, r0 + 1)
    })

    test('restore to an earlier revision makes a new revision whose content equals it, and the history is kept', async () => {
      const { store, site, registry } = await make(doc())
      const first = await headOf(store, site)
      ok(
        await apply(
          store,
          registry,
          req(site, first.revision, 'a', [set('t1', 'A')]),
        ),
      )
      const changed = await headOf(store, site)
      const r = ok(
        await restore(store, registry, {
          site,
          to: first.revision,
          baseRevision: first.revision + 1,
          key: 'r',
        }),
      )
      assert.equal(r.revision, first.revision + 2)
      assert.deepEqual(r.created, [])
      assert.deepEqual(r.notes, [])
      assert.deepEqual(r.changed, [{ tree: T, id: 't1' }])
      assert.deepEqual(r.pages, ['home'])
      const head = await headOf(store, site)
      assert.equal(head.revision, first.revision + 2)
      assert.deepEqual(head.doc, first.doc)
      assert.deepEqual(await store.get(site, first.revision), first.doc)
      assert.deepEqual(await store.get(site, first.revision + 1), changed.doc)
    })

    test('restore to a revision the store does not hold is UNSUPPORTED_CAPABILITY', async () => {
      const { store, site, registry } = await make(doc())
      const h = await headOf(store, site)
      const r = await restore(store, registry, {
        site,
        to: h.revision + 5,
        baseRevision: h.revision,
        key: 'r',
      })
      assert.equal(code(r), 'UNSUPPORTED_CAPABILITY')
      assert.equal((await headOf(store, site)).revision, h.revision)
    })

    test('a restore retried with its key returns the first result', async () => {
      const { store, site, registry } = await make(doc())
      const r0 = (await headOf(store, site)).revision
      ok(await apply(store, registry, req(site, r0, 'a', [set('t1', 'A')])))
      const request = { site, to: r0, baseRevision: r0 + 1, key: 'r' }
      const first = ok(await restore(store, registry, request))
      const again = ok(await restore(store, registry, request))
      assert.deepEqual(again, first)
      assert.equal((await headOf(store, site)).revision, r0 + 2)
    })

    test('a restore to the head revision makes a new revision with equal content', async () => {
      const { store, site, registry } = await make(doc())
      const h = await headOf(store, site)
      const r = ok(
        await restore(store, registry, {
          site,
          to: h.revision,
          baseRevision: h.revision,
          key: 'r',
        }),
      )
      assert.equal(r.revision, h.revision + 1)
      assert.deepEqual((await headOf(store, site)).doc, h.doc)
    })

    test('a key resent after its batch was refused is planned again', async () => {
      const { store, site, registry } = await make(doc())
      const r0 = (await headOf(store, site)).revision
      const bad = await apply(
        store,
        registry,
        req(site, r0, 'k', [set('nope', 'A')]),
      )
      assert.ok(!bad.ok)
      const good = await apply(
        store,
        registry,
        req(site, r0, 'k', [set('t1', 'A')]),
      )
      assert.equal(ok(good).revision, r0 + 1)
    })

    test('a batch against a stale revision after a restore is REVISION_CONFLICT', async () => {
      const { store, site, registry } = await make(doc())
      const r0 = (await headOf(store, site)).revision
      ok(await apply(store, registry, req(site, r0, 'a', [set('t1', 'A')])))
      ok(
        await restore(store, registry, {
          site,
          to: r0,
          baseRevision: r0 + 1,
          key: 'r',
        }),
      )
      const stale = await apply(
        store,
        registry,
        req(site, r0 + 1, 'b', [set('t2', 'B')]),
      )
      assert.equal(code(stale), 'REVISION_CONFLICT')
    })

    test('get of the first revision still returns the first document after later commits', async () => {
      const { store, site, registry } = await make(doc())
      const first = await headOf(store, site)
      for (let i = 0; i < 3; i++)
        ok(
          await apply(
            store,
            registry,
            req(site, first.revision + i, `k${i}`, [set('t1', `v${i}`)]),
          ),
        )
      assert.deepEqual(await store.get(site, first.revision), first.doc)
    })

    test('a document the store returns cannot be used to change the store', async () => {
      const { store, site, registry } = await make(doc())
      const h = await headOf(store, site)
      const snapshot = structuredClone(h.doc)
      h.doc.name = 'Changed'
      h.doc.pages[0].root.children = []
      const g = await store.get(site, h.revision)
      assert.ok(g)
      g.name = 'Changed'
      assert.deepEqual((await headOf(store, site)).doc, snapshot)
      assert.deepEqual(await store.get(site, h.revision), snapshot)
      // and the result of apply is not a handle to the stored result either
      const r = ok(
        await apply(
          store,
          registry,
          req(site, h.revision, 'k', [set('t1', 'A')]),
        ),
      )
      r.pages.push('x')
      const again = ok(
        await apply(
          store,
          registry,
          req(site, h.revision, 'k', [set('t1', 'A')]),
        ),
      )
      assert.deepEqual(again.pages, ['home'])
    })
  })
}
