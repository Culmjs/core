import assert from 'node:assert/strict'
import { test } from 'node:test'
import { KINDS, type Node } from '../../src/document/index.ts'
import { dropSamples } from '../../src/document/samples.ts'
import { SHAPE_LIMITS } from '../../src/document/kinds.ts'
import { validateSite } from '../../src/validate/index.ts'
import { defaultSiteStyles } from '../../src/style/index.ts'
import { LOOK } from '../kit.ts'
import { base, col, n, reg, site } from '../validate/helpers.ts'

const shape = (props: object, more: object = {}): Node =>
  n({ id: 's', kind: 'shape', name: 'S', slot: {}, props, ...more })
/** A group needs a part; any other geometry holds none. */
const kidsFor = (g: { type?: string }) =>
  g.type === 'group' ? { children: [cpart('k')] } : {}
/** The problems of a page holding one shape. */
const probs = (props: object, more: object = {}, s = base().styles) =>
  validateSite(site(col(shape(props, more)), s ? { styles: s } : {}), reg)
const paths = (props: object, more: object = {}) =>
  probs(props, more).map(p => p.path)

test('KINDS has 22 kinds and shape is a leaf that holds only shapes, with no tip', () => {
  assert.equal(Object.keys(KINDS).length, 22)
  assert.equal(KINDS.shape.role, 'leaf')
  assert.deepEqual(KINDS.shape.children, {
    min: 0,
    max: SHAPE_LIMITS.children,
    kinds: ['shape'],
  })
  assert.equal(KINDS.shape.tag(null, shape({}), null), 'svg')
  assert.equal(KINDS.shape.display(shape({})), 'block')
  assert.ok(!('tip' in KINDS.shape.props))
  assert.equal(KINDS.shape.props.geometry!.required, true)
  assert.deepEqual(SHAPE_LIMITS, { children: 32, depth: 4, path: 8000 })
  // other leaves still hold nothing
  const t = n({
    id: 't',
    kind: 'text',
    name: 'T',
    slot: {},
    props: { level: 'p', runs: [{ text: 'a' }] },
    children: [shape({ geometry: { type: 'ellipse' } })],
  })
  assert.ok(validateSite(site(col(t)), reg).some(p => p.path === 'children'))
})

test('each geometry of decision 3 at its bounds is accepted; one past each bound is refused at props.geometry', () => {
  const ok: object[] = [
    { type: 'rect' },
    { type: 'rect', radius: 0 },
    { type: 'rect', radius: 9999 },
    { type: 'rect', radius: [0, 5, 9999, 1] },
    { type: 'ellipse' },
    { type: 'polygon', sides: 3 },
    { type: 'polygon', sides: 12, rotate: -360 },
    { type: 'polygon', sides: 5, rotate: 360 },
    { type: 'star', points: 3, inner: 0.1 },
    { type: 'star', points: 24, inner: 0.95, rotate: 0 },
    { type: 'line', from: [0, 0], to: [100, 100] },
    { type: 'blob', seed: 0 },
    { type: 'blob', seed: 2147483647, smooth: 1, points: 12 },
    { type: 'blob', seed: 5, smooth: 0, points: 3 },
    { type: 'path', d: 'M0 0L10 10Z' },
    { type: 'path', d: 'M0 0', view: [1, 10000] },
    { type: 'group' },
    { type: 'group', view: [10000, 1], combine: 'subtract' },
  ]
  for (const geometry of ok)
    assert.deepEqual(
      probs({ geometry }, kidsFor(geometry)),
      [],
      JSON.stringify(geometry),
    )
  const bad: object[] = [
    {},
    { type: 'cube' },
    { type: 'rect', radius: 10000 },
    { type: 'rect', radius: -1 },
    { type: 'rect', radius: [1, 2, 3] },
    { type: 'rect', extra: 1 },
    { type: 'polygon', sides: 2 },
    { type: 'polygon', sides: 13 },
    { type: 'polygon', sides: 4.5 },
    { type: 'polygon', sides: 4, rotate: 361 },
    { type: 'star', points: 2, inner: 0.5 },
    { type: 'star', points: 25, inner: 0.5 },
    { type: 'star', points: 5, inner: 0.09 },
    { type: 'star', points: 5, inner: 0.96 },
    { type: 'line', from: [0, 0], to: [101, 0] },
    { type: 'line', from: [-1, 0], to: [0, 0] },
    { type: 'line', from: [0, 0] },
    { type: 'blob', seed: 2147483648 },
    { type: 'blob', seed: -1 },
    { type: 'blob', seed: 1.5 },
    { type: 'blob', seed: 1, smooth: 1.01 },
    { type: 'blob', seed: 1, points: 2 },
    { type: 'blob', seed: 1, points: 13 },
    { type: 'path', d: 'M0 0', view: [0, 5] },
    { type: 'path', d: 'M0 0', view: [10001, 5] },
    { type: 'path' },
    { type: 'group', combine: 'merge' },
    { type: 'group', view: [5] },
  ]
  for (const geometry of bad)
    assert.deepEqual(
      probs({ geometry }, kidsFor(geometry)).map(p => p.path),
      ['props.geometry'],
      JSON.stringify(geometry),
    )
  assert.deepEqual(paths({}), ['props.geometry'], 'geometry is required')
})

test('path data with "/><script>", with a letter outside the commands, or of 8,001 characters is refused', () => {
  const d = (s: string) => paths({ geometry: { type: 'path', d: s } })
  assert.deepEqual(d('M0 0"/><script>alert(1)</script>'), ['props.geometry'])
  assert.deepEqual(d('M0 0 B 5 5'), ['props.geometry'])
  assert.deepEqual(d('M0 0 x 5'), ['props.geometry'])
  assert.deepEqual(d(''), ['props.geometry'])
  assert.deepEqual(d('M'.padEnd(8001, '0')), ['props.geometry'])
  assert.deepEqual(d('M'.padEnd(8000, '0')), [])
  assert.deepEqual(d('M1e-3 2.5E+2 .5,-3 z'), [])
})

test('fill accepts a site colour name, { style }, #rrggbb, a two-colour gradient and none; stroke and opacity at their bounds', () => {
  const geometry = { type: 'ellipse' }
  const styles = {
    ...defaultSiteStyles(LOOK),
    colors: [{ id: 'sun', name: 'Sun', value: '#ffcc00' as const }],
  }
  for (const fill of [
    'brand',
    'accent',
    { style: 'sun' },
    '#aabbcc',
    'none',
    { from: 'brand', to: { style: 'sun' } },
    { from: '#000000', to: '#ffffff', angle: 360 },
    { from: 'ink', to: 'bg', angle: 0 },
  ])
    assert.deepEqual(
      probs({ geometry, fill }, {}, styles),
      [],
      JSON.stringify(fill),
    )
  for (const fill of [
    'red',
    '#abc',
    { style: 'nope' },
    { from: 'brand' },
    { from: 'brand', to: 'ink', angle: 361 },
    { from: 'brand', to: 'ink', x: 1 },
    { from: 'brand', to: 'javascript:1' },
    7,
  ])
    assert.deepEqual(
      probs({ geometry, fill }, {}, styles).map(p => p.path),
      ['props.fill'],
      JSON.stringify(fill),
    )
  const good = (stroke: object) => probs({ geometry, stroke }, {}, styles)
  assert.deepEqual(good({ color: 'ink', width: 0 }), [])
  assert.deepEqual(
    good({ color: { style: 'sun' }, width: 200, dash: [4, 2] }),
    [],
  )
  for (const stroke of [
    { color: 'ink', width: 201 },
    { color: 'ink', width: -1 },
    { color: 'ink' },
    { width: 2 },
    { color: 'nope', width: 2 },
    { color: 'ink', width: 2, dash: [1] },
    { color: 'ink', width: 2, dash: [1, -1] },
  ])
    assert.deepEqual(
      good(stroke).map(p => p.path),
      ['props.stroke'],
      JSON.stringify(stroke),
    )
  for (const opacity of [0, 0.5, 1])
    assert.deepEqual(probs({ geometry, opacity }), [])
  for (const opacity of [-0.01, 1.01, '1'])
    assert.deepEqual(paths({ geometry, opacity }), ['props.opacity'])
})

test('a shadow that names no site shadow is refused; one that does is accepted', () => {
  const geometry = { type: 'ellipse' }
  assert.deepEqual(probs({ geometry, shadow: 'soft' }), [])
  assert.deepEqual(paths({ geometry, shadow: 'huge' }), ['props.shadow'])
  assert.deepEqual(paths({ geometry, shadow: '");}</style>' }), [
    'props.shadow',
  ])
})

test('a raw #colour fill is accepted with no problem and no note', () => {
  assert.deepEqual(
    probs({
      geometry: { type: 'rect' },
      fill: '#123456',
      stroke: { color: '#654321', width: 1 },
    }),
    [],
  )
})

test('a shape sits only where shapes may hold shapes; label and fit are checked', () => {
  const g = { type: 'group' }
  const part = n({
    id: 'p',
    kind: 'shape',
    name: 'P',
    slot: { x: 0, y: 0, w: 50, h: 50 },
    props: { geometry: { type: 'ellipse' } },
  })
  assert.deepEqual(
    validateSite(site(col(shape({ geometry: g }, { children: [part] }))), reg),
    [],
  )
  for (const slot of [
    {},
    { x: 0, y: 0, w: 0, h: 5 },
    { x: 0, y: 0, w: 5, h: 5, z: 1 },
  ])
    assert.ok(
      validateSite(
        site(col(shape({ geometry: g }, { children: [{ ...part, slot }] }))),
        reg,
      ).some(p => p.path === 'slot'),
    )
  // a shape cannot hold other kinds, and cannot be the top of a page
  const t = n({ id: 't', kind: 'divider', name: 'D', slot: {} })
  assert.ok(
    validateSite(site(col(shape({ geometry: g }, { children: [t] }))), reg)
      .length,
  )
  assert.ok(validateSite(site(shape({ geometry: g })), reg).length)
  const kids = kidsFor(g)
  const ps = (props: object) => probs(props, kids).map(p => p.path)
  assert.deepEqual(ps({ geometry: g, label: 'x'.repeat(121) }), ['props.label'])
  assert.deepEqual(ps({ geometry: g, fit: 'zoom' }), ['props.fit'])
  assert.deepEqual(
    probs({ geometry: g, label: 'x'.repeat(120), fit: 'cover' }, kids),
    [],
  )
  assert.deepEqual(ps({ geometry: g, tip: 'hi' }), ['props.tip'])
})

test('dropSamples drops a block that holds only a sample text and a shape', () => {
  const sample = n({
    id: 'a',
    kind: 'text',
    name: 'A',
    slot: {},
    props: { level: 'p', runs: [{ text: 'Write here' }], sample: true },
  })
  const dressed = n({
    id: 'b',
    kind: 'column',
    name: 'B',
    slot: {},
    children: [sample, shape({ geometry: { type: 'ellipse' } })],
  })
  const owned = n({
    id: 'c',
    kind: 'text',
    name: 'C',
    slot: {},
    props: { level: 'p', runs: [{ text: 'Mine' }], sample: false },
  })
  const kept = n({
    id: 'k',
    kind: 'column',
    name: 'K',
    slot: {},
    children: [owned],
  })
  const root = n({
    id: 'r',
    kind: 'column',
    name: 'R',
    slot: {},
    children: [dressed, kept],
  })
  assert.deepEqual(
    dropSamples(root).children!.map(c => c.id),
    ['k'],
  )
})

// ---- composition rules ----

const cpart = (
  id: string,
  more: object = {},
  geometry: object = { type: 'ellipse' },
): Node =>
  n({
    id,
    kind: 'shape',
    name: id,
    slot: { x: 0, y: 0, w: 10, h: 10 },
    props: { geometry },
    ...more,
  })
const grp = (kids: Node[], id = 's', more: object = {}): Node =>
  shape({ geometry: { type: 'group' } }, { id, children: kids, ...more })
const check = (w: Node) => validateSite(site(col(w)), reg)

test('a group needs 1 to 32 shapes; a rect with a child is refused; 33 children are refused', () => {
  assert.deepEqual(check(grp([cpart('a')])), [])
  assert.deepEqual(
    check(grp(Array.from({ length: 32 }, (_, i) => cpart(`c${i}`)))),
    [],
  )
  assert.ok(check(grp([])).some(p => p.path === 'children'))
  assert.ok(
    check(grp(Array.from({ length: 33 }, (_, i) => cpart(`c${i}`)))).some(
      p => p.path === 'children',
    ),
  )
  const rect = shape({ geometry: { type: 'rect' } }, { children: [cpart('a')] })
  assert.ok(check(rect).some(p => p.path === 'children'))
})

test('shapes 5 deep are refused at the fifth', () => {
  const g = (id: string, kids: Node[]) =>
    cpart(id, { children: kids }, { type: 'group' })
  // `levels` shapes one inside the next, the top one included
  const deep = (levels: number): Node => {
    let inner: Node = cpart('leaf')
    for (let i = levels - 2; i >= 1; i--) inner = g(`g${i}`, [inner])
    return grp([inner], 'top')
  }
  assert.deepEqual(check(deep(4)), [])
  const bad = check(deep(5))
  assert.equal(bad.length, 1)
  assert.equal(bad[0]!.path, 'children')
})

test('a child shape slot is { x, y, w, h }; a style or placement on a child is refused', () => {
  for (const slot of [
    { x: 0, y: 0, w: 5, h: 5, z: 1 },
    { x: 0, y: 0, w: 5 },
    {},
  ])
    assert.ok(check(grp([cpart('a', { slot })])).some(p => p.path === 'slot'))
  assert.ok(
    check(grp([cpart('a', { style: { base: { opacity: 0.5 } } })])).some(
      p => p.path === 'style',
    ),
  )
  assert.ok(
    check(grp([cpart('a', { placement: { default: 'behind' } })])).some(
      p => p.path === 'placement',
    ),
  )
})
