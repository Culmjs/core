import test from 'node:test'
import assert from 'node:assert/strict'
import { createRegistry, emptySite } from '@culmjs/core'
import starter, { LOOK, STYLES } from '@culmjs/starter'
import { buildWrite, diagnose } from '../../src/jsx/write.ts'

type Obj = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const registry = createRegistry()
registry.use(starter)
const doc = { ...emptySite('Ada', LOOK), styles: STYLES }

/** Writes one element to a page of the empty site; core must accept the result. */
function one(jsx: string, page = 'home') {
  const b = buildWrite(doc, registry, { page, jsx })
  assert.ok(b.ok, JSON.stringify(!b.ok && b.problems))
  const found = diagnose(b, doc, registry)
  assert.deepEqual(found, [], JSON.stringify(found))
  const add = b.ops.find(o => o.op === 'add')!.node as Obj
  return { node: add, ops: b.ops, warnings: b.warnings.map(w => w.message) }
}

// CSS authoring inputs and their normalized document values.
const VALUES: [string, string, Obj][] = [
  ['width "100%"', '<Column style={{ width: "100%" }} />', { width: 'fill' }],
  [
    'width "20%"',
    '<Column style={{ width: "20%" }} />',
    { width: { n: 20, unit: '%' } },
  ],
  [
    'width "40%"',
    '<Column style={{ width: "40%" }} />',
    { width: { n: 40, unit: '%' } },
  ],
  [
    'width "560px"',
    '<Column style={{ width: "560px" }} />',
    { width: { n: 560, unit: 'px' } },
  ],
  [
    'width 1',
    '<Column style={{ width: 1 }} />',
    { width: { n: 1, unit: 'px' } },
  ],
  [
    'maxWidth "1.5rem"',
    '<Column style={{ maxWidth: "1.5rem" }} />',
    { maxWidth: { n: 24, unit: 'px' } },
  ],
  [
    'maxWidth "2em"',
    '<Column style={{ maxWidth: "2em" }} />',
    { maxWidth: { n: 32, unit: 'px' } },
  ],
  ['width "auto"', '<Column style={{ width: "auto" }} />', { width: 'fit' }],
  [
    'height 274',
    '<Column style={{ height: 274 }} />',
    { height: { n: 274, unit: 'px' } },
  ],
  [
    'phone height "fill"',
    '<Column phone={{ height: "fill" }} />',
    { phone: { height: 'fill' } },
  ],
  [
    'height "100vh"',
    '<Column style={{ height: "100vh" }} />',
    { height: { n: 100, unit: 'vh' } },
  ],
  ['padding "24px"', '<Column style={{ padding: "24px" }} />', { padding: 24 }],
  [
    'padding "8px 16px"',
    '<Column style={{ padding: "8px 16px" }} />',
    { padding: [8, 16, 8, 16] },
  ],
  [
    'padding [10, 20]',
    '<Column style={{ padding: [10, 20] }} />',
    { padding: [10, 20, 10, 20] },
  ],
  ['gap "1.5rem"', '<Column style={{ gap: "1.5rem" }} />', { gap: 24 }],
  [
    'radius "50%"',
    '<Column style={{ radius: "50%" }} />',
    { radius: { n: 50, unit: '%' } },
  ],
  [
    'radius "9999px"',
    '<Column style={{ radius: "9999px" }} />',
    { radius: 999 },
  ],
  [
    'inset [28,0,0,15]',
    '<Column style={{ inset: [28, 0, 0, 15] }} />',
    {
      inset: {
        top: { n: 28, unit: 'px' },
        right: { n: 0, unit: 'px' },
        bottom: { n: 0, unit: 'px' },
        left: { n: 15, unit: 'px' },
      },
    },
  ],
  ['shadow "sm"', '<Column style={{ shadow: "sm" }} />', { shadow: 'soft' }],
  ['shadow "md"', '<Column style={{ shadow: "md" }} />', { shadow: 'soft' }],
  [
    'shadow "card"',
    '<Column style={{ shadow: "card" }} />',
    { shadow: 'soft' },
  ],
  ['shadow "lg"', '<Column style={{ shadow: "lg" }} />', { shadow: 'strong' }],
  [
    'shadow CSS string',
    '<Column style={{ shadow: "0 4px 5px #adb5bd" }} />',
    {
      shadow: { x: 0, y: 4, blur: 5, spread: 0, color: '#adb5bd' },
    },
  ],
  [
    'shadow with rgba and spread',
    '<Column style={{ shadow: "0 10px 30px -5px rgba(0,0,0,0.2)" }} />',
    {
      shadow: { x: 0, y: 10, blur: 30, spread: -5, color: '#00000033' },
    },
  ],
  [
    'letterSpacing 1 (px)',
    '<Text level="p" style={{ size: 13, letterSpacing: 1 }}>a</Text>',
    { size: 13, letterSpacing: 0.077 },
  ],
  [
    'letterSpacing -0.6 (px)',
    '<Text level="p" style={{ size: 24, letterSpacing: -0.6 }}>a</Text>',
    { size: 24, letterSpacing: -0.025 },
  ],
  [
    'letterSpacing "0.05em"',
    '<Text level="p" style={{ letterSpacing: "0.05em" }}>a</Text>',
    { letterSpacing: 0.05 },
  ],
  [
    'letterSpacing 0.05 (em)',
    '<Text level="p" style={{ letterSpacing: 0.05 }}>a</Text>',
    { letterSpacing: 0.05 },
  ],
  [
    'color "#ccc"',
    '<Text level="p" style={{ color: "#ccc" }}>a</Text>',
    { color: '#cccccc' },
  ],
  [
    'color rgb',
    '<Text level="p" style={{ color: "rgb(255, 0, 0)" }}>a</Text>',
    { color: '#ff0000' },
  ],
  [
    'color rgba',
    '<Text level="p" style={{ color: "rgba(255,0,0,0.5)" }}>a</Text>',
    { color: '#ff000080' },
  ],
  [
    'color name',
    '<Text level="p" style={{ color: "tomato" }}>a</Text>',
    { color: '#ff6347' },
  ],
  [
    'color hsl',
    '<Text level="p" style={{ color: "hsl(0, 100%, 50%)" }}>a</Text>',
    { color: '#ff0000' },
  ],
  [
    'color transparent',
    '<Text level="p" style={{ bg: "transparent" }}>a</Text>',
    { bg: '#00000000' },
  ],
  [
    'size 10 (site range 11 to 96)',
    '<Text level="p" style={{ size: 10 }}>a</Text>',
    { size: 11 },
  ],
  [
    'size 120 (site range 11 to 96)',
    '<Text level="p" style={{ size: 120 }}>a</Text>',
    { size: 96 },
  ],
  [
    'size "1.5rem"',
    '<Text level="p" style={{ size: "1.5rem" }}>a</Text>',
    { size: 24 },
  ],
  [
    'weight "bold"',
    '<Text level="p" style={{ weight: "bold" }}>a</Text>',
    { weight: 700 },
  ],
  [
    'weight 450',
    '<Text level="p" style={{ weight: 450 }}>a</Text>',
    { weight: 500 },
  ],
  [
    'lineHeight "150%"',
    '<Text level="p" style={{ lineHeight: "150%" }}>a</Text>',
    { lineHeight: 1.5 },
  ],
  [
    'lineHeight 24 (px)',
    '<Text level="p" style={{ size: 16, lineHeight: 24 }}>a</Text>',
    { size: 16, lineHeight: 1.5 },
  ],
  [
    'justify "space-between" on a row',
    '<Row style={{ justify: "space-between" }} />',
    { justify: 'between' },
  ],
  [
    'CSS names',
    '<Row style={{ justifyContent: "flex-start", alignItems: "center", backgroundColor: "#fff", borderRadius: 8, fontSize: 20 }} />',
    {
      justify: 'start',
      align: 'center',
      bg: '#fff'.length === 4 ? '#ffffff' : '',
      radius: 8,
      size: 20,
    },
  ],
  [
    'border CSS string',
    '<Column style={{ border: "1px solid #ddd" }} />',
    { border: { width: 1, style: 'solid', color: '#dddddd' } },
  ],
  [
    'margin "0 auto"',
    '<Column style={{ margin: "0 auto" }} />',
    { margin: 0, place: 'center' },
  ],
  [
    'border object with a short hex',
    '<Column style={{ border: { width: 1, color: "#d2d2d2" } }} />',
    { border: { width: 1, color: '#d2d2d2' } },
  ],
]
for (const [label, jsx, want] of VALUES)
  test(`CSS value ${label} is accepted as ${JSON.stringify(want)}`, () => {
    const st = (
      jsx.includes('phone=') ? one(jsx).node.style : one(jsx).node.style.base
    ) as Obj
    for (const [k, v] of Object.entries(want))
      assert.deepEqual(st[k], v, `${k}: ${JSON.stringify(st)}`)
  })

test('a font-family name is fetched as a Google font and written as up:<name>; a stack and google: both work; a generic family is a system font', () => {
  const r = one(
    '<Text level="p" style={{ font: "google:Bebas Neue", weight: 800 }}>a</Text><Text level="p" style={{ font: "\'Abril Fatface\', sans-serif" }}>b</Text><Text level="p" style={{ font: "Arial, sans-serif" }}>c</Text>',
  )
  const fonts = r.ops.find(o => o.op === 'setFonts')!.fonts as unknown[]
  assert.deepEqual(fonts.slice(0, 1), ['sys:sans'])
  assert.deepEqual(fonts.slice(1), [
    { google: 'Bebas Neue', weights: [400, 700, 800] },
    { google: 'Abril Fatface', weights: [400, 700] },
  ])
  const b = buildWrite(doc, registry, {
    page: 'home',
    jsx: '<Text level="p" style={{ font: "google:Bebas Neue" }}>a</Text><Text level="p" style={{ font: "Abril Fatface, serif" }}>b</Text><Text level="p" style={{ font: "Arial" }}>c</Text><Text level="p" style={{ font: "Open Sans" }}>d</Text>',
  })
  assert.ok(b.ok)
  const adds = b.ops
    .filter(o => o.op === 'add')
    .map(o => (o.node as Obj).style.base.font)
  // a family of the built-in catalogue needs no fetch: cat:<name>
  assert.deepEqual(adds, [
    'up:bebas-neue',
    'up:abril-fatface',
    'sys:sans',
    'cat:open-sans',
  ])
  // a renamed family is mapped, with a warning
  const old = one(
    '<Text level="p" style={{ font: "Source Sans Pro" }}>a</Text>',
  )
  assert.match(old.warnings.join('\n'), /renamed; using "Source Sans 3"/)
})

test('a setting that does not apply is mapped to the closest equivalent, or dropped, with a warning with path, line and column', () => {
  // justify on a Box: a Box does not lay out, so it becomes a Column
  const box = one(
    '<Box style={{ justify: "center", align: "center", width: 50 }}><Text level="p">x</Text></Box>',
  )
  assert.equal(box.node.kind, 'column')
  assert.equal(box.node.style.base.justify, 'center')
  assert.match(
    box.warnings[0]!,
    /Box\[0\]: a Box does not align its children; made it a Column/,
  )
  // align on a Grid has no equivalent: dropped
  const grid = one(
    '<Grid cols={2} style={{ align: "center", gap: 8 }}><Text level="p">x</Text></Grid>',
  )
  assert.deepEqual(grid.node.style.base, { gap: 8 })
  assert.match(grid.warnings.join(), /align does not apply to a grid; dropped/)
  // bg on a Shape is its fill
  const shape = one(
    '<Shape geometry={{ type: "rect", radius: 5 }} style={{ bg: "#cccccc", radius: 5 }} />',
  )
  assert.equal(shape.node.props.fill, '#cccccc')
  assert.equal(shape.node.style?.base?.bg, undefined)
  // color on a Divider is its line
  const hr = one('<Divider style={{ color: "#eeeeee" }} />')
  assert.deepEqual(hr.node.style.base.border, { width: 1, color: '#eeeeee' })
  // span on a cell and the setting written as a style
  const cell = one('<Grid cols={2}><Column style={{ span: 2 }} /></Grid>')
  assert.deepEqual((cell.node.children[0] as Obj).slot, { cols: 2 })
  // an attribute that is not a setting is dropped; one that is a style moves to style
  const attr = one(
    '<Form><Field type="email" placeholder="Email" bogus="x" /></Form>',
  )
  assert.equal((attr.node.children as Obj[])[0]!.props.name, 'email')
  assert.match(
    attr.warnings.join(),
    /type="email" is not a setting of <Field>; set name="email"/,
  )
  assert.match(
    attr.warnings.join(),
    /"bogus" is not a setting of <Field>.*dropped/,
  )
  const moved = one('<Column width="50%" />')
  assert.deepEqual(moved.node.style.base.width, { n: 50, unit: '%' })
  // warnings carry the place
  const b = buildWrite(doc, registry, {
    page: 'home',
    jsx: '<Column>\n  <Divider style={{ color: "#eee" }} />\n</Column>',
  })
  assert.ok(b.ok)
  assert.deepEqual(b.warnings[0]!.jsx, {
    path: 'Column[0] > Divider[0]',
    line: 2,
    column: 3,
  })
})

test('what is truly unsafe or unparseable is still refused: code, a syntax error, an unknown element, a missing node', () => {
  for (const jsx of [
    '<Text level="p" onClick="alert(1)">a</Text>',
    '<Text level="p">{foo()}</Text>',
    '<Row><Text',
    '<Blorp />',
  ]) {
    const b = buildWrite(doc, registry, { page: 'home', jsx })
    const refused = !b.ok || diagnose(b, doc, registry).length > 0
    assert.ok(refused, jsx)
  }
  const b = buildWrite(doc, registry, {
    page: 'home',
    jsx: '<Text level="p" onClick="alert(1)">a</Text>',
  })
  assert.ok(b.ok)
  assert.match(b.errors[0]!.message, /would run code/)
})

test('HTML-style element names map to Culm elements with a warning', () => {
  const r = one(
    '<Div style={{ gap: 8 }}><H1>Hi</H1><P>there</P><Img src="https://x.test/a.png" alt="a" /></Div>',
  )
  assert.equal(r.node.kind, 'column')
  assert.deepEqual(
    (r.node.children as Obj[]).map(c => c.kind),
    ['text', 'text', 'image'],
  )
  assert.equal((r.node.children as Obj[])[0]!.props.level, 'h1')
  assert.match(r.warnings[0]!, /<Div> is not a Culm element; used as <Column>/)
})
