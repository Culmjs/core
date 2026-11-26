import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
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

const fixture = (name: string) =>
  readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

/** The site with two more pages, so a menu has links to space. */
function withPages(doc: SiteDocument): SiteDocument {
  const r = plan(doc, registry, {
    site: 's',
    baseRevision: 0,
    key: 'pages',
    ops: ['about', 'shop'].map(p => ({
      op: 'addPage',
      page: p,
      title: p,
      slug: `/${p}`,
      inMenu: true,
    })) as never,
  })
  assert.ok(r.ok, r.ok ? '' : JSON.stringify(r.problems))
  return r.doc
}

test('round 7, the real saas header (an inner row of max width 1116 alone in a row): it sits in the middle at 1280, the brand is not at the edge', async () => {
  const doc = written(await fixture('saas-header.jsx'), 'header')
  const inner = find(doc.header, n => n.style?.base?.maxWidth !== undefined)!
  const at = await laidOut(doc, 1280)
  const b = at.box(inner.id)
  assert.equal(b.w, 1116)
  assert.equal(Math.round(b.x), 82)
})

test('round 7, the real restaurant header with a folded Menu: its links are 64 px apart at 1280 (the gap reaches them), and toggle="box" makes the phone button a 44 px square that shows no word', async () => {
  // the harness fetches no fonts: the run's family is left out
  const jsx = (await fixture('restaurant-header.jsx')).replace(
    /font:"up:raleway",/g,
    '',
  )
  const gaps = `(()=>{const a=[...document.querySelectorAll('header nav a')].map(x=>x.getBoundingClientRect());return a.slice(1).map((r,i)=>Math.round(r.left-a[i].right))})()`
  const doc = withPages(written(jsx, 'header', starterSite()))
  const wide = await laidOut<number[]>(doc, 1280, gaps)
  assert.ok(wide.extra.length >= 2, JSON.stringify(wide.extra))
  for (const g of wide.extra) assert.ok(Math.abs(g - 64) <= 2, `gap ${g}`)
  const boxed = withPages(
    written(
      jsx.replace('foldOn="phone"', 'foldOn="phone" toggle="box"'),
      'header',
      starterSite(),
    ),
  )
  const phone = await laidOut<{
    w: number
    h: number
    text: number
    bg: string
  }>(
    boxed,
    390,
    `(()=>{const s=document.querySelector('header summary'),r=s.getBoundingClientRect();return {w:Math.round(r.width),h:Math.round(r.height),text:[...s.childNodes].filter(n=>n.nodeType===3).length,bg:getComputedStyle(s).backgroundColor}})()`,
  )
  assert.equal(phone.extra.w, 44)
  assert.equal(phone.extra.h, 44)
  assert.equal(phone.extra.text, 0)
  assert.notEqual(phone.extra.bg, 'rgba(0, 0, 0, 0)')
})

test('round 7, the real pricing table at 390: the header word "Enterprise" is on one line (words stay whole)', async () => {
  const doc = written(await fixture('pricing6-home.jsx'))
  const at = await laidOut<number>(
    doc,
    390,
    `(()=>{const c=[...document.querySelectorAll('th,td,p')].find(e=>e.textContent.trim()==='Enterprise');const r=document.createRange();r.selectNodeContents(c);return r.getClientRects().length})()`,
  )
  assert.equal(at.extra, 1)
  assert.match(at.html, /overflow-wrap:normal;word-break:normal/)
})

test('round 7, the real editorial home with divide on its first grid: the lines sit between the cells and not before the first; an Image takes a shadow and a round corner; marks in a Text draw bold, underline, colour and a link', async () => {
  const jsx = (await fixture('editorial6-home.jsx'))
    .replace(/<Site [^>]*\/>/, '')
    .replace(/font:"up:[a-z-]+",?/g, '')
    .replace('<Grid cols={2}', '<Grid divide cols={2}')
  assert.ok(jsx.includes('<Grid divide'))
  const doc = written(
    `${jsx}<Image id="av" src="https://img.invalid/a.png" alt="a" style={{width:{n:80,unit:"px"},height:{n:80,unit:"px"},radius:999,shadow:{x:0,y:4,blur:4,spread:0,color:"#adb5bd"}}} />` +
      `<Text id="mk">Hi <b>bold</b> <u>under</u> <span style={{color:"#ff0000"}}>red</span> <a href="https://x.com/">link</a></Text>`,
  )
  const at = await laidOut<{
    first: string[]
    img: string[]
    runs: string[]
  }>(
    doc,
    1280,
    `(()=>{const g=[...document.querySelectorAll('main *')].find(e=>getComputedStyle(e).display==='grid'&&e.children.length>=3),k=[...g.children].map(c=>getComputedStyle(c));const i=getComputedStyle(document.querySelector('main img[alt=a]'));const t=document.querySelector('main p:last-of-type, main div:last-child');const m=[...document.querySelectorAll('main *')].filter(e=>e.textContent==='bold'||e.textContent==='under'||e.textContent==='red'||e.textContent==='link').pop();const q=s=>[...document.querySelectorAll('main *')].find(e=>e.children.length===0&&e.textContent===s);return {first:[k[0].borderInlineStartWidth,k[1].borderInlineStartWidth,k[2].borderTopWidth,k[0].borderTopWidth],img:[i.boxShadow,i.borderTopLeftRadius],runs:[getComputedStyle(q('bold')).fontWeight,getComputedStyle(q('under')).textDecorationLine,getComputedStyle(q('red')).color,q('link').tagName+q('link').getAttribute('href')]}})()`,
  )
  assert.deepEqual(at.extra.first, ['0px', '1px', '1px', '0px'])
  assert.match(at.extra.img[0]!, /4px/)
  assert.equal(at.extra.img[1], '999px')
  assert.deepEqual(at.extra.runs, [
    '700',
    'underline',
    'rgb(255, 0, 0)',
    'Ahttps://x.com/',
  ])
})
