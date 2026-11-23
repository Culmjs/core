import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { createRegistry, emptySite, PROBE_SCRIPT } from '@culmjs/core'
import type { Node, SiteDocument } from '@culmjs/core'
import { compilePage } from '@culmjs/core/compile'
import { plan } from '@culmjs/core/ops'
import starter, { LOOK, STYLES } from '@culmjs/starter'
import { pageFooter } from '../../starter/src/blocks/pageFooter.ts'
import { pageHeader } from '../../starter/src/blocks/pageHeader.ts'
import { buildWrite } from '../src/jsx/write.ts'
import { openBrowser, type Browser } from '../src/measure/browser.ts'

let browser: Browser
before(async () => {
  const o = await openBrowser()
  assert.ok(o.ok, o.ok ? '' : JSON.stringify(o.problems))
  browser = o.browser
})
after(async () => {
  await browser?.close()
})

const registry = createRegistry()
registry.use(starter)

/** A site whose footer is the starter's: a padded, ruled, centred section round its bar, (its ids have no dots here, as a test site holds no blocks). */
function starterSite(): SiteDocument {
  const doc: SiteDocument = { ...emptySite('Ada', LOOK), styles: STYLES }
  const give = (n: Node, id: string): Node => ({
    ...n,
    id,
    children: n.children?.map(c => give(c, `${id}${c.id}`)),
  })
  doc.footer = give(pageFooter.looks![0]!.tree, 'footer')
  doc.header = give(pageHeader.looks![0]!.tree, 'header')
  return doc
}

/** Writes the JSX to a page, the header or the footer of a site, as `write` does, and returns the document. */
function written(jsx: string, page = 'home', from?: SiteDocument) {
  const doc0: SiteDocument = from ?? starterSite()
  const b = buildWrite(doc0, registry, { page, jsx })
  assert.ok(b.ok, b.ok ? '' : JSON.stringify(b.problems))
  assert.deepEqual(b.errors, [])
  const r = plan(doc0, registry, {
    site: 's',
    baseRevision: 0,
    key: 'k',
    ops: b.ops as never,
  })
  assert.ok(r.ok, r.ok ? '' : JSON.stringify(r.problems))
  return r.doc
}

type Box = { x: number; y: number; w: number; h: number }
/** The page at a width: the box of every node, and the answer of a script run in it. */
async function laidOut<T = never>(
  doc: SiteDocument,
  width: number,
  script?: string,
) {
  const out = compilePage(doc, 'home', {
    registry,
    mode: 'measure',
    links: { page: slug => slug, file: id => `/assets/${id}` },
  })
  assert.ok(out.ok, out.ok ? '' : JSON.stringify(out.problems))
  const page = await browser.newPage()
  try {
    await page.answer(async url =>
      new URL(url).pathname === '/'
        ? { type: 'text/html; charset=utf-8', body: out.html }
        : undefined,
    )
    assert.ok((await page.goto('https://site.culm.invalid/', 15000)).ok)
    await page.setViewport(width, 900)
    const raw = await page.evaluate<{
      nodes: { id: string; box: Box | null }[]
    }>(`(${PROBE_SCRIPT})(document, window, ${width})`)
    const extra = script ? await page.evaluate<T>(script) : undefined
    return {
      box: (id: string) => raw.nodes.find(n => n.id === id)!.box!,
      extra: extra as T,
      html: out.html,
    }
  } finally {
    await page.close()
  }
}

const find = (n: Node, f: (n: Node) => boolean): Node | undefined =>
  f(n) ? n : n.children?.map(c => find(c, f)).find(Boolean)

test('a capped paragraph and the labels of differently sized buttons are centred at desktop width', async () => {
  const jsx =
    '<Column style={{align:"center"}}><Text style={{width:"fill",maxWidth:680}}>Our plans</Text>' +
    [90, 160, 240]
      .map(w => `<Button label="Choose" style={{width:${w}}} />`)
      .join('') +
    '</Column>'
  const doc = written(jsx)
  const hero = find(
    doc.pages[0]!.root,
    n =>
      n.kind === 'text' &&
      (n.style?.base?.maxWidth as { n?: number } | undefined)?.n === 680,
  )!
  assert.equal((hero.slot as { align?: string }).align, 'stretch')
  const at = await laidOut<number[][]>(
    doc,
    1280,
    `[...document.querySelectorAll('main button, main a')].map(b=>{const r=document.createRange();r.selectNodeContents(b);const t=r.getBoundingClientRect(),c=b.getBoundingClientRect();return [Math.round(t.left-c.left),Math.round(c.right-t.right)]})`,
  )
  const b = at.box(hero.id)
  assert.equal(b.w, 680)
  assert.ok(Math.abs(b.x - 300) <= 1, `x ${b.x}`)
  assert.ok(
    at.extra.length >= 3,
    at.html
      .match(/<(button|a)[^>]*>/g)
      ?.slice(0, 5)
      .join('\n'),
  )
  for (const [l, r] of at.extra) assert.ok(Math.abs(l! - r!) <= 1, `${l} ${r}`)
  assert.ok(!at.html.includes('align-self:stretch'))
})

test('a row stays a row at 390 unless its phone layer asks; a Field box style sizes the input and not the label, which has a placeholder and no border under a background', async () => {
  const doc = written(
    `<Column style={{width:"fill"}}>` +
      `<Row id="r1" style={{gap:8}} phone={{}}><Text id="a1">One</Text><Text id="a2">Two</Text></Row>` +
      `<Row id="r2" style={{gap:8}} phone={{direction:"column"}}><Text id="b1">One</Text><Text id="b2">Two</Text></Row>` +
      `<Form><Field name="email" label="Email" placeholder="you@x.com" style={{height:{n:64,unit:"px"},padding:20,bg:"#ffffff"}}/></Form>` +
      `</Column>`,
  )
  const at = await laidOut<{
    input: number
    label: number
    border: string
    ph: string
  }>(
    doc,
    390,
    `(()=>{const i=document.querySelector('input[name=email]'),l=i.closest('label');return {input:Math.round(i.getBoundingClientRect().height),label:Math.round(l.getBoundingClientRect().height),border:getComputedStyle(i).borderTopWidth,ph:i.placeholder}})()`,
  )
  assert.ok(Math.abs(at.box('a1').y - at.box('a2').y) <= 1, 'r1 stays a row')
  assert.ok(at.box('b2').y > at.box('b1').y, 'r2 folds, it asked')
  assert.equal(at.extra.input, 64)
  assert.ok(at.extra.label > 64, 'the label holds its text and the input')
  assert.equal(at.extra.border, '0px')
  assert.equal(at.extra.ph, 'you@x.com')
})

test('a footer written as one bar fills the page and the starter rule and padding are gone; a Menu colour reaches its links; an Icon width sizes the glyph; a painted submit has no line and no bold', async () => {
  const home = written(
    `<Column style={{width:"fill"}}>` +
      `<Menu id="m1" which="menu" style={{color:"#d2c5bf"}}/>` +
      `<Icon name="star" style={{width:{n:48,unit:"px"},height:{n:48,unit:"px"}}}/>` +
      `<Form><Field name="email" label="Email"/><Button label="Go" style={{bg:"#0d6efd",color:"#ffffff"}}/></Form>` +
      `</Column>`,
  )
  assert.ok(
    home.footer.style?.base?.padding !== undefined,
    'the starter had them',
  )
  const doc = written(
    `<Column id="footerbar" style={{bg:"#cccccc",padding:[24,16,24,16]}}><Text>Words</Text></Column>`,
    'footer',
    home,
  )
  for (const k of ['padding', 'border', 'align'] as const)
    assert.equal(doc.footer.style?.base?.[k], undefined, k)
  const at = await laidOut<{
    link: string
    svg: number
    border: string
    weight: string
  }>(
    doc,
    1280,
    `(()=>{const g=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Go');return {link:getComputedStyle(document.querySelector('main a')).color,svg:Math.round(document.querySelector('main svg').getBoundingClientRect().width),border:getComputedStyle(g).borderTopWidth,weight:getComputedStyle(g).fontWeight}})()`,
  )
  assert.equal(at.extra.link, 'rgb(210, 197, 191)')
  assert.equal(at.extra.svg, 48)
  assert.equal(at.extra.border, '0px')
  assert.notEqual(at.extra.weight, '600')
  assert.equal(at.box('footerbar').w, 1280)
})

test('a sidebar header whose bar says height fill is as tall as the window at 1280x900', async () => {
  const doc = written(
    `<Column id="sidebar" style={{side:320,height:"fill",justify:"between",bg:"#cccccc"}}><Text>Top</Text><Text>Bottom</Text></Column>`,
    'header',
    written(`<Text>x</Text>`),
  )
  const at = await laidOut(doc, 1280)
  const b = at.box('sidebar')
  assert.equal(b.w, 320)
  assert.equal(b.h, 900)
})
