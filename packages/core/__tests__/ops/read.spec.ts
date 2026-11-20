import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Node, SiteDocument } from '../../src/document/index.ts'
import { READ_CAP } from '../../src/ops/cap.ts'
import {
  pageOutline,
  readNode,
  search,
  siteOutline,
} from '../../src/ops/read.ts'
import {
  bigPage,
  node,
  sampleRegistry,
  siteWith,
  text,
  twoPages,
} from '../kit.ts'

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x))
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ok = (r: any): any => {
  assert.equal(r.ok, true, JSON.stringify(r))
  return r
}
const size = (r: unknown) => JSON.stringify(r).length
const code = (r: { ok: boolean; problems?: { code: string }[] }) => {
  assert.equal(r.ok, false)
  return r.problems![0].code
}
const head = (doc: SiteDocument, revision = 1) => ({ doc, revision })
const page = { page: 'home' }
const block = (id: string, kids: Node[] = []): Node => ({
  ...node(id, 'column', kids),
  origin: { block: 'demo', version: 1, look: 'default' },
})
const withRuns = (id: string, runs: unknown[]): Node =>
  text(id, '', { props: { level: 'p', runs } as never })

test('siteOutline lists pages with node counts, components with uses, style and font names, the text range and the required count', () => {
  const doc = twoPages(
    [
      text('t1', 'one'),
      { ...node('i1', 'instance'), component: 'card' } as Node,
      { ...node('i2', 'instance'), component: 'card' } as Node,
    ],
    [node('f1', 'form', [node('fld', 'field')])],
    {
      components: [
        {
          id: 'card',
          name: 'Card',
          root: node('cardroot', 'column', [text('ct', 'x')]),
          props: [],
          variants: [],
        },
      ],
      fonts: ['sys:serif', 'cat:inter'],
      languages: [{ code: 'en' }, { code: 'ar', dir: 'rtl' }],
      styles: {
        colors: [{ id: 'c1', name: 'Brand', value: '#ff0000' }],
        text: [{ id: 's1', name: 'Lead', decl: {} }],
        space: { xs: 1, s: 2, m: 3, l: 4, xl: 5, '2xl': 6 },
        shadows: [],
        textRange: { min: 12, max: 60 },
      },
    },
  )
  const r = ok(siteOutline(head(doc, 7)))
  assert.equal(r.revision, 7)
  assert.equal(r.cut, false)
  assert.equal(r.name, 'Ada')
  assert.deepEqual(r.languages, [{ code: 'en' }, { code: 'ar', dir: 'rtl' }])
  assert.deepEqual(r.textRange, { min: 12, max: 60 })
  assert.equal(r.required, 2) // the form and its field
  assert.equal(r.header, 1)
  assert.equal(r.footer, 1)
  assert.deepEqual(r.styles, { colors: ['Brand'], text: ['Lead'], shadows: [] })
  assert.deepEqual(r.fonts, ['sys:serif', 'cat:inter'])
  assert.deepEqual(r.rows, [
    { page: 'home', title: 'Home', slug: '/', on: true, nodes: 4 },
    { page: 'about', title: 'About', slug: '/about', on: true, nodes: 3 },
    { component: 'card', name: 'Card', uses: 2 },
  ])
})

test('siteOutline bounds its header: long names are cut and long lists counted', () => {
  const doc = siteWith([], {
    name: 'N'.repeat(5000),
    fonts: Array.from(
      { length: 300 },
      (_, i) => `up:${'f'.repeat(300)}${i}`,
    ) as never,
    styles: {
      colors: Array.from({ length: 300 }, (_, i) => ({
        id: `c${i}`,
        name: 'x'.repeat(500),
        value: '#000000' as const,
      })),
      text: [],
      space: { xs: 1, s: 2, m: 3, l: 4, xl: 5, '2xl': 6 },
      shadows: [],
    },
  })
  const r = ok(siteOutline(head(doc)))
  assert.equal(r.name.length, 198) // 200 serialised, quotes included
  // 80-character names: the 4,000 limit of the header leaves fewer than 50 of each, and the rest is counted
  assert.ok(r.styles.colors.length <= 50 && r.fonts.length <= 50)
  assert.equal(r.styles.colors.length + r.styles.more.colors, 300)
  assert.equal(r.fonts.length + r.fontsMore, 300)
  assert.ok(size({ ...r, rows: [] }) <= 4100)
  assert.ok(size(r) <= READ_CAP)
})

test('pageOutline gives one row per node with parent, index, hidden layouts, block of origin, required and an 80-character preview', () => {
  const long = 'abcdefghij'.repeat(20)
  const doc = siteWith([
    text('t1', long, { hide: { tablet: true, phone: true } }),
    block('d1', [text('d1.title', 'in block')]),
    node('f1', 'form', [node('fld', 'field')]),
    withRuns('t2', [{ text: 'a' }, { br: true }, { text: 'b' }]),
  ])
  const r = ok(pageOutline(head(doc), page))
  assert.equal(r.cut, false)
  const byId = Object.fromEntries(r.rows.map((x: { id: string }) => [x.id, x]))
  assert.deepEqual(
    r.rows.map((x: { id: string }) => x.id),
    ['home-root', 't1', 'd1', 'd1.title', 'f1', 'fld', 't2'].map(x =>
      x === 'home-root' ? doc.pages[0].root.id : x,
    ),
  )
  const root = doc.pages[0].root.id
  assert.deepEqual(byId.t1, {
    id: 't1',
    kind: 'text',
    name: 't1',
    parent: root,
    index: 0,
    hidden: ['tablet', 'phone'],
    required: false,
    text: long.slice(0, 98),
    children: 0,
  })
  assert.equal(byId[root].parent, null)
  assert.equal(byId[root].children, 4)
  assert.equal(byId.d1.block, 'demo')
  assert.equal(byId.d1.children, 1)
  assert.equal(byId['d1.title'].block, undefined)
  assert.equal(byId['d1.title'].index, 0)
  assert.equal(byId.f1.required, true)
  assert.equal(byId.fld.required, true)
  assert.equal(byId.t2.index, 3)
  assert.equal(byId.t2.text, 'a b')
  assert.deepEqual(byId.t2.hidden, [])
})

test('depth 1 gives the root and its children; from outlines a subtree', () => {
  const doc = siteWith([
    node('c1', 'column', [
      text('a', 'a'),
      node('c2', 'column', [text('b', 'b')]),
    ]),
    text('z', 'z'),
  ])
  const ids = (r: { rows: { id: string }[] }) => r.rows.map(x => x.id)
  const root = doc.pages[0].root.id
  assert.deepEqual(ids(ok(pageOutline(head(doc), page, { depth: 0 }))), [root])
  assert.deepEqual(ids(ok(pageOutline(head(doc), page, { depth: 1 }))), [
    root,
    'c1',
    'z',
  ])
  const sub = ok(pageOutline(head(doc), page, { from: 'c1' }))
  assert.deepEqual(ids(sub), ['c1', 'a', 'c2', 'b'])
  assert.equal(sub.rows[0].parent, root)
  assert.equal(sub.rows[0].index, 0)
  assert.deepEqual(
    ids(ok(pageOutline(head(doc), page, { from: 'c1', depth: 1 }))),
    ['c1', 'a', 'c2'],
  )
})

test('readNode returns the node without children, their ids, and only non-empty layers; a block root also returns its settings', () => {
  const doc = siteWith([
    text('t1', 'hello', {
      style: { base: { gap: 4 }, hover: {}, phone: {}, when: [] },
    }),
    block('d1', [text('d1.title', 'Hi'), text('d1.x', 'y')]),
  ])
  const t = ok(readNode(head(doc), page, 't1'))
  assert.equal(t.cut, false)
  assert.equal(t.cursor, undefined)
  assert.deepEqual(t.node.style, { base: { gap: 4 } })
  assert.deepEqual(t.node.props.runs, [{ text: 'hello' }])
  assert.equal(t.node.children, undefined)
  assert.equal(t.settings, undefined)
  const d = ok(readNode(head(doc), page, 'd1', {}, sampleRegistry()))
  assert.deepEqual(d.node.children, ['d1.title', 'd1.x'])
  assert.equal(d.settings.heading, 'Hi')
  // without a registry there are no settings
  assert.equal(ok(readNode(head(doc), page, 'd1')).settings, undefined)
  // a plain node never has settings
  assert.equal(
    ok(readNode(head(doc), page, 't1', {}, sampleRegistry())).settings,
    undefined,
  )
  // the input is untouched
  assert.deepEqual(doc.pages[0].root.children![0].style, {
    base: { gap: 4 },
    hover: {},
    phone: {},
    when: [],
  })
})

test('search: text is a case-insensitive substring, kind and block are exact, and all given conditions must hold', () => {
  const long = `${'x'.repeat(100)} NEEDLE`
  const doc = twoPages(
    [
      text('t1', 'Hello World'),
      text('t2', long),
      block('d1', [text('d1.title', 'part'), node('d1.col', 'column')]),
      node('c1', 'column', [], {}),
    ],
    [text('t3', 'hello again')],
  )
  doc.header = node('hd', 'row', [text('hdt', 'HELLO header')])
  const hits = (q: object) =>
    ok(search(head(doc), q)).rows.map((x: { id: string }) => x.id)
  assert.deepEqual(hits({ text: 'hello' }), ['hdt', 't1', 't3'])
  // the match looks at the whole text, the row shows 80 characters
  const needle = ok(search(head(doc), { text: 'needle' })).rows
  assert.equal(needle.length, 1)
  assert.equal(needle[0].text, long.slice(0, 98))
  assert.deepEqual(needle[0].tree, page)
  // name matches too
  assert.deepEqual(hits({ text: 'D1.COL' }), ['d1.col'])
  assert.deepEqual(hits({ kind: 'row' }), ['hd'])
  assert.deepEqual(hits({ kind: 'Row' }), [])
  assert.deepEqual(hits({ block: 'demo' }), ['d1', 'd1.title', 'd1.col'])
  assert.deepEqual(hits({ block: 'dem' }), [])
  assert.deepEqual(hits({ block: 'demo', kind: 'text' }), ['d1.title'])
  assert.deepEqual(hits({ text: 'hello', kind: 'text', block: 'demo' }), [])
  assert.deepEqual(ok(search(head(doc), { text: 'hello' })).rows[2].tree, {
    page: 'about',
  })
  assert.deepEqual(
    ok(search(head(doc), { text: 'hello' })).rows[0].tree,
    'header',
  )
})

test('search with no condition is INVALID_OPERATION', () => {
  const h = head(siteWith([text('t1', 'x')]))
  assert.equal(code(search(h, {}) as never), 'INVALID_OPERATION')
  assert.equal(code(search(h, { cursor: '1:0' }) as never), 'INVALID_OPERATION')
  assert.equal(code(search(h, { text: '' }) as never), 'INVALID_OPERATION')
  assert.equal(
    code(search(h, undefined as never) as never),
    'INVALID_OPERATION',
  )
})

test('unknown tree, unknown id, unknown from: INVALID_OPERATION', () => {
  const h = head(siteWith([text('t1', 'x')]))
  assert.equal(code(pageOutline(h, { page: 'nope' })), 'INVALID_OPERATION')
  assert.equal(code(pageOutline(h, { component: 'nope' })), 'INVALID_OPERATION')
  assert.equal(
    code(pageOutline(h, page, { from: 'nope' })),
    'INVALID_OPERATION',
  )
  assert.equal(code(readNode(h, { page: 'nope' }, 't1')), 'INVALID_OPERATION')
  assert.equal(code(readNode(h, page, 'nope')), 'INVALID_OPERATION')
})

test('no read throws on input of the wrong shape or changes its input', () => {
  const doc = siteWith([text('t1', 'x')])
  const before = JSON.stringify(doc)
  const h = head(doc)
  const junk: unknown[] = [
    undefined,
    null,
    5,
    'x',
    [],
    {},
    { page: 1 },
    { a: 1, b: 2 },
  ]
  for (const j of junk) {
    assert.equal(code(pageOutline(h, j as never)), 'INVALID_OPERATION')
    assert.equal(code(readNode(h, j as never, 't1')), 'INVALID_OPERATION')
    assert.equal(code(readNode(h, page, j as never)), 'INVALID_OPERATION')
    assert.equal(code(search(h, j as never)), 'INVALID_OPERATION')
    assert.equal(code(siteOutline(j as never)), 'INVALID_OPERATION')
  }
  for (const o of [
    null,
    5,
    'x',
    [],
    { depth: -1 },
    { depth: 1.5 },
    { depth: '1' },
    { from: 3 },
    { cursor: 3 },
  ])
    assert.equal(
      code(pageOutline(h, page, o as never)),
      'INVALID_OPERATION',
      JSON.stringify(o),
    )
  for (const o of [
    null,
    5,
    { cursor: 3 },
    { cursor: 'x' },
    { cursor: '1:0:0:0' },
  ])
    assert.equal(
      code(readNode(h, page, 't1', o as never)),
      'INVALID_OPERATION',
      JSON.stringify(o),
    )
  // a malformed document
  const broken = { doc: { pages: 5, header: 3 }, revision: 1 } as never
  assert.equal(code(siteOutline(broken)), 'INVALID_OPERATION')
  assert.equal(code(pageOutline(broken, page)), 'INVALID_OPERATION')
  assert.equal(code(search(broken, { text: 'x' })), 'INVALID_OPERATION')
  assert.equal(
    code(siteOutline({ doc: null, revision: 1 } as never)),
    'INVALID_OPERATION',
  )
  assert.equal(
    code(siteOutline({ doc, revision: 'x' } as never)),
    'INVALID_OPERATION',
  )
  assert.equal(JSON.stringify(doc), before)
})

test('on a 2,000-node page no reply exceeds READ_CAP and paging reaches every node', () => {
  const doc = bigPage(2000)
  let cursor: string | undefined
  const ids: string[] = []
  let replies = 0
  let largest = 0
  do {
    const r = ok(pageOutline(head(doc, 3), page, cursor ? { cursor } : {}))
    largest = Math.max(largest, size(r))
    assert.ok(size(r) <= READ_CAP)
    for (const row of r.rows) ids.push(row.id)
    cursor = r.cursor
    assert.equal(r.cut, cursor !== undefined)
    replies++
  } while (cursor)
  const order: string[] = []
  const dfs = (n: Node) => {
    order.push(n.id)
    n.children?.forEach(dfs)
  }
  dfs(doc.pages[0].root)
  assert.deepEqual(ids, order)
  assert.ok(replies <= 40, `replies ${replies}`)
  console.log(`pageOutline 2000: ${replies} replies, largest ${largest}`)

  const found: string[] = []
  let sreplies = 0
  let slargest = 0
  cursor = undefined
  do {
    const r = ok(
      search(head(doc, 3), { kind: 'text', ...(cursor ? { cursor } : {}) }),
    )
    slargest = Math.max(slargest, size(r))
    assert.ok(size(r) <= READ_CAP)
    for (const row of r.rows) found.push(row.id)
    cursor = r.cursor
    sreplies++
  } while (cursor)
  const texts: string[] = []
  const go = (n: Node) => {
    if (n.kind === 'text') texts.push(n.id)
    n.children?.forEach(go)
  }
  go(doc.pages[0].root)
  assert.deepEqual(found, texts)
  console.log(`search 2000: ${sreplies} replies, largest ${slargest}`)

  // a site with 2,000 pages pages through siteOutline
  const many = siteWith([])
  for (let i = 0; i < 2000; i++)
    many.pages.push({
      ...clone(many.pages[0]),
      id: `p${i}`,
      slug: `/p${i}`,
      title: 'T'.repeat(500),
    })
  const pages: string[] = []
  cursor = undefined
  let maxSite = 0
  do {
    const r = ok(siteOutline(head(many, 3), cursor ? { cursor } : {}))
    maxSite = Math.max(maxSite, size(r))
    assert.ok(size(r) <= READ_CAP)
    for (const row of r.rows) pages.push(row.page)
    cursor = r.cursor
  } while (cursor)
  assert.deepEqual(pages, [
    'home',
    ...Array.from({ length: 2000 }, (_, i) => `p${i}`),
  ])
  const first = ok(siteOutline(head(many, 3)))
  assert.equal(
    code(siteOutline(head(many, 4), { cursor: first.cursor })),
    'REVISION_CONFLICT',
  )
  console.log(`siteOutline 2001 pages: largest ${maxSite}`)
})

test('a row stays small whatever the node holds', () => {
  const huge = 'W'.repeat(100000)
  const doc = siteWith([text('t1', huge, { name: huge })])
  const r = ok(pageOutline(head(doc), page))
  assert.ok(size(r) < 1000)
  const s = ok(search(head(doc), { text: 'www' }))
  assert.equal(s.rows[0].text.length, 98)
  assert.ok(size(s) < 1000)
})

test('a cursor used after the revision changed is REVISION_CONFLICT', () => {
  const doc = bigPage(2000)
  const first = ok(pageOutline(head(doc, 3), page))
  assert.equal(
    code(pageOutline(head(doc, 4), page, { cursor: first.cursor })),
    'REVISION_CONFLICT',
  )
  const s = ok(search(head(doc, 3), { kind: 'text' }))
  assert.equal(
    code(search(head(doc, 4), { kind: 'text', cursor: s.cursor })),
    'REVISION_CONFLICT',
  )
  const so = ok(siteOutline(head(Object.assign(siteWith([]), {}), 3)))
  assert.equal(so.cursor, undefined)
  const big = withRuns('b', [{ text: 'q'.repeat(40000) }])
  const rn = ok(readNode(head(siteWith([big]), 3), page, 'b'))
  assert.equal(
    code(readNode(head(siteWith([big]), 4), page, 'b', { cursor: rn.cursor })),
    'REVISION_CONFLICT',
  )
  assert.equal(
    code(pageOutline(head(doc, 3), page, { cursor: '3:99999' })),
    'INVALID_OPERATION',
  )
})

test('one run of 40,000 characters pages through within the cap and joins back to the text', () => {
  const long = Array.from({ length: 40000 }, (_, i) =>
    String.fromCharCode(97 + (i % 26)),
  ).join('')
  const link = { url: 'https://x.org' }
  const doc = siteWith([
    withRuns('big', [{ text: long, link, style: { bold: true } }]),
  ])
  let cursor: string | undefined
  let joined = ''
  let largest = 0
  let replies = 0
  do {
    const r = ok(readNode(head(doc, 5), page, 'big', cursor ? { cursor } : {}))
    largest = Math.max(largest, size(r))
    assert.ok(size(r) <= READ_CAP)
    assert.equal(r.node.id, 'big')
    for (const run of r.node.props.runs) {
      assert.deepEqual(run.link, link)
      assert.deepEqual(run.style, { bold: true })
      joined += run.text
    }
    cursor = r.cursor
    replies++
  } while (cursor)
  assert.equal(joined, long)
  assert.ok(replies >= 3 && replies <= 6, `replies ${replies}`)
  console.log(`40,000-char run: ${replies} replies, largest ${largest}`)
  // surrogate pairs are never split
  const emoji = '\u{1F600}'.repeat(20000)
  const d2 = siteWith([withRuns('e', [{ text: emoji }])])
  let c2: string | undefined
  let j2 = ''
  do {
    const r = ok(readNode(head(d2), page, 'e', c2 ? { cursor: c2 } : {}))
    for (const run of r.node.props.runs) {
      assert.equal(run.text, run.text.toWellFormed())
      j2 += run.text
    }
    c2 = r.cursor
  } while (c2)
  assert.equal(j2, emoji)
})

test('200 runs of 500 characters page through and keep their order and styles', () => {
  const runs = Array.from({ length: 200 }, (_, i) => ({
    text: `${String(i).padStart(3, '0')}${'z'.repeat(497)}`,
    style: { weight: 100 + i },
  }))
  const doc = siteWith([withRuns('many', runs)])
  let cursor: string | undefined
  const got: { text: string; style: { weight: number } }[] = []
  let largest = 0
  let replies = 0
  do {
    const r = ok(readNode(head(doc), page, 'many', cursor ? { cursor } : {}))
    largest = Math.max(largest, size(r))
    assert.ok(size(r) <= READ_CAP)
    got.push(...r.node.props.runs)
    cursor = r.cursor
    replies++
  } while (cursor)
  assert.equal(got.length, 200) // small runs are never split
  assert.deepEqual(got, runs)
  console.log(`200 runs: ${replies} replies, largest ${largest}`)
})

test('readNode cuts long strings and an oversized node never makes an oversized reply', () => {
  const props = {
    level: 'p',
    runs: [{ text: 'keep' }],
    label: 'L'.repeat(5000),
    nested: { deep: ['ok', 'D'.repeat(3000)] },
  }
  const doc = siteWith([
    text('t1', '', { props: props as never }),
    node(
      'w',
      'column',
      Array.from({ length: 3000 }, (_, i) => text(`kid${i}`, 'k')),
    ),
    text('t2', '', {
      props: {
        runs: [{ text: 'r' }],
        a: 'a'.repeat(1990),
        b: Array.from({ length: 200 }, (_, i) => `v${i}${'y'.repeat(1900)}`),
      } as never,
    }),
  ])
  const r = ok(readNode(head(doc), page, 't1'))
  assert.equal(r.node.props.label.length, 1998)
  assert.equal(r.node.props.nested.deep[1].length, 1998)
  assert.equal(r.node.props.nested.deep[0], 'ok')
  assert.deepEqual(r.cutFields.sort(), ['props.label', 'props.nested.deep.1'])
  assert.equal(
    (doc.pages[0].root.children![0].props!.label as string).length,
    5000,
  )
  // 3000 children: the child list is the largest field and is replaced by a marker
  const w = ok(readNode(head(doc), page, 'w'))
  assert.ok(size(w) <= READ_CAP)
  assert.ok(w.cutFields.includes('children'))
  assert.equal(w.node.id, 'w')
  assert.equal(w.node.kind, 'column')
  assert.equal(typeof w.node.children.cut, 'number')
  // 200 strings of 1,900 characters: still within the cap, the largest prop is replaced, runs survive
  const t2 = ok(readNode(head(doc), page, 't2'))
  assert.ok(size(t2) <= READ_CAP)
  assert.ok(t2.cutFields.includes('props.b'))
  assert.deepEqual(t2.node.props.runs, [{ text: 'r' }])
})

// ---- fix round 1: every bound is a serialised length

const ESC = '\u0001'
const Q = '"'
/** Pages through a read; every reply must be within the cap. Returns the replies. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function drain(f: (cursor?: string) => any): any[] {
  const out = []
  let cursor: string | undefined
  do {
    const r = ok(f(cursor))
    assert.ok(size(r) <= READ_CAP, `reply of ${size(r)}`)
    out.push(r)
    cursor = r.cursor
    assert.ok(out.length < 5000)
  } while (cursor)
  return out
}

test('siteOutline: a header of escaped names stays within the cap, and its own length is at most 4,000', () => {
  const heavy = (c: string) => c.repeat(500)
  const doc = siteWith([], {
    name: heavy(ESC),
    fonts: Array.from({ length: 300 }, (_, i) => `up:${heavy(Q)}${i}`) as never,
    languages: Array.from({ length: 40 }, () => ({ code: heavy(ESC) })),
    styles: {
      colors: Array.from({ length: 80 }, () => ({
        id: 'c',
        name: heavy(ESC),
        value: '#000000' as const,
      })),
      text: Array.from({ length: 80 }, () => ({
        id: 't',
        name: heavy(Q),
        decl: {},
      })),
      space: { xs: 1, s: 2, m: 3, l: 4, xl: 5, '2xl': 6 },
      shadows: Array.from({ length: 80 }, () => ({
        id: 's',
        name: heavy(ESC),
        value: { x: 0, y: 0, blur: 0, color: '#000000' } as never,
      })),
    },
  })
  for (let i = 0; i < 30; i++)
    doc.pages.push({
      ...clone(doc.pages[0]),
      id: `p${i}`,
      title: heavy(ESC),
      slug: heavy(Q),
    })
  const replies = drain(c => siteOutline(head(doc), c ? { cursor: c } : {}))
  const pages = replies.flatMap(r =>
    r.rows.map((x: { page: string }) => x.page),
  )
  assert.deepEqual(pages, [
    'home',
    ...Array.from({ length: 30 }, (_, i) => `p${i}`),
  ])
  const bare = { ...replies[0], rows: [], cut: false, cursor: undefined }
  assert.ok(size(bare) <= 4000 + 200, `header ${size(bare)}`)
  console.log(
    `escaped siteOutline: ${replies.length} replies, header ${size(bare)}, largest ${Math.max(...replies.map(size))}`,
  )
})

test('readNode: a 100,000-character prop and 3,000 props keep the fixed part bounded and linear', () => {
  const big = text('big', 'hi', {
    props: {
      runs: [{ text: 'hi' }],
      a: 'A'.repeat(100000),
      b: ESC.repeat(5000),
    } as never,
  })
  const props: Record<string, unknown> = { runs: [{ text: 'hi' }] }
  for (let i = 0; i < 3000; i++) props[`${ESC}${i}`] = 1
  const many = text('many', 'x', { props: props as never })
  const odd = text(ESC.repeat(900), 'x', { kind: ESC.repeat(900) as never })
  const doc = siteWith([big, many, odd])
  for (const id of ['big', 'many', ESC.repeat(900)]) {
    const t0 = Date.now()
    const replies = drain(c =>
      readNode(head(doc), page, id, c ? { cursor: c } : {}),
    )
    const fixed = size({
      ...replies[0],
      node: { ...replies[0].node, props: undefined },
    })
    assert.ok(fixed <= 8000 + 4500, `fixed ${fixed}`)
    assert.ok(replies[0].cutFields.length <= 50)
    for (const p of replies[0].cutFields) assert.ok(len80(p))
    console.log(
      `readNode ${id.slice(0, 5)}: ${Date.now() - t0} ms, largest ${Math.max(...replies.map(size))}`,
    )
  }
  const m = ok(readNode(head(doc), page, 'many'))
  assert.deepEqual(m.node.props.runs, [{ text: 'hi' }])
})
const len80 = (p: string) => JSON.stringify(p).length <= 80

test('readNode: a run with a 30,000-character link and 40,000 characters of text pages through whole', () => {
  const long = Array.from({ length: 40000 }, (_, i) =>
    String.fromCharCode(97 + (i % 26)),
  ).join('')
  const doc = siteWith([
    withRuns('r', [
      { text: long, link: { url: ESC.repeat(30000) }, style: { bold: true } },
      { text: 'after' },
    ]),
  ])
  const replies = drain(c =>
    readNode(head(doc), page, 'r', c ? { cursor: c } : {}),
  )
  const runs = replies.flatMap(r => r.node.props.runs)
  assert.equal(
    runs.map((r: { text: string }) => r.text).join(''),
    `${long}after`,
  )
  assert.ok(replies.length < 30, `replies ${replies.length}`)
  assert.ok(replies[0].cutFields.includes('props.runs.0.link'))
  assert.deepEqual(runs[0].style, { bold: true })
  console.log(
    `30,000 link: ${replies.length} replies, largest ${Math.max(...replies.map(size))}`,
  )
})

test('readNode: a run with empty text and a large skeleton does not lose the runs after it', () => {
  const rs = [
    { text: 'one' },
    {
      text: '',
      link: { url: ESC.repeat(5000) },
      style: { a: ESC.repeat(1999), b: ESC.repeat(1999), c: ESC.repeat(1999) },
    },
    ...Array.from({ length: 30 }, (_, i) => ({
      text: `${i}`.padStart(3, '0') + 'z'.repeat(400),
    })),
  ]
  const doc = siteWith([withRuns('r', rs)])
  const replies = drain(c =>
    readNode(head(doc), page, 'r', c ? { cursor: c } : {}),
  )
  const runs = replies.flatMap(r => r.node.props.runs)
  assert.equal(runs.length, 32)
  assert.deepEqual(
    runs.map((r: { text: string }) => r.text),
    rs.map(r => r.text),
  )
  console.log(
    `empty-text skeleton: ${replies.length} replies, largest ${Math.max(...replies.map(size))}`,
  )
})

test('previews of escape characters stay within the cap, and the largest row is under 1,000', () => {
  const kids = Array.from({ length: 300 }, (_, i) =>
    text(`t${i}`, ESC.repeat(200), { name: Q.repeat(300) }),
  )
  const doc = siteWith(kids)
  const ids = drain(c =>
    pageOutline(head(doc), page, c ? { cursor: c } : {}),
  ).flatMap(r => r.rows.map((x: { id: string }) => x.id))
  assert.equal(ids.length, 301)
  const found = drain(c =>
    search(head(doc), { text: '\u0001', ...(c ? { cursor: c } : {}) }),
  ).flatMap(r => r.rows.map((x: { id: string }) => x.id))
  assert.equal(found.length, 300)
  const row = ok(pageOutline(head(doc), page, { from: 't0' })).rows[0]
  assert.ok(size(row) < 1000, `row ${size(row)}`)
  assert.ok(size(ok(search(head(doc), { kind: 'text' })).rows[0]) < 1000)
})

test('in an invalid document an id of 100,000 characters is cut in every row, so no reply is refused and paging reaches every row', () => {
  const huge = 'I'.repeat(100000)
  const doc = siteWith([
    text('t1', 'one'),
    node(huge, 'column', [text('t2', 'two')]),
    text('t3', 'three'),
  ])
  doc.pages.push({
    ...clone(doc.pages[0]),
    id: huge,
    slug: '/huge',
    root: node('aroot', 'column'),
  })
  doc.components.push({
    id: huge,
    name: 'C',
    root: node('croot', 'column'),
    props: [],
    variants: [],
  })
  const drain = (f: (cursor?: string) => unknown) => {
    const rows: Record<string, unknown>[] = []
    let cursor: string | undefined
    do {
      const r = ok(f(cursor))
      assert.ok(size(r) <= READ_CAP, `${size(r)}`)
      rows.push(...r.rows)
      cursor = r.cursor
    } while (cursor)
    return rows
  }
  const outline = drain(c =>
    pageOutline(head(doc), page, c ? { cursor: c } : {}),
  )
  assert.equal(outline.length, 5)
  assert.ok(outline.every(r => (r.id as string).length <= 200))
  assert.ok(
    outline.every(r => r.parent === null || (r.parent as string).length <= 200),
  )
  assert.deepEqual(
    outline.map(r => (r.id as string).slice(0, 2)),
    ['ho', 't1', 'II', 't2', 't3'],
  )
  const found = drain(c =>
    search(head(doc), { kind: 'column', ...(c ? { cursor: c } : {}) }),
  )
  assert.ok(found.length >= 2)
  assert.ok(found.every(r => (r.id as string).length <= 200))
  const sites = drain(c => siteOutline(head(doc), c ? { cursor: c } : {}))
  assert.ok(sites.every(r => ((r.page ?? r.component) as string).length <= 200))
  assert.equal(sites.length, 3)
})

test('a run whose text is not a string keeps it, cut like any other field', () => {
  const odd = withRuns('o', [
    { text: 5 },
    { text: { a: 'x'.repeat(5000) } },
    { text: 'fine' },
  ])
  const r = ok(readNode(head(siteWith([odd])), page, 'o'))
  const runs = r.node.props.runs
  assert.equal(runs[0].text, 5)
  assert.equal(typeof runs[1].text, 'object')
  assert.ok(
    r.cutFields.includes('props.runs.1.text.a'),
    JSON.stringify(r.cutFields),
  )
  assert.equal(runs[2].text, 'fine')
})
