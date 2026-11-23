import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Node, SiteDocument } from '@culmjs/core'
import { copyFixture } from '../__tests__/fixtures.ts'
import { openProject, type Project } from '../src/folder/project.ts'
import { openBrowser, type Browser } from '../src/measure/browser.ts'
import { compilePage } from '@culmjs/core/compile'
import { PROBE_SCRIPT } from '@culmjs/core'
import { runMeasure } from '../src/measure/run.ts'

let browser: Browser
let project: Project
let dir: string
before(async () => {
  const o = await openBrowser()
  assert.ok(o.ok, o.ok ? '' : JSON.stringify(o.problems))
  browser = o.browser
  dir = await copyFixture('site-basic')
  project = await openProject(dir)
})
after(async () => {
  await browser?.close()
})

// Review Focus 4: a pill button with a rect behind its label, in light and dark, left to right and right to left.
test('a pill button (rect radius 9999 behind, gradient fill) at 1280, 834 and 390, light and dark, ltr and rtl: the label is above the shape, the tap target is at least 44 px, and measure reports no class 1 or 2 finding', async () => {
  const doc: SiteDocument = structuredClone(project.loaded.doc!)
  doc.languages = [{ code: 'en' }, { code: 'ar', dir: 'rtl' }]
  const pill: Node = {
    id: 'pill',
    kind: 'button',
    name: 'Pill',
    // as wide as its label: a button across its parent is stretched-button's to report
    slot: { align: 'start' },
    props: { label: 'Order now', link: { page: '/menu' } },
    style: {
      base: { padding: 16, minHeight: { n: 44, unit: 'px' }, color: 'ink' },
    },
    children: [
      {
        id: 'pillbg',
        kind: 'shape',
        name: 'Pill background',
        slot: {},
        placement: { mode: 'behind' },
        props: {
          geometry: { type: 'rect', radius: 9999 },
          fill: { from: 'brand', to: 'ink', angle: 90 },
        },
      },
    ],
  } as Node
  const home = doc.pages.find(p => p.id === 'home')!.root
  home.children = [...home.children!, pill]
  const r = await runMeasure({
    doc,
    registry: project.registry,
    data: project.loaded.data,
    revision: 0,
    browser,
    pages: ['home'],
    assets: async p => readFile(join(dir, p)).catch(() => undefined),
  })
  const c = compilePage(doc, 'home', { registry: project.registry })
  assert.ok(c.ok, c.ok ? '' : JSON.stringify(c.problems))
  assert.deepEqual(r.incomplete, [])
  // three widths, two themes, two directions
  assert.equal(r.measured.length, 3 * 2 * 2)
  assert.deepEqual(
    r.findings.filter(f => f.nodes.some(n => n.startsWith('pill'))),
    [],
    'no finding on the pill or its shape (the fixture title still overflows at 390)',
  )

  // Each of the 12 cells, read in the page itself.
  for (const lang of ['en', 'ar']) {
    const out = compilePage(doc, 'home', {
      registry: project.registry,
      mode: 'measure',
      links: { page: slug => slug, file: id => `/assets/${id}` },
      lang,
    })
    assert.ok(out.ok, out.ok ? '' : JSON.stringify(out.problems))
    const page = await browser.newPage()
    try {
      const html = out.html
      await page.answer(async url =>
        new URL(url).pathname === '/'
          ? { type: 'text/html; charset=utf-8', body: html }
          : undefined,
      )
      assert.ok((await page.goto('https://site.culm.invalid/', 15000)).ok)
      for (const width of [1280, 834, 390])
        for (const theme of ['light', 'dark'] as const) {
          await page.setViewport(width, 900)
          await page.setScheme(theme)
          const cell = `${lang} ${width} ${theme}`
          const got = await page.evaluate<{
            found: boolean
            hit?: string
            w: number
            h: number
            dir: string
          }>(`(() => {
            const a = [...document.querySelectorAll('a')].find(x => x.textContent.includes('Order now'))
            if (!a) return { found: false, w: 0, h: 0, dir: '' }
            a.scrollIntoView({ block: 'center' })
            const r = a.getBoundingClientRect()
            const t = document.createRange()
            const node = [...a.childNodes].find(n => n.nodeType === 3)
            t.selectNodeContents(node)
            const b = t.getBoundingClientRect()
            const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)
            const inSvg = !!hit && !!hit.closest('svg')
            return { found: true, hit: !hit ? 'none' : inSvg ? 'svg' : a.contains(hit) ? 'button' : 'other', w: r.width, h: r.height, dir: getComputedStyle(document.documentElement).direction }
          })()`)
          assert.ok(got.found, cell)
          assert.equal(got.dir, lang === 'ar' ? 'rtl' : 'ltr', cell)
          assert.equal(
            got.hit,
            'button',
            `${cell}: the label is above the shape`,
          )
          assert.ok(got.w >= 44 && got.h >= 44, `${cell}: ${got.w} x ${got.h}`)
        }
    } finally {
      await page.close()
    }
  }
})

// Review Focus 1: a shape on a phone.
test('a 600 px wide shape at 390 is off-screen with its fix; a shape with no width is not', async () => {
  const doc: SiteDocument = structuredClone(project.loaded.doc!)
  const mk = (id: string, style?: Node['style']): Node =>
    ({
      id,
      kind: 'shape',
      name: id,
      slot: {},
      props: { geometry: { type: 'rect', view: [600, 40] }, fill: 'brand' },
      ...(style ? { style } : {}),
    }) as Node
  const home = doc.pages.find(p => p.id === 'home')!.root
  home.children = [
    ...home.children!,
    mk('wideshape', { base: { width: { n: 600, unit: 'px' } } }),
    mk('autoshape'),
  ]
  const r = await runMeasure({
    doc,
    registry: project.registry,
    data: project.loaded.data,
    revision: 0,
    browser,
    pages: ['home'],
    assets: async p => readFile(join(dir, p)).catch(() => undefined),
  })
  const off = r.findings.filter(
    f => f.check === 'off-screen' && f.nodes.includes('wideshape'),
  )
  assert.ok(off.length > 0)
  assert.equal(off[0].width, 390)
  assert.equal(off[0].fix, 'Let it wrap, or give it a smaller width on phone.')
  assert.deepEqual(
    r.findings.filter(f => f.nodes.includes('autoshape')),
    [],
  )
})

// Review Focus 5: a label is an aria-label, not text.
test('the real probe gives a shape labelled "Welcome" no text', async () => {
  const doc: SiteDocument = structuredClone(project.loaded.doc!)
  const home = doc.pages.find(p => p.id === 'home')!.root
  home.children = [
    ...home.children!,
    {
      id: 'lab',
      kind: 'shape',
      name: 'Wave',
      slot: {},
      props: { geometry: { type: 'rect' }, fill: 'brand', label: 'Welcome' },
    } as Node,
  ]
  const out = compilePage(doc, 'home', {
    registry: project.registry,
    mode: 'measure',
    links: { page: slug => slug, file: id => `/assets/${id}` },
  })
  assert.ok(out.ok, out.ok ? '' : JSON.stringify(out.problems))
  const page = await browser.newPage()
  try {
    const html = out.html
    await page.answer(async url =>
      new URL(url).pathname === '/'
        ? { type: 'text/html; charset=utf-8', body: html }
        : undefined,
    )
    assert.ok((await page.goto('https://site.culm.invalid/', 15000)).ok)
    await page.setViewport(1280, 900)
    const raw = await page.evaluate<{
      nodes: { id: string; box: unknown; text?: unknown }[]
    }>(`(${PROBE_SCRIPT})(document, window, 1280)`)
    const n = raw.nodes.find(x => x.id === 'lab')
    assert.ok(n?.box, 'the shape is measured')
    assert.equal(n.text, undefined)
  } finally {
    await page.close()
  }
})
