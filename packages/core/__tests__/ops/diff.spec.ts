import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Node, SiteDocument } from '../../src/document/index.ts'
import { READ_CAP, paged } from '../../src/ops/cap.ts'
import { diffAll, diffSites, type SiteDiff } from '../../src/ops/diff.ts'
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
  // reversed siblings: all but one longest ordered run (here a single node) are moved, nothing else is listed
  const c = clone(a)
  homeRoot(c).reverse()
  const tc = treeOf(ok(diffSites(a, c)), { page: 'home' })!
  assert.deepEqual([tc.added, tc.removed, tc.changed], [[], [], []])
  assert.deepEqual(tc.moved, ['t2', 't1']) // in the order of the new tree; t3 stays
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
  const te = treeOf(ok(diffSites(a, e)), { page: 'home' })!
  assert.deepEqual([te.added, te.removed, te.changed], [[], [], []])
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
  assert.deepEqual(t.changed, [{ id: 'b', paths: ['name'] }])
  assert.deepEqual(t.moved.length, 1)
  assert.ok(t.moved[0] === 'a' || t.moved[0] === 'b')
  assert.deepEqual([t.added, t.removed], [[], []])
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
  // the footer alone, with the header unchanged
  const c = clone(a)
  c.footer.children = [text('f', 'hi')]
  const e = ok(diffSites(a, c))
  assert.deepEqual(e.pages, ['home', 'about'])
  assert.deepEqual(treeOf(e, 'footer')!.added, ['f'])
  assert.equal(treeOf(e, 'header'), undefined)
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
  assert.deepEqual(treeOf(d, { component: 'inner' })!.changed, [
    { id: 'it', paths: ['props.runs'] },
  ])
  // a field of the component itself
  const c = clone(a)
  c.components[2].name = 'Renamed'
  const e = ok(diffSites(a, c))
  assert.deepEqual(e.pages, ['third'])
  assert.deepEqual(e.site, ['components.other.name'])
  // a component added or removed
  const f = clone(a)
  f.components.pop()
  const gone = ok(diffSites(a, f))
  assert.deepEqual(gone.site, ['components.other'])
  assert.deepEqual(gone.pages, ['third']) // the page that still holds an instance of it
})

test('a changed component used only in the header or the footer affects every page that is on; one held by an off page affects that page', () => {
  const base = twoPages([text('t', 'x')], [text('u', 'y')])
  base.pages.push({
    ...clone(base.pages[1]),
    id: 'off',
    slug: '/off',
    on: false,
  })
  base.pages[2].root.children = [instance('io', 'offc')]
  base.header.children = [instance('ih', 'hc')]
  base.footer.children = [instance('if', 'fc')]
  base.components = [
    comp('hc', [text('ht', 'h')]),
    comp('fc', [text('ft', 'f')]),
    comp('offc', [text('ot', 'o')]),
  ]
  const edit = (i: number) => {
    const b = clone(base)
    ;(b.components[i].root.children![0].props as { runs: unknown }).runs = [
      { text: 'new' },
    ]
    return ok(diffSites(base, b))
  }
  // in the header (or footer) only: every page that is on, not the off page
  assert.deepEqual(edit(0).pages, ['home', 'about'])
  assert.deepEqual(edit(1).pages, ['home', 'about'])
  // on the off page only: that page, whether or not it is on, and no other
  assert.deepEqual(edit(2).pages, ['off'])
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

test('customEffects diffs name only pages with attachments, following nested masters and chrome', () => {
  const a = twoPages([instance('i', 'outer')], [])
  a.components = [
    comp('outer', [instance('nested', 'inner')]),
    comp('inner', [text('caption', 'Caption')]),
  ]
  a.customEffects = [
    {
      name: 'mist',
      source: 'vec4 shade(vec2 uv){return vec4(1.0);}',
      settings: {},
    },
  ]
  const edit = () => {
    const b = clone(a)
    b.customEffects![0].source += ' '
    const d = ok(diffSites(a, b))
    assert.deepEqual(d.trees, [])
    assert.deepEqual(d.site, ['customEffects'])
    return d.pages
  }
  assert.deepEqual(edit(), [])
  a.components[1].root.motion = { trigger: 'enter-view', gpu: 'mist' }
  assert.deepEqual(edit(), ['home'])
  for (const shared of ['header', 'footer'] as const) {
    a[shared].children = [instance('shared', 'outer')]
    assert.deepEqual(edit(), ['home', 'about'])
    delete a[shared].children
  }
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
  const first = paged(rows, 7, undefined, 'tg', wrap) as ReturnType<typeof wrap>
  assert.equal(first.cut, true)
  assert.ok(JSON.stringify(first).length <= READ_CAP)
  const more = wrap(rows.slice(0, first.r.length + 1), true, 'x:1:tg')
  assert.ok(JSON.stringify(more).length > READ_CAP - 20) // not cut early
  assert.equal(first.cursor, `7:${first.r.length}:tg`)
  const rest = paged(rows, 7, `7:${rows.length}:tg`, 'tg', wrap) as ReturnType<
    typeof wrap
  >
  assert.deepEqual(
    [rest.r, rest.cut, 'cursor' in rest && rest.cursor],
    [[], false, undefined],
  )
  const huge = ['x'.repeat(READ_CAP * 2), 'y']
  const one = paged(huge, 0, undefined, 'tg', wrap) as ReturnType<typeof wrap>
  assert.deepEqual([one.r.length, one.cut, one.cursor], [1, true, '0:1:tg'])
  const code = (c: string | undefined, tag = 'tg') =>
    (
      paged(rows, 7, c, tag, wrap) as {
        problems: { code: string; path?: string; message: string }[]
      }
    ).problems[0]
  assert.equal(code('3:1:tg').code, 'REVISION_CONFLICT')
  for (const bad of [
    '7',
    '7:',
    '7:1',
    'a:b:tg',
    '7:-1:tg',
    '7:1.5:tg',
    '7:5001:tg',
    '7:1:',
    '7:1:T',
    '',
  ])
    assert.deepEqual(
      [code(bad).code, code(bad).path],
      ['INVALID_OPERATION', 'cursor'],
      bad,
    )
  // the tag binds the cursor to the read: another tag is refused, before the revision is looked at
  assert.deepEqual(
    [code('7:1:tg', 'other').code, code('7:1:tg', 'other').path],
    ['INVALID_OPERATION', 'cursor'],
  )
  assert.match(code('3:1:tg', 'other').message, /another read/)
  assert.equal(code('3:1:tg', 'other').code, 'INVALID_OPERATION')
})

// ---- every part of a reply is paged

const collect = (a: SiteDocument, b: SiteDocument) => {
  const site: string[] = []
  const pages: string[] = []
  let cursor: string | undefined
  let n = 0
  for (;;) {
    const d = ok(diffSites(a, b, { cursor }))
    assert.ok(JSON.stringify(d).length <= READ_CAP)
    site.push(...d.site)
    pages.push(...d.pages)
    n++
    if (!d.cut) return { site, pages, n }
    cursor = d.cursor
  }
}

test('800 pages with a setting flipped on each page through within READ_CAP; site and pages are complete, in order, without duplicates', () => {
  const a = twoPages([], [])
  a.pages = Array.from({ length: 800 }, (_, i) => ({
    ...clone(a.pages[0]),
    id: `page-number-${i}`,
    slug: `/p${i}`,
    root: node(`root${i}`, 'column', []),
  }))
  const b = clone(a)
  for (const p of b.pages) p.inMenu = !p.inMenu
  const r = collect(a, b)
  const ids = a.pages.map(p => p.id)
  assert.ok(r.n > 1)
  assert.deepEqual(r.pages, ids)
  assert.deepEqual(
    r.site,
    ids.map(id => `pages.${id}.inMenu`),
  )
  const all = diffAll(a, b)
  assert.deepEqual([all.pages, all.site, all.trees], [r.pages, r.site, []])
})

test('a diff that is only site-level is one reply with no trees', () => {
  const a = twoPages([], [])
  const b = clone(a)
  b.name = 'Other'
  assert.deepEqual(diffSites(a, b), {
    ok: true,
    trees: [],
    site: ['name'],
    pages: [],
    cut: false,
  })
})

test('the largest possible row stays under 2,000 characters', () => {
  const long = 'x'.repeat(60)
  const a = siteWith([text(long, 'a')])
  const b = clone(a)
  const n = homeRoot(b)[0] as unknown as Record<string, unknown>
  for (let i = 0; i < 40; i++)
    n[`field${'y'.repeat(30)}${i}`] = { [`k${'z'.repeat(30)}`]: { deep: i } }
  const d = ok(diffSites(a, b))
  const row = treeOf(d, { page: 'home' })!.changed[0]
  assert.equal(row.paths.length, 20)
  assert.equal(row.more, 20)
  const withTree = { tree: { component: long }, ...row }
  assert.ok(JSON.stringify(withTree).length < 2000)
})

test('20,000 children under one parent diff correctly for one inserted node', () => {
  const kids = Array.from({ length: 20000 }, (_, i) => node(`k${i}`, 'box'))
  const a = siteWith(kids)
  const b = clone(a)
  homeRoot(b).splice(10000, 0, node('fresh', 'box'))
  const t = treeOf(ok(diffSites(a, b)), { page: 'home' })!
  assert.deepEqual(
    [t.added, t.moved, t.removed, t.changed],
    [['fresh'], [], [], []],
  )
})

test('key order does not make a node changed', () => {
  const a = siteWith([
    {
      ...text('t1', 'one'),
      slot: { x: 1, y: 2, w: 6, h: 4, z: 0 },
      style: { base: { color: 'brand', size: 20 } },
      hide: { phone: true },
    } as Node,
  ])
  const b = clone(a)
  const t = homeRoot(b)[0] as unknown as Record<string, unknown>
  // the same node with every object's keys in the opposite order
  const flip = (x: unknown): unknown =>
    Array.isArray(x)
      ? x.map(flip)
      : typeof x === 'object' && x !== null
        ? Object.fromEntries(
            Object.entries(x)
              .reverse()
              .map(([k, v]) => [k, flip(v)]),
          )
        : x
  homeRoot(b)[0] = flip(t) as Node
  assert.notEqual(JSON.stringify(a), JSON.stringify(b))
  const d = ok(diffSites(a, b))
  assert.deepEqual(d.trees, [])
  assert.deepEqual(d.site, [])
  assert.deepEqual(d.pages, [])
})

test('diffSites never throws: options of any shape, a null document, a tree 20,000 levels deep', () => {
  const a = siteWith([text('t1', 'one')])
  const b = clone(a)
  for (const options of [null, 'x', 5, [], { cursor: 7 }, { cursor: {} }]) {
    const r = diffSites(a, b, options as never)
    assert.equal(typeof r.ok, 'boolean', JSON.stringify(options))
  }
  assert.equal(ok(diffSites(a, b, null as never)).trees.length, 0)
  for (const [x, y] of [
    [null, b],
    [a, undefined],
    [null, null],
    ['x', 5],
  ])
    assert.equal(typeof diffSites(x as never, y as never).ok, 'boolean')
  // a column nested 20,000 deep, built in a loop
  const chain = (leaf: string): Node => {
    let top: Node = text('leaf', leaf)
    for (let i = 20000; i > 0; i--) top = node(`d${i}`, 'column', [top])
    return top
  }
  const deepA = siteWith([chain('one')])
  const deepB = siteWith([chain('two')])
  const same = diffSites(deepA, deepA)
  assert.equal(same.ok, true)
  const r = diffSites(deepA, deepB)
  assert.equal(r.ok, true)
  // the content below the guard depth counts as one changed leaf, and the part above it is still diffed
  assert.ok((r as SiteDiff).trees.length > 0)
  assert.equal(diffAll(deepA, deepB).rows.length > 0, true)
  assert.equal(diffAll(deepA, deepA).rows.length, 0)
})

test('a throwing getter in a document becomes INVALID_OPERATION, not an exception', () => {
  const a = siteWith([text('t1', 'one')])
  const bad = clone(a)
  Object.defineProperty(bad, 'pages', {
    get() {
      throw new Error('boom')
    },
  })
  const r = diffSites(a, bad)
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.problems[0].code, 'INVALID_OPERATION')
})

test('a changed row stays small when the document names a field with a very long key: each path is cut to 200 characters', () => {
  const a = siteWith([text('t1', 'one', { other: {} } as never)])
  const b = clone(a)
  const n = homeRoot(b)[0] as unknown as Record<string, unknown>
  n[`long${'k'.repeat(20000)}`] = 1
  n.other = { [`inner${'j'.repeat(20000)}`]: 2 }
  const d = ok(diffSites(a, b))
  const row = treeOf(d, { page: 'home' })!.changed[0]
  assert.equal(row.paths.length, 2)
  for (const p of row.paths) assert.ok(p.length <= 200, String(p.length))
  assert.ok(row.paths[0].startsWith('long'))
  assert.ok(row.paths[1].startsWith('other.inner'))
  assert.ok(JSON.stringify(d).length < 2000)
})

test('two documents that cannot be written as JSON are different, and the answer does not change between calls', () => {
  const a = siteWith([text('t1', 'one')])
  const mk = () => {
    const b = clone(a)
    const cyc: Record<string, unknown> = {}
    cyc.self = cyc
    ;(homeRoot(b)[0] as unknown as Record<string, unknown>).odd = cyc
    return b
  }
  const x = mk()
  const first = JSON.stringify(diffAll(a, x).trees)
  assert.equal(JSON.stringify(diffAll(a, x).trees), first)
  assert.deepEqual(treeOf(ok(diffSites(a, x)), { page: 'home' })!.changed, [
    { id: 't1', paths: ['odd'] },
  ])
})

test('100,000 siblings, reversed, diff in time that rules out a quadratic comparison', () => {
  const kids = Array.from({ length: 100000 }, (_, i) => node(`k${i}`, 'box'))
  const a = siteWith(kids)
  const b = clone(a)
  homeRoot(b).reverse()
  const t0 = Date.now()
  const all = diffAll(a, b)
  const ms = Date.now() - t0
  const t = all.trees.find(x => JSON.stringify(x.tree) === '{"page":"home"}')!
  assert.equal(t.moved.length, 99999) // all but one ordered run of length 1
  // linear: well under a second; the quadratic comparison of 10^5 siblings takes tens of seconds
  assert.ok(ms < 2000, `${ms} ms`)
})
