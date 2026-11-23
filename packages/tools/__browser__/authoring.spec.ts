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
import { buildRequest } from '../src/jsx/batch.ts'
import { runMeasure } from '../src/measure/run.ts'
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

test('the phone finding names the constraining row and its checked update fixes only that viewport', async () => {
  const original = written(
    `<Column style={{padding:"32px 6%"}}>
    <Text id="title" level="h1" style={{size:168}} phone={{size:72}}>Relay</Text>
    <Row id="schedule" style={{justify:"between"}}><Text>21:00</Text><Text>Signal</Text></Row>
    <Row id="contact" style={{justify:"between",align:"end",gap:40}}>
      <Column><Text level="h2" style={{size:48,lineHeight:1.2,letterSpacing:0}}>Send a demo</Text>
      <Text style={{width:520,size:19}} phone={{width:"fill",size:17}}>We’re listening. Send your sounds, ideas and late-night transmissions our way.</Text></Column>
      <Button id="cta" label="EMAIL YOUR DEMO ↗" href="mailto:desk@example.org" style={{size:14,weight:800,padding:"20px 28px"}} />
    </Row></Column>`,
    'home',
    { ...starterSite(), centreMaxWidth: true },
  )
  const measure = async (doc: SiteDocument) =>
    runMeasure({
      doc,
      registry,
      browser,
      data: { rows: {} },
      revision: 1,
      widths: [390],
    })
  const findings = (await measure(original)).findings.filter(
    f => f.check === 'crowded-phone-row',
  )
  const f = findings.find(f => f.nodes.includes('cta'))
  assert.ok(f, JSON.stringify(findings))
  assert.deepEqual(f.nodes, ['cta', 'contact'])
  assert.match(f.message, /\d+px wide and wraps to [3-9] lines/)
  assert.ok(!findings.some(f => f.nodes.includes('schedule')))
  const repair = JSON.parse(f.fix!.slice(f.fix!.indexOf('{')))
  const b = buildRequest(original, registry, { ops: [repair] })
  assert.ok(b.ok)
  const changed = plan(original, registry, {
    site: 's',
    key: 'fix',
    baseRevision: 0,
    ops: b.ops as never,
  })
  assert.ok(changed.ok)
  assert.deepEqual(
    (await measure(changed.doc)).findings.filter(
      f => f.check === 'crowded-phone-row' && f.nodes.includes('cta'),
    ),
    [],
  )
  const metrics = `(()=>{const h=document.querySelector('h1'),h2=document.querySelector('h2'),b=document.querySelector('[data-id=cta]'),s=getComputedStyle(h),t=getComputedStyle(h2),range=document.createRange();range.selectNodeContents(b);return {lines:new Set([...range.getClientRects()].map(q=>q.top)).size,font:s.fontSize,leading:s.lineHeight,explicit:t.lineHeight,track:t.letterSpacing,body:getComputedStyle(document.querySelector('.s-site')).lineHeight}})()`
  const before = await laidOut(original, 1280, metrics)
  const after = await laidOut(changed.doc, 1280, metrics)
  assert.deepEqual(after.extra, before.extra)
  assert.deepEqual(after.box('cta'), before.box('cta'))
  const phone = await laidOut<{ lines: number; font: string }>(
    changed.doc,
    390,
    metrics,
  )
  assert.equal(phone.extra.lines, 1)
  assert.equal(phone.extra.font, '72px')
  assert.deepEqual(after.extra, {
    lines: 1,
    font: '168px',
    leading: '159.6px',
    explicit: '57.6px',
    track: 'normal',
    body: '24px',
  })
})

test('HTML imported from a fragment retains native title ink, scale, artwork and mobile stacking', async () => {
  const html =
    '<section id="intro"><h1>Relay <i>FM</i></h1><div class="heading"><h2>Material studies</h2><p>Collection notes</p></div><div id="art"><div id="vessel"></div></div></section>'
  const css =
    '*{box-sizing:border-box}body{margin:0;color:#eee9dc;font-family:Arial,sans-serif}#intro{background:#191919;padding:5%}h1{font-size:clamp(80px,16vw,260px)}h1,h2,p{margin:0}.heading{display:flex;justify-content:space-between;align-items:end}#art{position:relative;height:100px}#vessel{position:absolute;left:50%;bottom:10%;width:80px;height:60px;transform:translateX(-50%);background:linear-gradient(90deg,#555,#888 40%,#333)}@media(max-width:600px){.heading{display:block}.heading p{margin-top:32px}h1{font-size:16vw}}'
  const site = starterSite(),
    b = buildWrite(site, registry, { html, css, page: 'home' })
  assert.ok(b.ok)
  const r = plan(site, registry, {
    site: 's',
    key: 'import',
    baseRevision: 0,
    ops: b.ops as never,
  })
  assert.ok(r.ok)
  const metrics = `(()=>{const h=document.querySelector('h1'),s=getComputedStyle(h),art=document.querySelector('#art,[data-id=art]').getBoundingClientRect(),v=document.querySelector('#vessel,[data-id=vessel]'),q=v.getBoundingClientRect(),a=document.querySelector('h2').getBoundingClientRect(),p=[...document.querySelectorAll('p')].find(e=>e.textContent==='Collection notes').getBoundingClientRect();return {color:s.color,size:s.fontSize,gradient:getComputedStyle(v).backgroundImage,center:Math.round(q.left+q.width/2-art.left-art.width/2),stacked:p.top>=a.bottom,gap:Math.round(p.top-a.bottom)}})()`
  const src = await browser.newPage()
  try {
    await src.answer(async () => ({
      body: `<!doctype html><meta charset=utf-8><style>${css}</style>${html}`,
      type: 'text/html',
    }))
    assert.ok((await src.goto('https://site.culm.invalid/', 15000)).ok)
    for (const w of [390, 1280]) {
      await src.setViewport(w, 900)
      const a = await src.evaluate<Record<string, unknown>>(metrics)
      const { extra: b }: { extra: Record<string, unknown> } = await laidOut<
        Record<string, unknown>
      >(r.doc, w, metrics)
      for (const k of ['color', 'size', 'center', 'stacked'])
        assert.deepEqual(b[k], a[k], k)
      assert.equal(
        String(b.gradient)
          .replaceAll(') 0%,', '),')
          .replaceAll(') 100%)', '))'),
        a.gradient,
      )
      if (w === 390) assert.equal(b.gap, a.gap)
    }
  } finally {
    await src.close()
  }
})

test('a full HTML write preserves its landmarks, responsive styles and working fragment link', async () => {
  const site = starterSite()
  const b = buildWrite(site, registry, {
    html: `<!doctype html><html><head><title>Kiln Index</title><style>
    .hero {padding:24px 5%}
    #work {font-size:clamp(32px, 6vw, 72px)}
    @media(max-width:600px){ .hero {padding:12px 4%} }
    </style></head><body><header><nav><a href="#work">Work</a></nav></header><section class="hero"><h1 id="work">Kiln Index</h1></section><footer><p>Studio</p></footer></body></html>`,
  })
  assert.ok(b.ok, b.ok ? '' : JSON.stringify(b.problems))
  assert.deepEqual(b.errors, [])
  const r = plan(site, registry, {
    site: 's',
    key: 'x',
    baseRevision: 0,
    ops: b.ops as never,
  })
  assert.ok(r.ok, r.ok ? '' : JSON.stringify(r.problems))
  type Rendered = {
    title: string
    anchors: boolean
    font: string
    padding: string
    footer: string
  }
  for (const [width, size, padding] of [
    [1280, '72px', '64px'],
    [390, '32px', '15.6px'],
  ] as const) {
    const at: { extra: Rendered } = await laidOut<Rendered>(
      r.doc,
      width,
      `(()=>{const h=document.querySelector('h1'),a=document.querySelector('header nav a');return {title:document.title,anchors:document.getElementById(a.hash.slice(1))===h,font:getComputedStyle(h).fontSize,padding:getComputedStyle(h.parentElement).paddingLeft,footer:document.querySelector('footer').innerText.trim()}})()`,
    )
    assert.match(at.extra.title, /Kiln Index/)
    assert.equal(at.extra.anchors, true)
    assert.equal(at.extra.font, size)
    assert.ok(
      Math.abs(parseFloat(at.extra.padding) - parseFloat(padding)) < 0.02,
    )
    assert.equal(at.extra.footer, 'Studio')
  }
})
