import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Node, SiteDocument } from '../../src/document/index.ts'
import { tagOf } from '../../src/ops/cap.ts'
import { catalogue } from '../../src/ops/catalogue.ts'
import { diffSites } from '../../src/ops/diff.ts'
import {
  pageOutline,
  readNode,
  search,
  siteOutline,
} from '../../src/ops/read.ts'
import { createRegistry } from '../../src/registry/index.ts'
import type { BlockDef } from '../../src/registry/index.ts'
import { bigPage, siteWith, text, twoPages } from '../kit.ts'

// A cursor is bound to the read that made it and to the options that select its rows.

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x))
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ok = (r: any): any => {
  assert.equal(r.ok, true, JSON.stringify(r).slice(0, 300))
  return r
}
/** The code and path of the first problem of a refusal. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const refusal = (r: any) => {
  assert.equal(r.ok, false, 'expected a refusal')
  const p = r.problems[0] as { code: string; path?: string; message: string }
  return p
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const foreign = (r: any) => {
  const p = refusal(r)
  assert.deepEqual([p.code, p.path], ['INVALID_OPERATION', 'cursor'])
  return p
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cursorOf = (r: any): string => {
  ok(r)
  assert.equal(typeof r.cursor, 'string', 'the read was not cut')
  return r.cursor
}
const head = (doc: SiteDocument, revision = 3) => ({ doc, revision })
const page = { page: 'home' }

// two big pages, a site of many pages, a node with a long run, a registry of many blocks, two documents that differ
const bigKids = () => clone(bigPage(2000).pages[0].root.children!)
const twoBig = twoPages(bigKids(), bigKids())
const manyPages = (() => {
  const d = siteWith([])
  for (let i = 0; i < 2000; i++)
    d.pages.push({
      ...clone(d.pages[0]),
      id: `p${i}`,
      slug: `/p${i}`,
      title: 'T'.repeat(500),
    })
  return d
})()
const longRun = (id: string): Node =>
  text(id, '', { props: { level: 'p', runs: [{ text: 'q'.repeat(40000) }] } })
const withLong = siteWith([longRun('b'), longRun('c')])
const miniTree = (): Node => ({
  id: 'root',
  kind: 'column',
  name: 'B',
  slot: {},
  children: [text('x', 'hello')],
})
const block = (id: string, settings = 0): BlockDef => ({
  id,
  version: 1,
  name: id,
  category: 'utility',
  looks: [{ id: 'default', name: 'Default', tree: miniTree() }],
  settings: Array.from({ length: settings }, (_, i) => ({
    key: `sel${i}`,
    label: `Select ${i}`,
    type: 'select' as const,
    options: Array.from({ length: 8 }, (_, j) => ({
      label: `Option ${j}`,
      value: `o${i}x${j}`,
    })),
    actions: [{ do: 'set' as const, path: 'x.props.runs.0.text' }],
  })),
})
const registry = (() => {
  const r = createRegistry()
  r.use({
    name: 'many',
    version: 1,
    api: [1],
    runs: ['build'],
    trust: 'declarative',
    blocks: [
      ...Array.from({ length: 300 }, (_, i) => block(`blk${i}`)),
      block('wideA', 150),
      block('wideB', 150),
    ],
  })
  return r
})()
const docA = bigPage(2000)
const docB = (() => {
  const b = clone(docA)
  const go = (n: Node) => {
    if (n.kind === 'text')
      (n.props as { runs: unknown }).runs = [{ text: `new ${n.id}` }]
    n.children?.forEach(go)
  }
  go(b.pages[0].root)
  return b
})()

/** Every read, as a function of the cursor to give it; all on the same site, same revision. */
const reads: Record<string, (cursor: string) => unknown> = {
  siteOutline: cursor => siteOutline(head(manyPages), { cursor }),
  pageOutline: cursor => pageOutline(head(twoBig), page, { cursor }),
  search: cursor => search(head(twoBig), { kind: 'text', cursor }),
  readNode: cursor => readNode(head(withLong), page, 'b', { cursor }),
  catalogue: cursor => catalogue(registry, { what: 'blocks', cursor }),
  diffSites: cursor => diffSites(docA, docB, { cursor }),
}
const first: Record<string, () => unknown> = {
  siteOutline: () => siteOutline(head(manyPages)),
  pageOutline: () => pageOutline(head(twoBig), page),
  search: () => search(head(twoBig), { kind: 'text' }),
  readNode: () => readNode(head(withLong), page, 'b'),
  catalogue: () => catalogue(registry, { what: 'blocks' }),
  diffSites: () => diffSites(docA, docB),
}

test('a cursor of one read is refused by each of the others, even at the same revision', () => {
  for (const [from, start] of Object.entries(first)) {
    const cursor = cursorOf(start())
    for (const [to, run] of Object.entries(reads)) {
      if (to === from) continue
      const p = foreign(run(cursor))
      assert.ok(p.message.length > 0, `${from} -> ${to}`)
    }
  }
})

test('ordinary paging still completes for all five paged reads and for the diff, each with its own cursors', () => {
  for (const [name, run] of Object.entries(reads)) {
    let cursor: string | undefined
    let replies = 0
    let r = ok(first[name]())
    for (;;) {
      replies++
      cursor = r.cursor
      if (!cursor) break
      assert.equal(r.cut, true, name)
      r = ok(run(cursor))
      assert.ok(replies < 200, name)
    }
    assert.ok(replies > 1, `${name} pages`)
    assert.equal(r.cut, false, name)
  }
})

test('pageOutline: the cursor of another depth, another from, another tree or the same read without them is refused', () => {
  const h = head(twoBig)
  const root = twoBig.pages[0].root.id
  const a = cursorOf(pageOutline(h, page, { depth: 2 }))
  assert.equal(
    ok(pageOutline(h, page, { depth: 2, cursor: a })).revision,
    3,
    'the same options take it',
  )
  for (const other of [
    { depth: 1 },
    { depth: 3 },
    {},
    { depth: 2, from: root },
  ])
    foreign(pageOutline(h, page, { ...other, cursor: a }))
  const b = cursorOf(pageOutline(h, page, { from: root }))
  foreign(pageOutline(h, page, { cursor: b }))
  foreign(pageOutline(h, page, { from: 'c0', cursor: b }))
  const c = cursorOf(pageOutline(h, page))
  foreign(pageOutline(h, { page: 'about' }, { cursor: c }))
  foreign(pageOutline(h, 'header', { cursor: c }))
  ok(pageOutline(h, page, { cursor: c }))
})

test('search: the cursor of another query is refused', () => {
  const h = head(twoBig)
  const a = cursorOf(search(h, { kind: 'text' }))
  for (const q of [
    { kind: 'column' },
    { kind: 'text', text: 'word' },
    { kind: 'text', block: 'demo' },
    { text: 'word' },
  ])
    foreign(search(h, { ...q, cursor: a }))
  ok(search(h, { kind: 'text', cursor: a }))
  // the same words in another field are another query
  const t = cursorOf(search(h, { text: 'word' }))
  foreign(search(h, { kind: 'word', cursor: t }))
  foreign(search(h, { block: 'word', cursor: t }))
})

test('readNode: the cursor of another node or another tree is refused', () => {
  const h = head(withLong)
  const a = cursorOf(readNode(h, page, 'b'))
  foreign(readNode(h, page, 'c', { cursor: a }))
  const both = clone(withLong)
  both.footer = { ...longRun('b'), slot: {} }
  foreign(readNode(head(both), 'footer', 'b', { cursor: a }))
  ok(readNode(h, page, 'b', { cursor: a }))
})

test('catalogue: the cursor of another list or another entry is refused', () => {
  const a = cursorOf(catalogue(registry, { what: 'blocks' }))
  for (const what of ['kinds', 'sources', 'operations'] as const)
    foreign(catalogue(registry, { what, cursor: a }))
  foreign(catalogue(registry, { what: 'blocks', id: 'wideA', cursor: a }))
  const detail = cursorOf(catalogue(registry, { what: 'blocks', id: 'wideA' }))
  foreign(catalogue(registry, { what: 'blocks', id: 'wideB', cursor: detail }))
  foreign(catalogue(registry, { what: 'blocks', cursor: detail }))
  ok(catalogue(registry, { what: 'blocks', id: 'wideA', cursor: detail }))
})

test('diffSites: the cursor of an obviously different pair is refused; the same pair takes it', () => {
  const a = cursorOf(diffSites(docA, docB))
  ok(diffSites(docA, clone(docB), { cursor: a }))
  const fewer = clone(docB)
  fewer.pages[0].root.children!.pop()
  foreign(diffSites(docA, fewer, { cursor: a }))
  const more = clone(docA)
  more.pages.push({ ...clone(more.pages[0]), id: 'extra', slug: '/extra' })
  foreign(diffSites(more, docB, { cursor: a }))
  foreign(
    diffSites(docA, { ...docB, schemaVersion: 1 } as never, { cursor: a }),
  )
  // the limit: a pair with the same glance (here the same two documents, swapped) takes it. The tag guards against mix-ups, it is no proof.
  ok(diffSites(docB, docA, { cursor: a }))
})

test('a cursor in the old two-part form, or with a tag of the wrong shape, is refused as malformed', () => {
  for (const cursor of ['3:1', '3:1:', '3:1:TAG', '3:1:a b', 'x']) {
    assert.equal(
      refusal(pageOutline(head(twoBig), page, { cursor })).code,
      'INVALID_OPERATION',
      cursor,
    )
  }
})

test('tagOf is deterministic, short, base 36, and tells inputs apart', () => {
  const t = tagOf('search', 'a', null, null)
  assert.equal(t, tagOf('search', 'a', null, null))
  assert.match(t, /^[0-9a-z]{1,7}$/)
  const seen = new Set(
    Array.from({ length: 2000 }, (_, i) => tagOf('pageOutline', i, null)),
  )
  assert.equal(seen.size, 2000)
  assert.notEqual(tagOf('a', 'b'), tagOf('b', 'a'))
  assert.notEqual(tagOf('x', null), tagOf('x', 'null'))
  assert.equal(tagOf('x', undefined), tagOf('x', undefined))
})
