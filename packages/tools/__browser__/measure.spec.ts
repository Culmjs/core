import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import type { Data, Node, SiteDocument } from '@culmjs/core'
import { apply, memoryStore } from '@culmjs/core/ops'
import { walk } from '@culmjs/core/document'
import { copyFixture } from '../__tests__/fixtures.ts'
import { fileHashes } from '../src/build/bundle.ts'
import { openProject, type Project } from '../src/folder/project.ts'
import { openBrowser, type Browser } from '../src/measure/browser.ts'
import {
  measureSince,
  runMeasure,
  type MeasureInput,
} from '../src/measure/run.ts'

let browser: Browser
let project: Project
let dir: string
let doc: SiteDocument
before(async () => {
  const o = await openBrowser()
  assert.ok(o.ok, o.ok ? '' : JSON.stringify(o.problems))
  browser = o.browser
  dir = await copyFixture('site-basic')
  project = await openProject(dir)
  doc = project.loaded.doc!
})
after(async () => {
  await browser?.close()
})

const data = (): Data => project.loaded.data
const input = (over: Partial<MeasureInput> = {}): MeasureInput => ({
  doc,
  registry: project.registry,
  data: data(),
  revision: 0,
  browser,
  assets: async p => readFile(join(dir, p)).catch(() => undefined),
  ...over,
})
const clone = (): SiteDocument => structuredClone(doc)
const find = (d: SiteDocument, id: string): Node => {
  let found: Node | undefined
  for (const r of [...d.pages.map(p => p.root), d.header, d.footer])
    walk(r, n => {
      if (n.id === id) found = n
    })
  assert.ok(found, id)
  return found
}

// first, before anything else of CUJ 3 is written
test('the fixture nowrap title raises overflow at 390', async () => {
  const r = await runMeasure(input({ pages: ['home'] }))
  const f = r.findings.find(x => x.check === 'overflow' && x.width === 390)
  assert.ok(f, JSON.stringify(r.findings.map(x => [x.check, x.width, x.nodes])))
  assert.equal(f.check, 'overflow')
  assert.equal(f.width, 390)
  assert.deepEqual(f.nodes, ['hero1.title'])
  assert.equal(typeof f.observed, 'number')
  assert.ok((f.observed as number) > 0)
  console.log('overflow observed px:', f.observed, '|', f.message)
  console.log('browser used:', r.browser)
  assert.equal(
    r.findings.some(x => x.check === 'overflow' && x.width !== 390),
    false,
    'only the phone overflows',
  )
})

test('a text of #777 on #888 raises contrast, with the ratio as observed', async () => {
  const d = clone()
  find(d, 'intro').style = {
    base: { size: 18, color: '#777777', bg: '#888888' },
  }
  const r = await runMeasure(input({ doc: d, pages: ['home'], widths: [1280] }))
  const fs = r.findings.filter(
    x => x.check === 'contrast' && x.nodes[0] === 'intro',
  )
  assert.ok(
    fs.length >= 1,
    JSON.stringify(r.findings.map(x => [x.check, x.nodes])),
  )
  for (const f of fs) {
    assert.equal(f.class, 2)
    assert.equal(typeof f.observed, 'number')
    // 777777 on 888888 is 1.2:1 (WCAG), cut to one decimal
    assert.equal(f.observed, 1.2)
    assert.equal(f.expected, 'at least 4.5:1')
  }
  assert.deepEqual(fs.map(f => f.theme).sort(), ['dark', 'light'])
  assert.equal(
    r.findings.some(x => x.check === 'contrast' && x.nodes[0] === 'hero1.lead'),
    false,
  )
})

test('two runs of one revision give equal finding keys and equal build identities', async () => {
  const files = await fileHashes(dir)
  const a = await runMeasure(input({ files }))
  const b = await runMeasure(input({ files }))
  assert.ok(a.findings.length > 0)
  assert.deepEqual(
    a.findings.map(f => f.key),
    b.findings.map(f => f.key),
  )
  assert.equal(a.build, b.build)
  assert.match(a.build, /^[0-9a-f]{64}$/)
  assert.deepEqual(a.measured, b.measured)
  assert.equal(a.measured.length, 3 * 3 * 2) // three pages, three widths, two themes
})

test('an image by an outside address is listed in blocked and no request leaves the bundle', async () => {
  let hits = 0
  const server: Server = createServer((_, res) => {
    hits++
    res.end('x')
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  try {
    const outside = `http://127.0.0.1:${(server.address() as { port: number }).port}/pic.png`
    const d = clone()
    const home = d.pages.find(p => p.id === 'home')!.root
    home.children = [
      ...home.children!,
      {
        id: 'far',
        kind: 'image',
        name: 'Far',
        slot: {},
        props: { src: outside, alt: 'far' },
      },
    ]
    const r = await runMeasure(
      input({ doc: d, pages: ['home'], widths: [1280], themes: ['light'] }),
    )
    assert.deepEqual(r.blocked, [outside])
    assert.equal(hits, 0)
    assert.ok(
      r.findings.every(f => f.assets === false),
      'the finding says the assets did not all load',
    )
  } finally {
    server.close()
  }
})

test('a page that fails to load is incomplete and the other pages are still measured', async () => {
  const flaky: Browser = {
    ...browser,
    newPage: async () => {
      const page = await browser.newPage()
      return {
        ...page,
        goto: (url, ms) =>
          url.endsWith('/about')
            ? Promise.resolve({ ok: false, problem: 'net::ERR_FAILED' })
            : page.goto(url, ms),
      }
    },
  }
  const r = await runMeasure(
    input({ browser: flaky, widths: [390], themes: ['light'] }),
  )
  assert.deepEqual(
    r.incomplete.map(i => [i.page, i.problem.code]),
    [['about', 'MEASUREMENT_INCOMPLETE']],
  )
  assert.match(r.incomplete[0]!.problem.message, /ERR_FAILED/)
  assert.deepEqual([...new Set(r.measured.map(m => m.page))].sort(), [
    'home',
    'menu',
  ])
})

test('classes [3] returns class 3 findings; the default returns classes 1 and 2', async () => {
  const three = await runMeasure(input({ classes: [3] }))
  const dflt = await runMeasure(input())
  assert.ok(three.findings.length > 0, 'the fixture has class 3 findings')
  assert.ok(three.findings.every(f => f.class === 3))
  assert.ok(dflt.findings.length > 0)
  assert.ok(dflt.findings.every(f => f.class === 1 || f.class === 2))
})

test('a site with an rtl language is measured in both directions', async () => {
  const d = clone()
  d.languages = [{ code: 'en' }, { code: 'ar', dir: 'rtl' }]
  const r = await runMeasure(input({ doc: d, pages: ['about'], widths: [390] }))
  assert.deepEqual([...new Set(r.measured.map(m => m.dir))].sort(), [
    'ltr',
    'rtl',
  ])
  assert.equal(r.measured.length, 1 * 1 * 2 * 2)
  const only = await runMeasure(
    input({ doc: d, pages: ['about'], widths: [390], directions: ['rtl'] }),
  )
  assert.deepEqual([...new Set(only.measured.map(m => m.dir))], ['rtl'])
})

test('measureSince after the repair batch marks the overflow fixed and lists nothing added', async () => {
  const store = memoryStore({ site: doc })
  const done = await apply(store, project.registry, {
    site: 'site',
    baseRevision: 0,
    key: 'repair-1',
    ops: [
      {
        op: 'setStyle',
        tree: { page: 'home' },
        id: 'hero1.title',
        layer: 'phone',
        decl: { nowrap: false, size: 28 },
      },
    ],
  })
  assert.ok(done.ok, JSON.stringify(done))
  const r = await measureSince({
    store,
    site: 'site',
    since: 0,
    registry: project.registry,
    data: data(),
    pages: ['home'],
    browser,
  })
  assert.ok(r.ok, JSON.stringify(r))
  assert.equal(r.report.revision, 1)
  const was = r.comparison.was.find(w => w.finding.check === 'overflow')
  assert.ok(was, 'the earlier run had the overflow')
  assert.deepEqual(was.finding.nodes, ['hero1.title'])
  assert.equal(was.status, 'fixed')
  assert.deepEqual(r.comparison.added, [])
  assert.equal(
    r.report.findings.some(f => f.check === 'overflow'),
    false,
  )
})

test('every declared state is listed in skipped', async () => {
  const d = clone()
  find(d, 'intro').state = [
    { name: 'tab', values: ['first', 'second'], initial: 'first' },
    { name: 'open', values: 'on-off', initial: 'off' },
  ]
  const r = await runMeasure(
    input({ doc: d, pages: ['home'], widths: [1280], themes: ['light'] }),
  )
  assert.deepEqual([...r.skipped].sort(), ['state:open=on', 'state:tab=second'])
})

// carried from the old engine's browser.test.ts
test('text over a gradient is sampled from pixels', async () => {
  const d = clone()
  find(d, 'intro').style = {
    base: {
      size: 18,
      color: '#808080',
      gradient: {
        angle: 90,
        stops: [
          { color: '#7a7a7a', at: 0 },
          { color: '#868686', at: 100 },
        ],
      },
    },
  }
  const r = await runMeasure(
    input({ doc: d, pages: ['home'], widths: [1280], themes: ['light'] }),
  )
  const f = r.findings.find(
    x => x.check === 'contrast' && x.nodes[0] === 'intro',
  )
  assert.ok(f, JSON.stringify(r.findings.map(x => [x.check, x.nodes])))
  assert.match(f.message, /sampled over a picture or gradient/)
  assert.ok((f.observed as number) < 1.5)
})

test('a 600 px wide block is measured past the phone edge', async () => {
  const d = clone()
  find(d, 'intro').style = { base: { size: 18, width: { n: 600, unit: 'px' } } }
  const r = await runMeasure(
    input({ doc: d, pages: ['home'], widths: [390], themes: ['light'] }),
  )
  const f = r.findings.find(x => x.nodes[0] === 'intro' && x.width === 390)
  assert.ok(f, JSON.stringify(r.findings.map(x => [x.check, x.nodes, x.width])))
  assert.equal(f.class, 2)
})

test('the page of a list reports node ids without the repeat suffix', async () => {
  const r = await runMeasure(input({ pages: ['menu'], classes: [1, 2, 3] }))
  assert.ok(r.measured.length > 0)
  assert.ok(r.findings.every(f => f.nodes.every(n => !n.includes('~'))))
})
