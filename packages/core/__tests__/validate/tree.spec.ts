import assert from 'node:assert/strict'
import { test } from 'node:test'
import { type Node, type SiteStyles } from '../../src/document/index.ts'
import { createRegistry } from '../../src/registry/index.ts'
import { validateSite } from '../../src/validate/index.ts'
import { mathOk } from '../../src/validate/tree.ts'
import { node } from '../kit.ts'
import {
  base,
  btn,
  calloutPlugin,
  card,
  chain,
  codes,
  col,
  dv,
  fs,
  hostile,
  ids,
  master,
  messages,
  n,
  own,
  pc,
  put,
  reg,
  site,
  text,
  tx,
  txt,
  wide,
} from './helpers.ts'

test('a valid tree with text, links, styles and a catalogue font passes untouched', () => {
  const d = put({
    id: 't1',
    kind: 'text',
    name: 'Title',
    slot: fs(),
    props: {
      level: 'h1',
      runs: [{ text: 'Hi', link: { url: 'https://x.org' } }, { br: true }],
    },
    style: { base: { font: 'cat:inter' } },
  })
  const before = structuredClone(d)
  assert.deepEqual(validateSite(d, reg), [])
  assert.deepEqual(d, before)
})

test('duplicate, malformed and unknown things are refused by name', () => {
  const bad = put(
    { id: 'a', kind: 'text', name: 'A', slot: fs() },
    { id: 'a', kind: 'text', name: 'B', slot: fs(6) },
    { id: 'x.y', kind: 'text', name: 'C', slot: fs() },
    { id: 'b', kind: 'carousel', name: 'D', slot: fs() },
    { id: 'c', kind: 'text', name: 'E', slot: { grow: 1 } },
    { id: 'd', kind: 'image', name: 'F', slot: fs(), props: { assetId: '' } },
    {
      id: 'e',
      kind: 'button',
      name: 'G',
      slot: fs(),
      props: { link: { url: 'javascript:alert(1)' }, label: 'Go' },
    },
    {
      id: 'f',
      kind: 'text',
      name: 'H',
      slot: fs(),
      style: { base: { font: 'cat:roboto' } },
    },
  )
  assert.deepEqual([...ids(bad)].sort(), ['a', 'b', 'c', 'd', 'e', 'f', 'x.y'])
})

test('INVALID_NODE: an unknown node field, a bad id, a repeated id, a child the parent refuses, a style the kind lacks', () => {
  const one = (o: object, root = 'column') =>
    validateSite(
      site(n({ id: 'r', kind: root, name: 'R', slot: {}, children: [o] })),
      reg,
    )
  const field = one({ id: 'a', kind: 'text', name: 'A', slot: {}, enter: {} })
  assert.deepEqual(
    field.map(p => [p.code, p.nodeId, p.path]),
    [['INVALID_NODE', 'a', 'enter']],
  )
  for (const f of ['counter', 'composition', 'extra'])
    assert.equal(
      one({ id: 'a', kind: 'text', name: 'A', slot: {}, [f]: 1 })[0].path,
      f,
    )
  const id = one({ id: 'A_b', kind: 'text', name: 'A', slot: {} })
  assert.deepEqual(
    id.map(p => [p.code, p.nodeId, p.path]),
    [['INVALID_NODE', 'A_b', 'id']],
  )
  const dup = validateSite(site(col(text('a'), text('a'))), reg)
  assert.deepEqual(
    dup.map(p => [p.code, p.nodeId, p.path]),
    [['INVALID_NODE', 'a', 'id']],
  )
  const kid = validateSite(
    site(
      col(
        n({
          id: 'f',
          kind: 'form',
          name: 'F',
          slot: {},
          children: [
            text('t'),
            n({ id: 'x', kind: 'image', name: 'I', slot: {} }),
          ],
        }),
      ),
    ),
    reg,
  )
  assert.deepEqual(
    kid.map(p => [p.code, p.nodeId]),
    [['INVALID_NODE', 'x']],
  )
  const style = one({
    id: 'a',
    kind: 'divider',
    name: 'A',
    slot: {},
    style: { base: { size: 30 } },
  })
  assert.deepEqual(
    style.map(p => [p.code, p.nodeId, p.path]),
    [['INVALID_NODE', 'a', 'style.base.size']],
  )
  const name = one({ id: 'a', kind: 'text', name: 1, slot: {} })
  assert.equal(name[0].path, 'name')
})

test('UNKNOWN_KIND names the node and lists the allowed kinds, plug-in kinds included', () => {
  const p = validateSite(site(col(node('n1', 'frame'))), reg)[0]
  assert.equal(p.code, 'UNKNOWN_KIND')
  assert.ok(p.allowed!.includes('box'))
  assert.equal(p.nodeId, 'n1')
  const r = createRegistry()
  r.use(calloutPlugin())
  const q = validateSite(site(col(node('n1', 'frame'))), r)[0]
  assert.ok(q.allowed!.includes('callout'))
})

test('a node of a plug-in kind with a valid style validates; an invalid style is refused', () => {
  const r = createRegistry()
  r.use(calloutPlugin())
  const withStyle = (base: object) =>
    site(
      col(
        n({ id: 'c1', kind: 'callout', name: 'C', slot: {}, style: { base } }),
      ),
    )
  assert.deepEqual(validateSite(withStyle({ padding: 8, bg: 'brand' }), r), [])
  const bad = validateSite(withStyle({ padding: 'wide' }), r)
  assert.deepEqual(
    bad.map(p => [p.code, p.nodeId]),
    [['INVALID_NODE', 'c1']],
  )
  assert.equal(
    validateSite(withStyle({ padding: 8 }), reg)[0].code,
    'UNKNOWN_KIND',
  )
})

test('a list holds one template when it repeats, a few static children otherwise, and no free layout', () => {
  const kid = (i: number) => ({ id: `k${i}`, kind: 'box', name: 'K', slot: {} })
  const list = (o: object, count: number) => ({
    id: 'l',
    kind: 'list',
    name: 'L',
    slot: fs(),
    children: Array.from({ length: count }, (_, i) => kid(i)),
    ...o,
  })
  const ok = (l: unknown) => validateSite(put(l), reg).length === 0
  assert.ok(
    ok(list({ props: { marker: 'decimal', reversed: true, start: 3 } }, 3)),
  )
  assert.ok(ok(list({}, 200)))
  assert.ok(!ok(list({}, 201)), 'over the cap')
  assert.ok(!ok(list({}, 0)), 'empty')
  assert.ok(
    !ok(list({ repeat: { source: 'projects' } }, 2)),
    'repeat needs one template',
  )
  assert.ok(
    ok(list({ repeat: { source: 'projects', marker: 'disc' } }, 1)),
    'repeat.marker still accepted',
  )
  for (const props of [
    { start: 0 },
    { start: 10000 },
    { start: 1.5 },
    { reversed: 'yes' },
    { marker: 'bullet' },
  ])
    assert.ok(!ok(list({ props }, 2)), JSON.stringify(props))
  const inList = {
    id: 'l',
    kind: 'list',
    name: 'L',
    slot: fs(),
    repeat: { source: 'projects' },
    children: [{ id: 'i', kind: 'free', name: 'I', slot: {}, children: [] }],
  }
  assert.ok(!ok(inList), 'a free layout can not be a list item')
})

test('hostile kinds and prop keys are refused, never thrown on', () => {
  for (const kind of ['constructor', '__proto__', 'toString']) {
    const p = validateSite(put({ id: 'k', kind, name: 'K', slot: fs() }), reg)
    assert.deepEqual(
      p.map(x => [x.code, x.nodeId]),
      [['UNKNOWN_KIND', 'k']],
      kind,
    )
  }
  for (const key of ['constructor', '__proto__', 'toString']) {
    const props = JSON.parse(`{"${key}": {"x": 1}}`)
    assert.ok(codes(put(dv('p', { props }))).includes('INVALID_NODE'), key)
  }
})

test('values with a hostile toString are refused and never thrown on', () => {
  const cases: unknown[] = [
    put({ id: hostile, kind: 'divider', name: 'D', slot: fs() }),
    put({
      id: 'a',
      kind: 'free',
      name: 'F',
      slot: fs(),
      props: { cols: hostile },
      children: [dv('b')],
    }),
    site(
      n({
        id: 'r',
        kind: 'row',
        name: 'R',
        slot: {},
        children: [
          { id: 'c', kind: 'divider', name: 'D', slot: { align: hostile } },
        ],
      }),
    ),
    site(
      n({
        id: 'r',
        kind: 'row',
        name: 'R',
        slot: {},
        children: [
          {
            id: 'c',
            kind: 'divider',
            name: 'D',
            slot: { basis: { n: 1, unit: hostile } },
          },
        ],
      }),
    ),
    put({
      id: 'p',
      kind: 'box',
      name: 'B',
      slot: fs(),
      props: { pattern: { color: hostile, strength: 1 } },
    }),
    put({
      id: 'q',
      kind: 'list',
      name: 'L',
      slot: fs(),
      repeat: { source: hostile, marker: hostile },
      children: [],
    }),
    put({ id: 's', kind: hostile, name: 'S', slot: fs() }),
    put({ id: 's', kind: 'text', name: hostile, slot: fs() }),
  ]
  for (const [i, c] of cases.entries())
    assert.ok(validateSite(c, reg).length > 0, `case ${i}`)
})

test('ids are unique across the pages, header and footer; a component keeps its own ids', () => {
  const d = site(col(text('taken')), {
    footer: node('ft', 'column', [text('taken')]),
  })
  assert.deepEqual([...ids(d)], ['taken'])
  const two = {
    ...base(),
    pages: [
      { ...base().pages[0], root: col(text('a')) },
      {
        ...base().pages[0],
        id: 'two',
        slug: '/two',
        root: node('s', 'column', [text('a')]),
      },
    ],
  }
  assert.deepEqual([...ids(two)], ['a'], 'a second page repeats an id')
  assert.deepEqual(
    codes(site(col(text('title')), { components: [card('c1')] })),
    [],
    'a component part may share an id with a page node',
  )
})

test('dotted ids are allowed only under their own block root', () => {
  const origin = { block: 'demo', version: 1, look: 'default' }
  const t = (id: string) =>
    n({
      id,
      kind: 'text',
      name: 'T',
      slot: {},
      props: { level: 'p', runs: [{ text: 'x' }] },
    })
  const sec = (id: string, kids: unknown[]) =>
    n({ id, kind: 'column', name: 'S', slot: {}, origin, children: kids })
  const under = (root: Node) => site(col(root))
  assert.deepEqual(
    messages(
      under(
        sec('s1', [
          t('s1.title'),
          n({
            id: 's1.box',
            kind: 'box',
            name: 'B',
            slot: {},
            children: [t('s1.body')],
          }),
        ]),
      ),
    ),
    [],
  )
  assert.deepEqual(
    [...ids(site(col(t('s1.title'))))],
    ['s1.title'],
    'outside any block',
  )
  assert.deepEqual(
    [...ids(under(sec('s1', [t('s2.title')])))],
    ['s2.title'],
    'wrong prefix',
  )
  assert.deepEqual(
    [...ids(under(sec('s1', [t('s1.a.b'), t('s1.Bad')])))].sort(),
    ['s1.Bad', 's1.a.b'],
  )
})

test('the rulings: unknown settings, command and target go together, link shapes, a position outside the columns', () => {
  const p = validateSite(
    put(
      {
        id: 'dt',
        kind: 'text',
        name: 'D',
        slot: fs(),
        props: { summary: 'x' },
      },
      { id: 'dg', kind: 'box', name: 'B', slot: fs(), props: { dialog: true } },
      {
        id: 'op',
        kind: 'button',
        name: 'O',
        slot: fs(),
        props: { label: 'o', opens: 'x' },
      },
      {
        id: 'em',
        kind: 'button',
        name: 'E',
        slot: fs(),
        props: { label: 'e', link: { email: 'a b@c' } },
      },
      {
        id: 'pg',
        kind: 'button',
        name: 'P',
        slot: fs(),
        props: { label: 'p', link: { page: 'About' } },
      },
      {
        id: 'fl',
        kind: 'button',
        name: 'F',
        slot: fs(),
        props: { label: 'f', link: { file: '' } },
      },
      {
        id: 'wide',
        kind: 'text',
        name: 'W',
        slot: { x: 20, y: 0, w: 6, h: 4, z: 0 },
      },
    ),
    reg,
  )
  const got = new Set(p.map(x => x.nodeId))
  for (const want of ['dt', 'dg', 'op', 'em', 'pg', 'fl', 'wide'])
    assert.ok(got.has(want), want)
  assert.ok(!got.has('r'))
  const header = n({
    id: 'h',
    kind: 'row',
    name: 'H',
    slot: {},
    children: [
      {
        id: 'bt',
        kind: 'button',
        name: 'B',
        slot: { grow: 1 },
        props: { label: 'Hi', link: { email: 'a@b.org' } },
      },
    ],
  })
  assert.deepEqual(validateSite({ ...base(), header }, reg), [])
})

test('text runs: a run is text, a line break or maths, nothing else', () => {
  const withRun = (r: unknown) =>
    put({ id: 't', kind: 'text', name: 'T', slot: fs(), props: { runs: [r] } })
  assert.deepEqual(validateSite(withRun({ text: 'ok' }), reg), [])
  for (const r of [
    { text: 'ok', extra: 1 },
    'just a string',
    { text: 'x', fromData: true },
    { text: 'x', you: true },
    { counterPart: 'number' },
    null,
  ])
    assert.ok(codes(withRun(r)).length > 0, JSON.stringify(r))
  assert.ok(
    codes(
      put({
        id: 't',
        kind: 'box',
        name: 'T',
        slot: fs(),
        props: { pattern: { color: 'ink', strength: 5, extra: 1 } },
      }),
    ).length > 0,
  )
  assert.ok(
    codes(put(dv('t', { slot: { ...fs(), phone: { ...fs(), extra: 1 } } })))
      .length > 0,
  )
})

test('a link web address may be 2,000 characters, no more', () => {
  const btn = (len: number) =>
    put({
      id: 'u',
      kind: 'button',
      name: 'U',
      slot: fs(),
      props: {
        label: 'Go',
        link: { url: 'https://x.org/' + 'a'.repeat(len - 14) },
      },
    })
  assert.deepEqual(codes(btn(1500)), [])
  assert.deepEqual(codes(btn(2000)), [])
  assert.deepEqual(codes(btn(2001)), ['INVALID_NODE'])
  const inRun = (len: number) =>
    put({
      id: 't',
      kind: 'text',
      name: 'T',
      slot: fs(),
      props: {
        runs: [
          { text: 'x', link: { url: 'https://x.org/' + 'a'.repeat(len - 14) } },
        ],
      },
    })
  assert.deepEqual(codes(inRun(1500)), [])
  assert.deepEqual(codes(inRun(2001)), ['INVALID_NODE'])
})

test('place is accepted on a box and other values are refused', () => {
  const box = (place: string) =>
    put({
      id: 'b',
      kind: 'box',
      name: 'B',
      slot: fs(),
      style: { base: { maxWidth: { n: 1120, unit: 'px' }, place } },
      children: [],
    })
  assert.deepEqual(validateSite(box('center'), reg), [])
  assert.ok(ids(box('middle')).has('b'))
})

test('line-break runs, run styles and pattern size are checked', () => {
  const withRuns = (runs: unknown[]) =>
    put({ id: 't', kind: 'text', name: 'T', slot: fs(), props: { runs } })
  assert.deepEqual(
    codes(withRuns([{ text: 'a' }, { br: true }, { text: 'b' }])),
    [],
  )
  for (const r of [
    { br: false },
    { br: 1 },
    { br: true, text: 'x' },
    { br: 'true' },
  ])
    assert.ok(codes(withRuns([r])).length > 0, JSON.stringify(r))
  assert.deepEqual(
    codes(
      withRuns([
        { text: 'a', style: { bg: 'brand', radius: 4, strike: true } },
      ]),
    ),
    [],
  )
  for (const style of [
    { bg: 'red' },
    { radius: -1 },
    { strike: 'yes' },
    { gradient: 1 },
    { baseline: 'middle' },
    { underlineOffset: 21 },
    { underlineColor: 'red' },
    { smallCaps: 1 },
  ])
    assert.ok(
      codes(withRuns([{ text: 'a', style }])).length > 0,
      JSON.stringify(style),
    )
  const pat = (size: unknown) =>
    put({
      id: 'b',
      kind: 'box',
      name: 'B',
      slot: fs(),
      props: { pattern: { color: 'ink', strength: 5, size } },
    })
  assert.deepEqual(codes(pat(4)), [])
  assert.deepEqual(codes(pat(96)), [])
  for (const s of [3, 97, '40', NaN])
    assert.ok(codes(pat(s)).length > 0, String(s))
})

test('new style keys pass and bad ones are refused with the field in the path', () => {
  const box = (base: unknown) =>
    put({
      id: 'b',
      kind: 'box',
      name: 'B',
      slot: fs(),
      style: { base },
      children: [],
    })
  assert.deepEqual(
    codes(
      box({
        blur: 8,
        pin: 'top',
        radius: { n: 50, unit: '%' },
        strike: true,
        margin: -10,
      }),
    ),
    [],
  )
  const r = validateSite(box({ blur: 99 }), reg)
  assert.equal(r[0].path, 'style.base.blur')
})

test('a run may be superscript, small caps and underline-styled; run styles refuse __proto__ and toString', () => {
  const run = (style: unknown) =>
    put({
      id: 't',
      kind: 'text',
      name: 'T',
      slot: fs(),
      props: { runs: [{ text: 'a', style }] },
    })
  assert.deepEqual(
    codes(
      run({
        baseline: 'super',
        smallCaps: true,
        underlineColor: 'brand',
        underlineOffset: 3,
      }),
    ),
    [],
  )
  for (const k of ['__proto__', 'toString'])
    assert.ok(codes(run(JSON.parse(`{"${k}":1}`))).length > 0, k)
})

test('a slot basis in vh or vw stops at 100', () => {
  const row = (size: number, unit: string) =>
    site(
      n({
        id: 'r',
        kind: 'row',
        name: 'R',
        slot: {},
        children: [
          {
            id: 'c',
            kind: 'box',
            name: 'C',
            slot: { basis: { n: size, unit } },
            children: [],
          },
        ],
      }),
    )
  assert.deepEqual(codes(row(100, 'vh')), [])
  assert.ok(codes(row(101, 'vh')).length > 0)
  assert.ok(codes(row(101, 'vw')).length > 0)
  assert.deepEqual(codes(row(500, 'px')), [])
  // a basis that validates is one the compiler writes: the range is the style layer's
  assert.deepEqual(codes(row(2000, 'px')), [])
  for (const [n, unit] of [
    [3000, 'px'],
    [150, '%'],
    [0, 'ch'],
  ] as const)
    assert.ok(codes(row(n, unit)).length > 0, `${n}${unit}`)
})

test('hide.tablet and placement.tablet are accepted and checked like their phone counterparts', () => {
  const img = (extra: object) =>
    put({
      id: 'i',
      kind: 'image',
      name: 'I',
      slot: fs(),
      props: { assetId: 'img1' },
      ...extra,
    })
  assert.deepEqual(codes(img({ hide: { tablet: true } })), [])
  assert.ok(codes(img({ hide: { tablet: false } })).length > 0)
  assert.deepEqual(
    codes(
      img({ placement: { mode: 'normal', tablet: { mode: 'front', x: 4 } } }),
    ),
    [],
  )
  assert.ok(
    codes(img({ placement: { mode: 'normal', tablet: { mode: 'sideways' } } }))
      .length > 0,
  )
  assert.ok(
    codes(
      img({ placement: { mode: 'normal', tablet: { mode: 'normal', x: 4 } } }),
    ).length > 0,
    'offsets need floating placement',
  )
})

test('tabletCols 13 and a tablet box outside the columns are refused', () => {
  const g = (props: object) =>
    put({ id: 'g', kind: 'grid', name: 'G', slot: fs(), props })
  assert.deepEqual(codes(g({ cols: 4, tabletCols: 2 })), [])
  assert.ok(ids(g({ tabletCols: 13 })).has('g'))
  const t = (tablet: object) =>
    put({
      id: 't',
      kind: 'text',
      name: 'T',
      slot: { ...fs(), tablet },
      props: { level: 'p', runs: [] },
    })
  assert.deepEqual(codes(t({ x: 0, y: 0, w: 24, h: 2, z: 0 })), [])
  assert.ok(ids(t({ x: 20, y: 0, w: 10, h: 2, z: 0 })).has('t'))
})

test('locked is true or absent', () => {
  const mk = (extra: object) =>
    put({
      id: 't1',
      kind: 'text',
      name: 'Title',
      slot: fs(),
      props: { level: 'h2', runs: [{ text: 'Hi' }] },
      ...extra,
    })
  assert.deepEqual(codes(mk({ locked: true })), [])
  for (const bad of [false, 'yes', 1])
    assert.ok(codes(mk({ locked: bad })).length > 0, String(bad))
})

test('RESOURCE_LIMIT_EXCEEDED at 2,001 nodes and at depth 13; 2,000 and 12 pass', () => {
  assert.deepEqual(
    validateSite(site(wide(1999)), reg),
    [],
    '2,000 nodes with the root',
  )
  const over = validateSite(site(wide(2000)), reg)
  assert.deepEqual(
    over.map(p => [p.code, p.nodeId]),
    [['RESOURCE_LIMIT_EXCEEDED', 'r']],
  )
  assert.deepEqual(validateSite(site(chain(12)), reg), [])
  const deep = validateSite(site(chain(13)), reg)
  assert.deepEqual(
    deep.map(p => p.code),
    ['RESOURCE_LIMIT_EXCEEDED'],
  )
  assert.equal(deep[0].nodeId, 'leaf')
})

test('the limits hold for each page, the header, the footer and each component on its own', () => {
  const two = {
    ...base(),
    pages: [
      {
        ...base().pages[0],
        root: node(
          'p1',
          'column',
          Array.from({ length: 1500 }, (_, i) => node(`a${i}`, 'divider')),
        ),
      },
      {
        ...base().pages[0],
        id: 'two',
        slug: '/two',
        root: node(
          'p2',
          'column',
          Array.from({ length: 1500 }, (_, i) => node(`b${i}`, 'divider')),
        ),
      },
    ],
  }
  assert.deepEqual(validateSite(two, reg), [], 'the cap is per page')
  assert.deepEqual(codes({ ...base(), header: wide(2000) }), [
    'RESOURCE_LIMIT_EXCEEDED',
  ])
  assert.deepEqual(codes({ ...base(), footer: chain(13) }), [
    'RESOURCE_LIMIT_EXCEEDED',
  ])
  assert.deepEqual(codes({ ...base(), components: [card('c1', chain(13))] }), [
    'RESOURCE_LIMIT_EXCEEDED',
  ])
})

test('a very deep tree, a very wide one and a tree that contains itself each get one problem, quickly', () => {
  let top: Record<string, unknown> = {
    id: 'leaf',
    kind: 'box',
    name: 'L',
    slot: {},
    children: [],
  }
  for (let i = 0; i < 100000; i++)
    top = { id: 'n', kind: 'box', name: 'N', slot: {}, children: [top] }
  const t0 = performance.now()
  assert.deepEqual(codes(site(n({ ...top, id: 'r' }))), [
    'RESOURCE_LIMIT_EXCEEDED',
  ])
  const shared = node('s', 'divider')
  assert.deepEqual(
    codes(site(node('r', 'column', Array(500_000).fill(shared)))),
    ['RESOURCE_LIMIT_EXCEEDED'],
  )
  const loop = node('r', 'column', [])
  loop.children!.push(loop)
  assert.deepEqual(codes(site(loop)), ['RESOURCE_LIMIT_EXCEEDED'])
  assert.ok(performance.now() - t0 < 2000)
})

test('a tree whose children are not a list of nodes gets one INVALID_NODE', () => {
  const root = (children: unknown) =>
    site(n({ id: 'r', kind: 'column', name: 'R', slot: {}, children }))
  for (const children of ['x', {}, [null], [1], [[]]])
    assert.deepEqual(
      codes(root(children)),
      ['INVALID_NODE'],
      JSON.stringify(children),
    )
  assert.deepEqual(codes({ ...base(), header: null }), ['INVALID_DOCUMENT'])
  assert.deepEqual(
    codes(
      site(
        n({ id: 'r', kind: 'free', name: 'R', slot: { x: 0 }, children: [] }),
      ),
    ),
    ['INVALID_NODE'],
    'the top has no position',
  )
})

test('rich text: maths, dark colours, code runs, tiles, a body from an item, image sources and look hooks', () => {
  const rich = (runs: unknown[], level = 'p') =>
    put({
      id: 'rt',
      kind: 'text',
      name: 'T',
      slot: fs(),
      props: { level, runs },
    })
  const ok = (runs: unknown[], level = 'p') =>
    validateSite(rich(runs, level), reg).length === 0
  assert.ok(
    ok([
      {
        math: '<math display="block"><semantics><mrow><mi>x</mi></mrow><annotation encoding="application/x-tex">x</annotation></semantics></math>',
      },
    ]),
  )
  for (const badMath of [
    '<math><script>alert(1)</script></math>',
    '<math><mi onload="x">x</mi></math>',
    '<math><mi href="https://x.org">x</mi></math>',
    '<math><mi style="color:red">x</mi></math>',
    '<math><!-- c --><mi>x</mi></math>',
    '<math><annotation-xml></annotation-xml></math>',
  ])
    assert.ok(!ok([{ math: badMath }]), badMath)
  assert.ok(
    !ok([{ math: '<math><mi>x</mi></math>', text: 'x' }]),
    'math with text',
  )
  assert.ok(
    !ok([{ math: `<math>${'<mi>x</mi>'.repeat(2100)}</math>` }]),
    'over 20,000 characters',
  )
  assert.ok(
    mathOk('<math><mo form="prefix" movablelimits="true">∑</mo></math>'),
  )
  assert.ok(!mathOk('<math><mo form="prefix" style="color:red">∑</mo></math>'))
  assert.ok(!ok([{ text: 'a', dark: '#aabbcc' }]), 'dark outside code')
  assert.ok(
    ok([{ text: 'a', style: { color: '#112233' }, dark: '#aabbcc' }], 'code'),
  )
  assert.ok(!ok([{ text: 'a', dark: 'red' }], 'code'))
  assert.ok(
    ok(
      Array.from({ length: 3000 }, () => ({ text: 'ab' })),
      'code',
    ),
    'a code text takes 3,000 runs',
  )
  assert.ok(
    !ok(Array.from({ length: 51 }, () => ({ text: 'a' }))),
    'a paragraph takes 50',
  )
  const big = `<math>${'<mi>x</mi>'.repeat(1000)}</math>`
  assert.ok(
    !ok([big, big].map(math => ({ math }))),
    'maths counts toward the characters',
  )
  assert.ok(
    !ok([{ math: '<math><mi>x</mi></math>' }], 'code'),
    'no maths in code',
  )
  for (const tile of [
    'waves',
    'hexagons',
    'triangles',
    'zigzag',
    'scales',
    'topography',
    'circuit',
    'molecules',
    'cubes',
    'sparkles',
  ])
    assert.deepEqual(
      codes(
        put({
          id: 'b',
          kind: 'box',
          name: 'B',
          slot: fs(),
          props: { pattern: { tile, color: 'ink', strength: 20 } },
        }),
      ),
      [],
      tile,
    )
  assert.deepEqual(
    codes(
      put({
        id: 'b',
        kind: 'box',
        name: 'B',
        slot: fs(),
        props: { content: 'item' },
      }),
    ),
    [],
  )
  const img = (src: string) =>
    codes(
      put({ id: 'i', kind: 'image', name: 'I', slot: fs(), props: { src } }),
    )
  assert.deepEqual(img('https://x.org/a.png'), [])
  assert.deepEqual(img('/files/a.png'), [])
  assert.deepEqual(img('javascript:alert(1)'), ['INVALID_NODE'])
  assert.deepEqual(img('//evil.example/a.png'), ['INVALID_NODE'])
  const hook = (base: unknown) =>
    codes(
      put({ id: 'b', kind: 'box', name: 'Card', slot: fs(), style: { base } }),
    )
  assert.deepEqual(
    hook({ surface: 'card', label: true, bg: 'accent', color: 'on-accent' }),
    [],
  )
  for (const base of [
    { surface: 'panel' },
    { label: false },
    { color: 'accentish' },
  ])
    assert.deepEqual(hook(base), ['INVALID_NODE'], JSON.stringify(base))
})

test('a missing colour, shadow or text style is refused; a present one passes', () => {
  const save = (kid: object, styles?: SiteStyles) =>
    validateSite({ ...put(kid), ...(styles ? { styles } : {}) }, reg)
  const style = (base: object) => tx('a', { style: { base } })
  assert.equal(
    save(style({ color: { style: 'accent' } })).length,
    1,
    'no site colours yet',
  )
  assert.deepEqual(save(style({ color: { style: 'accent' } }), own()), [])
  assert.equal(
    save(
      style({ border: { width: 1, style: 'solid', color: { style: 'gone' } } }),
      own(),
    ).length,
    1,
  )
  assert.equal(save(style({ shadow: { style: 'gone' } }), own()).length, 1)
  assert.deepEqual(
    save(style({ shadow: { style: 'soft' } }), own()),
    [],
    'the default shadows are there when the site has none of its own',
  )
  assert.deepEqual(save(style({ shadow: { style: 'soft' } })), [])
  assert.equal(
    save(tx('a', { props: { level: 'p', runs: [], textStyle: 'gone' } }), own())
      .length,
    1,
  )
  assert.deepEqual(
    save(
      tx('a', { props: { level: 'p', runs: [], textStyle: 'body' } }),
      own(),
    ),
    [],
  )
  assert.equal(save(style({ gap: { step: 'huge' } }), own()).length, 1)
  assert.equal(save(style({ color: { style: 'A"};x' } }), own()).length, 1)
  assert.equal(save(tx('a', { style: { when: [] } })).length, 0)
})

test('a font the site does not list is refused wherever a style can put it; system fonts need no listing', () => {
  const doc = (kid: object, fonts: string[] = ['sys:serif', 'sys:sans']) => ({
    ...put(kid),
    fonts,
  })
  const bad = (kid: object) => ids(doc(kid)).has('a')
  assert.ok(bad(tx('a', { style: { base: { font: 'cat:inter' } } })))
  assert.ok(bad(tx('a', { style: { phone: { font: 'cat:inter' } } })))
  assert.ok(
    bad(
      tx('a', {
        props: {
          level: 'p',
          runs: [{ text: 'x', style: { font: 'cat:inter' } }],
        },
      }),
    ),
  )
  assert.ok(
    bad(
      tx('a', {
        state: [{ name: 's', values: ['x', 'y'], initial: 'x' }],
        style: { when: [{ state: 's', is: 'x', decl: { font: 'cat:inter' } }] },
      }),
    ),
  )
  assert.deepEqual(
    validateSite(
      doc(tx('a', { style: { base: { font: 'cat:inter' } } }), [
        'sys:serif',
        'sys:sans',
        'cat:inter',
      ]),
      reg,
    ),
    [],
  )
  assert.deepEqual(
    validateSite(doc(tx('a', { style: { base: { font: 'sys:mono' } } })), reg),
    [],
  )
  const comp = card('c1', master([tx('title', { slot: {} }), txt('badge')]))
  const withOverride = {
    ...doc(
      tx('i1', {
        kind: 'instance',
        component: 'c1',
        props: undefined,
        overrides: { title: { style: { base: { font: 'cat:inter' } } } },
      }),
    ),
    components: [comp],
  }
  assert.ok(ids(withOverride).has('i1'), 'an override of a part')
})

test('a free layout with no room left within its 1,000 rows is refused', () => {
  const at = (id: string) => ({
    id,
    kind: 'divider',
    name: id,
    slot: { x: 0, y: 999, w: 6, h: 4, z: 0 },
  })
  assert.deepEqual(validateSite(put(at('a')), reg), [])
  assert.deepEqual(pc(validateSite(put(at('a'), at('b')), reg)), [
    ['INVALID_NODE', 'r', undefined],
  ])
})

test('an embed names a provider the table has and an id that provider accepts', () => {
  const embed = (props: object) =>
    put({ id: 'e', kind: 'embed', name: 'E', slot: fs(), props })
  const at = (props: object) =>
    validateSite(embed(props), reg).map(p => [p.code, p.nodeId, p.path])
  assert.deepEqual(at({ provider: 'youtube', id: 'dQw4w9WgXcQ' }), [])
  assert.deepEqual(at({ provider: 'vimeo', id: '123456789' }), [])
  assert.deepEqual(
    at({ provider: 'spotify', id: 'track/4uLU6hMCjMI75M1A2tKUQC' }),
    [],
  )
  assert.deepEqual(at({ provider: 'google-maps', id: 'Oxford, UK' }), [])
  assert.deepEqual(at({ provider: 'myspace', id: 'x' }), [
    ['INVALID_NODE', 'e', 'props.provider'],
  ])
  assert.deepEqual(at({ provider: 'youtube', id: 'short' }), [
    ['INVALID_NODE', 'e', 'props.id'],
  ])
  assert.deepEqual(at({ provider: 'youtube', id: '"><script>x' }), [
    ['INVALID_NODE', 'e', 'props.id'],
  ])
  assert.deepEqual(at({ provider: 'vimeo', id: 'dQw4w9WgXcQ' }), [
    ['INVALID_NODE', 'e', 'props.id'],
  ])
  assert.deepEqual(at({ provider: 'constructor', id: 'x' }), [
    ['INVALID_NODE', 'e', 'props.provider'],
  ])
})

test('motion and effect settings are refused until the stage that carries them', () => {
  const refused = (kind: string, props: object, slot: object = fs()) =>
    validateSite(put({ id: 'm', kind, name: 'M', slot, props }), reg).map(p => [
      p.code,
      p.nodeId,
      p.path,
    ])
  assert.deepEqual(refused('box', { motion: 'marquee' }), [
    ['INVALID_NODE', 'm', 'props.motion'],
  ])
  assert.deepEqual(refused('row', { motion: 'marquee' }), [
    ['INVALID_NODE', 'm', 'props.motion'],
  ])
  assert.deepEqual(refused('column', { motion: 'x' }), [
    ['INVALID_NODE', 'm', 'props.motion'],
  ])
  for (const k of ['type', 'cycle', 'count', 'clock', 'split', 'letterHover'])
    assert.deepEqual(
      refused('text', { level: 'p', runs: [], [k]: { x: 1 } }),
      [['INVALID_NODE', 'm', `props.${k}`]],
      k,
    )
  for (const k of ['box', 'text', 'image', 'icon', 'button'])
    for (const d of ['drag', 'dragTilt', 'dragBack'])
      assert.deepEqual(
        refused(k, {
          ...(k === 'text' ? { level: 'p', runs: [] } : {}),
          ...(k === 'button' ? { label: 'Go' } : {}),
          [d]: 1,
        }),
        [['INVALID_NODE', 'm', `props.${d}`]],
        `${k} ${d}`,
      )
  for (const k of ['box', 'row', 'column', 'grid', 'free'])
    assert.deepEqual(
      refused(k, { track: true }),
      [['INVALID_NODE', 'm', 'props.track']],
      k,
    )
  for (const [k, v] of [
    ['pause', true],
    ['action', 'theme'],
  ] as [string, unknown][])
    assert.deepEqual(
      refused('button', { label: 'Go', [k]: v }),
      [['INVALID_NODE', 'm', `props.${k}`]],
      k,
    )
})

test('settings whose scripts stage 1 does not carry are refused, and the plain ones still pass', () => {
  const withProps = (kind: string, props: object, more: object = {}) =>
    put({
      id: 'x',
      kind,
      name: 'X',
      slot: fs(),
      props,
      ...(kind === 'list' ? { children: [node('it', 'column')] } : {}),
      ...more,
    })
  const pass = (kind: string, props: object) =>
    assert.deepEqual(codes(withProps(kind, props)), [], kind)
  pass('list', { start: 2 })
  pass('button', { label: 'Go' })
  pass('menu', { which: 'menu' })
  pass('form', { formId: 'contact' })
  for (const [kind, props] of [
    ['list', { chunk: 3 }],
    ['list', { showFirst: true }],
    ['button', { copyText: 'a' }],
    ['button', { done: 'a' }],
    ['button', { busy: 'a' }],
    ['button', { tag: 'a' }],
    ['box', { tag: 'a' }],
    ['row', { tag: 'a' }],
    ['column', { tag: 'a' }],
    ['grid', { tag: 'a' }],
    ['form', { feedback: true }],
    ['form', { done: 'a' }],
    ['form', { statusMs: 2000 }],
    ['form', { title: 'a' }],
    ['menu', { hint: 'on' }],
  ] as const)
    assert.ok(
      validateSite(withProps(kind, props), reg).some(
        p =>
          p.code === 'INVALID_NODE' &&
          p.path === `props.${Object.keys(props)[0]}`,
      ),
      `${kind} ${Object.keys(props)[0]}`,
    )
  assert.notDeepEqual(
    codes(
      withProps(
        'button',
        { label: 'a' },
        { style: { base: { follow: { x: 4 } } } },
      ),
    ),
    [],
    'follow',
  )
  assert.notDeepEqual(
    codes(
      withProps(
        'button',
        { label: 'a' },
        { bind: { tag: { from: 'site', field: 'a' } } },
      ),
    ),
    [],
    'bind.tag',
  )
})

test('pulse and a pattern drift are refused: their rules wait for a motion script', () => {
  const pattern = (more: object) => ({
    id: 'x',
    kind: 'box',
    name: 'X',
    slot: fs(),
    props: { pattern: { tile: 'dots', color: 'brand', strength: 40, ...more } },
  })
  assert.deepEqual(codes(put(pattern({}))), [], 'control')
  for (const more of [{ drift: 'x' }, { drift: 'x', driftMs: 8000 }])
    assert.notDeepEqual(codes(put(pattern(more))), [], JSON.stringify(more))
  assert.notDeepEqual(
    codes(
      put({
        id: 'x',
        kind: 'box',
        name: 'X',
        slot: fs(),
        style: { base: { pulse: { kind: 'ping', ms: 1200 } } },
      }),
    ),
    [],
    'pulse',
  )
})

test('the top block of a page, header or footer must be a container that fits where a box does', () => {
  const pageWith = (root: Node) => site(root)
  const rooted = (kind: string, extra: object = {}) =>
    ({ id: 'r', kind, name: 'R', slot: {}, ...extra }) as unknown as Node
  assert.deepEqual(codes(pageWith(rooted('column'))), [], 'column')
  assert.deepEqual(codes(pageWith(rooted('free'))), [], 'free')
  for (const kind of ['table-row', 'table-cell', 'field', 'text', 'button'])
    assert.ok(codes(pageWith(rooted(kind))).length > 0, `page ${kind}`)
  assert.match(
    validateSite(site(rooted('table-row')), reg)[0].message,
    /cannot be `table-row`\./,
  )
  assert.ok(
    validateSite({ ...base(), header: rooted('table-row') }, reg).length > 0,
    'header',
  )
  assert.ok(
    validateSite({ ...base(), footer: rooted('field') }, reg).length > 0,
    'footer',
  )
})

test('a page link is held to the slug grammar: a link validation lets through is one a page can have', () => {
  const link = (page: string) =>
    put({
      ...btn('lk', undefined, { label: 'Go', link: { page } }),
      slot: fs(),
    } as unknown as Node)
  for (const page of ['/', '/about', '/a/b-c'])
    assert.deepEqual(codes(link(page)), [], page)
  for (const page of ['/nope//x/', '/a/', '//', '/A', '/a b', 'about', '/a//b'])
    assert.ok(codes(link(page)).length > 0, page)
})

test('a menu cannot list languages: language alternates are not carried', () => {
  const menu = (which: string) =>
    put({ id: 'mn', kind: 'menu', name: 'M', slot: fs(), props: { which } })
  assert.deepEqual(codes(menu('menu')), [])
  assert.deepEqual(codes(menu('footer')), [])
  assert.notDeepEqual(codes(menu('languages')), [])
})

test('required: "yes" is INVALID_NODE', () => {
  assert.ok(
    codes(put(text('t', { required: 'yes' } as never))).includes(
      'INVALID_NODE',
    ),
  )
})

test('required: false on a text is INVALID_NODE; on a form and on a field it is accepted', () => {
  assert.ok(codes(put(text('t', { required: false }))).includes('INVALID_NODE'))
  const form = n({
    id: 'f',
    kind: 'form',
    name: 'f',
    slot: fs(),
    required: false,
    props: { formId: 'f' },
    children: [
      n({
        id: 'a',
        kind: 'field',
        name: 'a',
        slot: {},
        required: false,
        props: { name: 'email', label: 'A' },
      }),
    ],
  })
  assert.equal(codes(put(form)).includes('INVALID_NODE'), false)
})
