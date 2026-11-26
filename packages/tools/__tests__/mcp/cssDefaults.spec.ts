import test from 'node:test'
import assert from 'node:assert/strict'
import { createRegistry, emptySite, type SiteDocument } from '@culmjs/core'
import { compilePage } from '@culmjs/core/compile'
import { plan } from '@culmjs/core/ops'
import starter, { LOOK, STYLES } from '@culmjs/starter'
import { buildWrite } from '../../src/jsx/write.ts'
import { JsxError, parseJsx } from '../../src/jsx/parse.ts'

const registry = createRegistry()
registry.use(starter)
const site = (): SiteDocument => ({
  ...emptySite('Ada', LOOK),
  styles: STYLES,
})
const build = (jsx: string, page = 'home', doc = site()) => {
  const b = buildWrite(doc, registry, { page, jsx })
  assert.ok(b.ok, b.ok ? '' : JSON.stringify(b.problems))
  assert.deepEqual(b.errors, [])
  return b
}
const css = (jsx: string) => {
  const doc = site()
  const b = build(jsx, 'home', doc)
  const r = plan(doc, registry, {
    site: 's',
    baseRevision: 0,
    key: 'k',
    ops: b.ops as never,
  })
  assert.ok(r.ok, r.ok ? '' : JSON.stringify(r.problems))
  const out = compilePage(r.doc, 'home', {
    registry,
    mode: 'measure',
    links: { page: s => s, file: id => `/a/${id}` },
  })
  assert.ok(out.ok)
  return out.html
}

test('a Google family is fetched at every weight the JSX and the site styles use', () => {
  const b = build(
    `<Site fonts={{body:"google:Open Sans"}} /><Text style={{weight:300}}>a</Text><Text style={{weight:100}} phone={{weight:600}}>b</Text>`,
  )
  const fonts = b.ops.find(o => o.op === 'setFonts')!.fonts as {
    google: string
    weights: number[]
  }[]
  assert.deepEqual(fonts[0]!.weights, [100, 300, 400, 600, 700])
})

test('the first write makes the starter background white; a look the author gives is kept', () => {
  const a = build(`<Text>a</Text>`)
  assert.equal(
    (a.ops.find(o => o.op === 'setLook') as { look: { bg: string } }).look.bg,
    '#ffffff',
  )
  const b = build(`<Site look={{bg:"#111111",ink:"#ffffff"}} /><Text>a</Text>`)
  const looks = b.ops.filter(o => o.op === 'setLook')
  assert.equal(looks.length, 1)
  assert.equal((looks[0] as { look: { bg: string } }).look.bg, '#111111')
})

test('a write to the header takes padding, rule and centring off the starter root', () => {
  const doc = site()
  doc.header.style = {
    base: { padding: [16, 16, 16, 16], align: 'center', width: 'fill' },
    phone: { padding: [8, 8, 8, 8] },
  } as never
  const b = build(`<Row id="x" />`, 'header', doc)
  const ops = b.ops.filter(
    o => o.op === 'setStyle' && o.id === doc.header.id,
  ) as { layer: string; decl: Record<string, null> }[]
  assert.deepEqual(
    ops.map(o => [o.layer, Object.keys(o.decl).sort()]),
    [
      ['base', ['align', 'padding']],
      ['phone', ['padding']],
    ],
  )
  assert.ok(ops.every(o => Object.values(o.decl).every(v => v === null)))
})

test('under centreMaxWidth: an unset slot align writes none, an explicit one does; a row does not fold; a button centres its label; a Field has a placeholder', () => {
  const html = css(
    `<Column style={{align:"center"}}>` +
      `<Text id="t1" style={{maxWidth:{n:300,unit:"px"}}}>a</Text>` +
      `<Text id="t2" slot={{align:"start"}}>b</Text>` +
      `<Row id="r"><Text>c</Text></Row>` +
      `<Button label="Go" style={{width:"fill"}} />` +
      `<Form><Field name="email" label="E" placeholder="you@x.com" /></Form>` +
      `</Column>`,
  )
  assert.ok(!html.includes('align-self:stretch'))
  assert.ok(html.includes('align-self:start'))
  assert.match(html, /\.c\w+\{[^}]*justify-content:center/)
  assert.match(html, /placeholder="you@x\.com"/)
  // the phone media block holds no folded row
  assert.ok(
    !/@media \(max-width: 600px\)\{[^@]*flex-direction:column/.test(html),
  )
})

test('without the flag nothing changes: a stretch slot still writes align-self and a row still folds', () => {
  const doc = site()
  const b = build(`<Column><Row><Text>c</Text></Row></Column>`, 'home', doc)
  const ops = b.ops.filter(o => o.op !== 'setSite')
  const r = plan(doc, registry, {
    site: 's',
    baseRevision: 0,
    key: 'k',
    ops: ops as never,
  })
  assert.ok(r.ok, r.ok ? '' : JSON.stringify(r.problems))
  assert.equal(r.doc.centreMaxWidth, undefined)
  const out = compilePage(r.doc, 'home', {
    registry,
    mode: 'measure',
    links: { page: s => s, file: id => `/a/${id}` },
  })
  assert.ok(out.ok)
  assert.match(out.html, /align-self:stretch/)
  assert.match(
    out.html,
    /@media \(max-width: 600px\)\{[^@]*flex-direction:column/,
  )
})

test('font weight requests use the heading or body family according to the text role', () => {
  const b = build(
    `<Site fonts={{heading:"google:Roboto Slab",body:"google:Lora"}} /><Text level="h1" style={{weight:100}}>a</Text><Text style={{weight:300}}>b</Text>`,
  )
  const fonts = b.ops.find(o => o.op === 'setFonts')!.fonts as {
    google: string
    weights: number[]
  }[]
  const of = (g: string) => fonts.find(f => f.google === g)!.weights
  assert.ok(of('Roboto Slab').includes(100))
  assert.ok(!of('Roboto Slab').includes(300))
  assert.ok(of('Lora').includes(300))
  assert.ok(!of('Lora').includes(100))
})

test('the first write on a fresh site uses a white canvas', async () => {
  const { readFile } = await import('node:fs/promises')
  const j = JSON.parse(
    (
      await readFile(
        new URL('../../../starter/template/site.json', import.meta.url),
        'utf8',
      )
    ).replace(/^\s*\/\/.*$/gm, ''),
  )
  assert.equal(j.centreMaxWidth, true)
  assert.equal(j.look.bg, '#fafaf9')
  const doc = site()
  doc.centreMaxWidth = true
  doc.look = j.look
  const b = build(`<Text>a</Text>`, 'home', doc)
  assert.equal(
    (b.ops.find(o => o.op === 'setLook') as { look: { bg: string } }).look.bg,
    '#ffffff',
  )
})

test('menu links inherit their colour, fields stay accessible and a folded row sizes children to content', () => {
  const html = css(
    `<Column>` +
      `<Menu which="menu" />` +
      `<Form><Row><Field name="name" placeholder="Name" /><Field name="email" label="Mail" /></Row></Form>` +
      `<Row phone={{direction:"column"}}><Box slot={{grow:1}} style={{height:{n:300,unit:"px"}}} /></Row>` +
      `</Column>`,
  )
  assert.match(html, /a\{color:inherit\}/)
  assert.match(html, /a\[aria-current=page\]\{text-decoration:none\}/)
  assert.match(html, /<input[^>]*aria-label="Name"/)
  assert.ok(!/<label[^>]*>Name</.test(html))
  assert.match(html, /<label[^>]*>Mail/)
  assert.match(html, /@media \(max-width: 600px\)\{[^@]*flex-basis:auto/)
  const doc = site()
  const b = buildWrite(doc, registry, {
    page: 'home',
    jsx: `<Row><Field name="name" /></Row>`,
  })
  assert.ok(b.ok)
  const r = plan(doc, registry, {
    site: 's',
    baseRevision: 0,
    key: 'k',
    ops: b.ops as never,
  })
  assert.ok(!r.ok)
  assert.match(JSON.stringify(r.problems), /inside a form/)
})

test('inline text marks become runs and compile to links and styled spans', () => {
  const doc = site()
  const jsx = `<Text id="t">Hi <b>there</b> <a href="https://x.com" style={{underline:true}}>link</a> <span style={{color:"#ff0000",weight:300}}>red</span>{" "}<i>it</i> <u>u</u><br />end</Text>`
  const b = build(jsx, 'home', doc)
  const add = b.ops.find(o => o.op === 'add') as {
    node: { props: { runs: unknown[] } }
  }
  assert.deepEqual(add.node.props.runs, [
    { text: 'Hi ' },
    { text: 'there', style: { weight: 700 } },
    { text: ' ' },
    {
      text: 'link',
      style: { underline: true },
      link: { url: 'https://x.com' },
    },
    { text: ' ' },
    { text: 'red', style: { color: '#ff0000', weight: 300 } },
    { text: ' ' },
    { text: 'it', style: { italic: true } },
    { text: ' ' },
    { text: 'u', style: { underline: true } },
    { br: true },
    { text: 'end' },
  ])
  const html = css(jsx)
  assert.match(html, /<a [^>]*href="https:\/\/x\.com"[^>]*>link<\/a>/)
  assert.match(html, /<span class="c\w+">there<\/span>/)
  assert.match(html, /font-weight:700/)
  assert.match(html, /color:#ff0000/)
})

test('unsupported or misplaced text marks are refused with a source location', () => {
  const bad = (src: string, re: RegExp) => {
    assert.throws(
      () => parseJsx(src),
      (e: unknown) => {
        assert.ok(e instanceof JsxError)
        assert.match(e.message, re)
        assert.ok(e.at.line >= 1)
        return true
      },
    )
  }
  bad('<Text>a <div>b</div></Text>', /not a mark/)
  bad('<Text>a <a>b</a></Text>', /href/)
  bad('<Text>a <b onclick="x">b</b></Text>', /takes style/)
  bad('<Text>a <b><Row /></b></Text>', /holds words/)
  bad('<Text>a <b>b</Text>', /Expected <\/b>/)
  const b = buildWrite(site(), registry, {
    page: 'home',
    jsx: '<Button>a <b>b</b></Button>',
  })
  assert.ok(b.ok)
  assert.match(JSON.stringify(b.errors), /no line break or marks/)
})

test('the weight of a mark is fetched with the font', () => {
  const b = build(
    `<Site fonts={{body:"google:Lora"}} /><Text>a <span style={{weight:300}}>b</span></Text>`,
  )
  const fonts = b.ops.find(o => o.op === 'setFonts')!.fonts as {
    weights: number[]
  }[]
  assert.ok(fonts[0]!.weights.includes(300))
})

test('the centreMaxWidth setting centres a lone capped row child and controls word wrapping', () => {
  const jsx =
    `<Row id="o"><Row id="i" style={{width:"fill",maxWidth:{n:600,unit:"px"}}}><Text>a</Text></Row></Row>` +
    `<Row id="p"><Row id="q" style={{maxWidth:{n:600,unit:"px"}}}><Text>a</Text></Row><Text>b</Text></Row>`
  const html = css(jsx)
  assert.equal((html.match(/margin-inline:auto/g) ?? []).length, 1)
  assert.match(html, /overflow-wrap:normal;word-break:normal;hyphens:manual/)
  const doc = site()
  const b = build(jsx, 'home', doc)
  const r = plan(doc, registry, {
    site: 's',
    baseRevision: 0,
    key: 'k',
    ops: b.ops.filter(o => o.op !== 'setSite') as never,
  })
  assert.ok(r.ok)
  const out = compilePage(r.doc, 'home', {
    registry,
    mode: 'measure',
    links: { page: s => s, file: id => `/a/${id}` },
  })
  assert.ok(out.ok)
  assert.ok(!out.html.includes('margin-inline:auto'))
  assert.ok(!out.html.includes('overflow-wrap:break-word'))
})

test('divide draws lines between grid, row and list items only when requested', () => {
  const html = css(
    `<Grid id="g" cols={3} tabletCols={2} phoneCols={1} divide><Text>a</Text><Text>b</Text></Grid>` +
      `<Row divide><Text>a</Text><Text>b</Text></Row>` +
      `<Column divide><Text>a</Text><Text>b</Text></Column>` +
      `<Grid cols={2}><Text>a</Text></Grid>`,
  )
  assert.match(
    html,
    /:nth-child\(n\+4 of :not\(\[data-cm-m\]\)\)\{border-top-width:1px\}/,
  )
  assert.match(
    html,
    /:not\(:nth-child\(3n\+1 of :not\(\[data-cm-m\]\)\)\)\{border-inline-start-width:1px\}/,
  )
  assert.match(
    html,
    /@media \(max-width:1024px\)\{[^@]*:nth-child\(n\+3 of :not\(\[data-cm-m\]\)\)/,
  )
  assert.match(
    html,
    /@media \(max-width:600px\)\{[^@]*:nth-child\(n\+2 of :not\(\[data-cm-m\]\)\)\{border-top-width:1px\}/,
  )
  assert.match(
    html,
    /\.c\w+>:not\(\[data-cm-m\]\)\+:not\(\[data-cm-m\]\)\{border-inline-start-width:1px\}/,
  )
  assert.match(
    html,
    /\.c\w+>:not\(\[data-cm-m\]\)\+:not\(\[data-cm-m\]\)\{border-top-width:1px\}/,
  )
  assert.equal((html.match(/solid var\(--s-line\)/g) ?? []).length, 3)
})

test('a folded menu keeps its link gap and toggle style; shadow and radius reach an image', () => {
  const html = css(
    `<Menu which="menu" foldOn="phone" toggle="box" style={{gap:64}} />` +
      `<Menu which="menu" foldOn="phone" />` +
      `<Image id="av" src="https://x.com/a.png" alt="a" style={{radius:999,shadow:{x:0,y:4,blur:4,spread:0,color:"#adb5bd"}}} />`,
  )
  assert.match(html, /details::details-content\{[^}]*gap:inherit/)
  assert.match(
    html,
    /summary\{justify-content:center;width:44px;[^}]*background:color-mix/,
  )
  assert.equal((html.match(/<span class="s-vh">Menu</g) ?? []).length, 1)
  assert.match(
    html,
    /box-shadow:0px 4px 4px 0px #adb5bd|box-shadow:0 4px 4px 0 #adb5bd/,
  )
  assert.match(html, /border-radius:/)
})
