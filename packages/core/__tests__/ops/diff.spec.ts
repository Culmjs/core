import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Node, SiteDocument } from '../../src/document/index.ts'
import { READ_CAP, paged } from '../../src/ops/cap.ts'
import { diffSites, type SiteDiff } from '../../src/ops/diff.ts'
import { bigPage, node, siteWith, text, twoPages } from '../kit.ts'

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x))
const ok = (r: ReturnType<typeof diffSites>): SiteDiff => {
  assert.equal(r.ok, true)
  return r as SiteDiff
}
const treeOf = (d: SiteDiff, t: unknown) =>
  d.trees.find(x => JSON.stringify(x.tree) === JSON.stringify(t))
const homeRoot = (d: SiteDocument) => d.pages[0].root.children!

const instance = (id: string, component: string): Node =>
  ({
    id,
    kind: 'instance',
    name: id,
    slot: {},
    component,
  }) as Node
const comp = (id: string, kids: Node[]) => ({
  id,
  name: id,
  root: node(`${id}root`, 'column', kids),
  props: [],
  variants: [],
})

test('added, removed, moved and changed, each in its own list', () => {
  const a = siteWith([
    text('t1', 'one'),
    text('t2', 'two'),
    text('t3', 'three'),
  ])
  const b = clone(a)
  const kids = homeRoot(b)
  kids.splice(2, 1) // t3 removed
  kids.push(text('t4', 'four')) // added
  ;(kids[0].props as { runs: unknown }).runs = [{ text: 'ONE' }]
  const d = ok(diffSites(a, b))
  const t = treeOf(d, { page: 'home' })!
  assert.deepEqual(t.added, ['t4'])
  assert.deepEqual(t.removed, ['t3'])
  assert.deepEqual(t.moved, [])
  assert.deepEqual(t.changed, [{ id: 't1', paths: ['props.runs'] }])
  const c = clone(a)
  homeRoot(c).reverse()
  assert.deepEqual(
    treeOf(ok(diffSites(a, c)), { page: 'home' })!.moved.length > 0,
    true,
  )
})

test('a changed node lists the paths of the fields that differ', () => {
  const a = siteWith([
    text('t1', 'one', { style: { phone: { size: 1, gap: 2 } } } as never),
  ])
  const b = clone(a)
  const n = homeRoot(b)[0] as Node & { style: { phone: { size: number } } }
  n.style.phone.size = 5
  ;(n.props as { runs: unknown }).runs = [{ text: 'x' }]
  n.name = 'other'
  const t = treeOf(ok(diffSites(a, b)), { page: 'home' })!
  assert.deepEqual(t.changed, [
    { id: 't1', paths: ['name', 'props.runs', 'style.phone.size'] },
  ])
})

test('a node with another parent or another index is a move; its unchanged siblings are not listed', () => {
  const a = siteWith([
    node('s1', 'column', [text('a', 'a'), text('b', 'b')]),
    node('s2', 'column', [text('c', 'c')]),
    text('z', 'z'),
  ])
  // another parent
  const b = clone(a)
  const moved = homeRoot(b)[0].children!.pop()!
  homeRoot(b)[1].children!.push(moved)
  assert.deepEqual(treeOf(ok(diffSites(a, b)), { page: 'home' })!.moved, ['b'])
  // another index: one section moved to the top lists only it
  const c = clone(a)
  c.pages[0].root.children = [homeRoot(c)[2], homeRoot(c)[0], homeRoot(c)[1]]
  assert.deepEqual(treeOf(ok(diffSites(a, c)), { page: 'home' })!.moved, ['z'])
  // swapping two lists one of the two, never a bystander
  const e = clone(a)
  e.pages[0].root.children = [homeRoot(e)[1], homeRoot(e)[0], homeRoot(e)[2]]
  const mv = treeOf(ok(diffSites(a, e)), { page: 'home' })!.moved
  assert.equal(mv.length, 1)
  assert.ok(mv[0] === 's1' || mv[0] === 's2')
  // a sibling inserted at the top, or removed before, shifts indexes and moves nobody
  const f = clone(a)
  homeRoot(f).unshift(text('new', 'new'))
  const tf = treeOf(ok(diffSites(a, f)), { page: 'home' })!
  assert.deepEqual([tf.added, tf.moved], [['new'], []])
  const g = clone(a)
  homeRoot(g).shift()
  const tg = treeOf(ok(diffSites(a, g)), { page: 'home' })!
  assert.deepEqual([tg.removed.length, tg.moved], [3, []]) // s1 with its two children
})

test('a node can be both moved and changed', () => {
  const a = siteWith([text('a', 'a'), text('b', 'b')])
  const b = clone(a)
  b.pages[0].root.children = [homeRoot(b)[1], homeRoot(b)[0]]
  homeRoot(b)[0].name = 'renamed'
  const t = treeOf(ok(diffSites(a, b)), { page: 'home' })!
  assert.equal(t.changed.length, 1)
  assert.equal(t.moved.length, 1)
})

test('equal documents give empty lists', () => {
  const a = twoPages([text('t1', 'one')], [text('t2', 'two')])
  const d = ok(diffSites(a, clone(a)))
  assert.deepEqual(d, { ok: true, trees: [], site: [], pages: [], cut: false })
})

test('a page whose own tree changed is affected, and no other', () => {
  const a = twoPages([text('t1', 'one')], [text('t2', 'two')])
  const b = clone(a)
  ;(b.pages[1].root.children![0].props as { runs: unknown }).runs = [
    { text: 'x' },
  ]
  const d = ok(diffSites(a, b))
  assert.deepEqual(d.pages, ['about'])
  assert.deepEqual(d.site, [])
})

test('a changed header affects every page that is on', () => {
  const a = twoPages([], [])
  a.pages.push({ ...clone(a.pages[1]), id: 'off', slug: '/off', on: false })
  const b = clone(a)
  b.header.children = [text('h', 'hi')]
  const d = ok(diffSites(a, b))
  assert.deepEqual(d.pages, ['home', 'about'])
  assert.deepEqual(treeOf(d, 'header')!.added, ['h'])
  b.footer.children = [text('f', 'hi')]
  assert.deepEqual(ok(diffSites(a, b)).pages, ['home', 'about'])
})

test('a changed component affects exactly the pages that hold an instance of it, also through a nested component', () => {
  const a = twoPages([instance('i1', 'outer')], [text('t', 'x')])
  a.pages.push({ ...clone(a.pages[1]), id: 'third', slug: '/third' })
  a.pages[2].root.children = [instance('i3', 'other')]
  a.components = [
    comp('outer', [instance('n', 'inner')]),
    comp('inner', [text('it', 'in')]),
    comp('other', [text('ot', 'o')]),
  ]
  const b = clone(a)
  ;(b.components[1].root.children![0].props as { runs: unknown }).runs = [
    { text: 'new' },
  ]
  const d = ok(diffSites(a, b))
  assert.deepEqual(d.pages, ['home'])
  assert.deepEqual(treeOf(d, { component: 'inner' })!.changed[0].id, 'it')
  // a field of the component itself
  const c = clone(a)
  c.components[2].name = 'Renamed'
  const e = ok(diffSites(a, c))
  assert.deepEqual(e.pages, ['third'])
  assert.deepEqual(e.site, ['components.other.name'])
  // a component added or removed
  const f = clone(a)
  f.components.pop()
  assert.deepEqual(ok(diffSites(a, f)).site, ['components.other'])
})

test('a changed look or site styles affects every page', () => {
  const a = twoPages([], [])
  const b = clone(a)
  b.look = { ...b.look, brand: '#000000' }
  const d = ok(diffSites(a, b))
  assert.deepEqual([d.site, d.pages], [['look'], ['home', 'about']])
  const c = clone(a)
  c.styles = { ...(c.styles ?? {}), text: { base: {} } } as never
  const e = ok(diffSites(a, c))
  assert.deepEqual([e.site, e.pages], [['styles'], ['home', 'about']])
})

test('inMenu on one page is a site-level change listed as pages.<id>.inMenu and affects that page only', () => {
  const a = twoPages([], [])
  const b = clone(a)
  b.pages[1].inMenu = false
  const d = ok(diffSites(a, b))
  assert.deepEqual(d.site, ['pages.about.inMenu'])
  assert.deepEqual(d.pages, ['about'])
  assert.deepEqual(d.trees, [])
})

test('an added page is affected, a removed page is not listed but appears in site, and page order is a site key', () => {
  const a = twoPages([], [])
  const b = clone(a)
  b.pages.pop()
  const r = ok(diffSites(a, b))
  assert.deepEqual([r.site, r.pages], [['pages.about'], []])
  assert.deepEqual(treeOf(r, { page: 'about' })!.removed, ['aboutroot'])
  const s = ok(diffSites(b, a))
  assert.deepEqual([s.site, s.pages], [['pages.about'], ['about']])
  const o = clone(a)
  o.pages.reverse()
  assert.deepEqual(ok(diffSites(a, o)).site, ['pages'])
})

test('it never throws on a malformed document and does not change its inputs', () => {
  const a = twoPages([text('t', 'x')], [])
  const b = clone(a) as unknown as Record<string, unknown>
  b.pages = [null, 3, { id: 'x', root: 7 }]
  b.components = 'no'
  b.header = null
  const before = JSON.stringify(a)
  const d = diffSites(a, b as never)
  assert.equal(d.ok, true)
  assert.equal(JSON.stringify(a), before)
  assert.equal(diffSites(null as never, undefined as never).ok, true)
})

test('a diff of two 2,000-node pages with every text changed pages through within READ_CAP and reaches every id', () => {
  const a = bigPage(2000)
  const b = clone(a)
  const ids: string[] = []
  const go = (n: Node) => {
    if (n.kind === 'text') {
      ;(n.props as { runs: unknown }).runs = [{ text: `new ${n.id}` }]
      ids.push(n.id)
    }
    n.children?.forEach(go)
  }
  go(b.pages[0].root)
  const seen: string[] = []
  let cursor: string | undefined
  let pages = 0
  for (;;) {
    const d = ok(diffSites(a, b, { cursor }))
    assert.ok(JSON.stringify(d).length <= READ_CAP)
    for (const t of d.trees) seen.push(...t.changed.map(c => c.id))
    pages++
    if (!d.cut) break
    cursor = d.cursor
    assert.ok(cursor)
  }
  assert.deepEqual(seen, ids)
  assert.ok(pages > 1)
})

// ---- paged

test('paged takes rows while the reply fits, always makes progress, and refuses a bad cursor', () => {
  const rows = Array.from({ length: 5000 }, (_, i) => `row ${i}`)
  const wrap = (r: string[], cut: boolean, cursor?: string) => ({
    r,
    cut,
    cursor,
  })
  const first = paged(rows, 7, undefined, wrap) as ReturnType<typeof wrap>
  assert.equal(first.cut, true)
  assert.ok(JSON.stringify(first).length <= READ_CAP)
  const more = wrap(rows.slice(0, first.r.length + 1), true, 'x:1')
  assert.ok(JSON.stringify(more).length > READ_CAP - 20) // not cut early
  assert.equal(first.cursor, `7:${first.r.length}`)
  const rest = paged(rows, 7, `7:${rows.length}`, wrap) as ReturnType<
    typeof wrap
  >
  assert.deepEqual(
    [rest.r, rest.cut, 'cursor' in rest && rest.cursor],
    [[], false, undefined],
  )
  const huge = ['x'.repeat(READ_CAP * 2), 'y']
  const one = paged(huge, 0, undefined, wrap) as ReturnType<typeof wrap>
  assert.deepEqual([one.r.length, one.cut, one.cursor], [1, true, '0:1'])
  const code = (c: string | undefined) =>
    (paged(rows, 7, c, wrap) as { problems: { code: string; path?: string }[] })
      .problems[0]
  assert.equal(code('3:1').code, 'REVISION_CONFLICT')
  for (const bad of ['7', '7:', 'a:b', '7:-1', '7:1.5', '7:5001', ''])
    assert.deepEqual(
      [code(bad).code, code(bad).path],
      ['INVALID_OPERATION', 'cursor'],
    )
})
