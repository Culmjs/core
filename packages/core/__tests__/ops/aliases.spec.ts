import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Node, SiteDocument } from '../../src/document/index.ts'
import { aliasStyles } from '../../src/ops/aliases.ts'
import { checkStyle } from '../../src/style/decl.ts'
import { node as mk, siteWith, text } from '../kit.ts'

const node = (id: string, kind: Node['kind'], _c: Node[], more: object): Node =>
  ({ ...mk(id, kind), ...more }) as Node

const st = (style: object, id = 't') =>
  text(id, 'Hi', { style: style as Node['style'] })
const first = (d: SiteDocument) => d.pages[0].root.children![0]

test('align center, left and right on a text become textAlign center, start and end; on a row align stays align', () => {
  for (const [from, to] of [
    ['center', 'center'],
    ['left', 'start'],
    ['right', 'end'],
  ])
    assert.deepEqual(
      first(aliasStyles(siteWith([st({ base: { align: from } })]))).style,
      { base: { textAlign: to } },
    )
  const row = node('r', 'row', [], { style: { base: { align: 'center' } } })
  assert.deepEqual(first(aliasStyles(siteWith([row]))).style, {
    base: { align: 'center' },
  })
})

test('a text with align center and textAlign end keeps textAlign end and loses align', () => {
  assert.deepEqual(
    first(
      aliasStyles(
        siteWith([st({ base: { align: 'center', textAlign: 'end' } })]),
      ),
    ).style,
    { base: { textAlign: 'end' } },
  )
})

test('align stretch on a text is left as written', () => {
  const d = siteWith([st({ base: { align: 'stretch' } })])
  assert.equal(aliasStyles(d), d)
})

test('justify space-between and space-around become between and around', () => {
  const d = aliasStyles(
    siteWith([
      node('a', 'row', [], { style: { base: { justify: 'space-between' } } }),
      node('b', 'row', [], { style: { base: { justify: 'space-around' } } }),
    ]),
  )
  assert.deepEqual(
    d.pages[0].root.children!.map(c => c.style),
    [{ base: { justify: 'between' } }, { base: { justify: 'around' } }],
  )
})

test('textAlign left and right on a button become start and end', () => {
  const b = (v: string) =>
    node('b' + v, 'button', [], { style: { base: { textAlign: v } } })
  const d = aliasStyles(siteWith([b('left'), b('right')]))
  assert.deepEqual(
    d.pages[0].root.children!.map(c => c.style),
    [{ base: { textAlign: 'start' } }, { base: { textAlign: 'end' } }],
  )
})

test('the rewrite reaches phone and dark layers, when decls, header, footer and component masters', () => {
  const s = {
    phone: { align: 'left' },
    dark: { align: 'right' },
    when: [{ state: 'x', is: 'y', decl: { align: 'center' } }],
  }
  const want = {
    phone: { textAlign: 'start' },
    dark: { textAlign: 'end' },
    when: [{ state: 'x', is: 'y', decl: { textAlign: 'center' } }],
  }
  const d0 = siteWith([st(s)])
  const d = aliasStyles({
    ...d0,
    header: { ...d0.header, children: [st(s, 'h')] },
    footer: { ...d0.footer, children: [st(s, 'f')] },
    components: [
      { id: 'c', name: 'C', props: [], variants: [], root: st(s, 'cr') },
    ],
  })
  assert.deepEqual(first(d).style, want)
  assert.deepEqual(d.header.children![0].style, want)
  assert.deepEqual(d.footer.children![0].style, want)
  assert.deepEqual(d.components[0].root.style, want)
  // never mutated
  assert.deepEqual(first(d0).style, s)
})

test('a document with no alias comes back as the same object', () => {
  const d = siteWith([st({ base: { textAlign: 'center' } })])
  assert.equal(aliasStyles(d), d)
})

const shape = (geometry: object, style: object): Node =>
  ({
    ...mk('sh', 'shape'),
    props: { geometry },
    style: style as Node['style'],
  }) as Node

test('radius 12 and [4,4,0,0] on a rect shape move to props.geometry.radius', () => {
  for (const r of [12, [4, 4, 0, 0]]) {
    const n = first(
      aliasStyles(siteWith([shape({ type: 'rect' }, { base: { radius: r } })])),
    )
    assert.deepEqual(n.props!.geometry, { type: 'rect', radius: r })
    assert.deepEqual(n.style, { base: {} })
  }
})

test('radius on an ellipse shape, and on a rect shape in its phone layer, stay and are refused with the geometry sentence', () => {
  for (const [g, s] of [
    [{ type: 'ellipse' }, { base: { radius: 8 } }],
    [{ type: 'rect' }, { phone: { radius: 8 } }],
  ] as const) {
    const n = first(aliasStyles(siteWith([shape(g, s)])))
    assert.deepEqual(n.style, s)
    assert.match(
      checkStyle('shape', n.style).problems.join(),
      /a rect shape takes props\.geometry\.radius/,
    )
  }
})

test('display none at phone becomes hidden true; display flex at phone becomes hidden false', () => {
  const a = first(aliasStyles(siteWith([st({ phone: { display: 'none' } })])))
  assert.deepEqual(a.style, { phone: { hidden: true } })
  const b = first(aliasStyles(siteWith([st({ phone: { display: 'flex' } })])))
  assert.deepEqual(b.style, { phone: { hidden: false } })
})

test('display grid with hidden true in one layer keeps hidden true', () => {
  const d = first(
    aliasStyles(siteWith([st({ base: { display: 'grid', hidden: true } })])),
  )
  assert.deepEqual(d.style, { base: { hidden: true } })
})
