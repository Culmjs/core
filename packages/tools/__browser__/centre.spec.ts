import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import type { Node, SiteDocument } from '@culmjs/core'
import { compilePage } from '@culmjs/core/compile'
import { PROBE_SCRIPT } from '@culmjs/core'
import { copyFixture } from '../__tests__/fixtures.ts'
import { openProject, type Project } from '../src/folder/project.ts'
import { openBrowser, type Browser } from '../src/measure/browser.ts'

let browser: Browser
let project: Project
before(async () => {
  const o = await openBrowser()
  assert.ok(o.ok, o.ok ? '' : JSON.stringify(o.problems))
  browser = o.browser
  project = await openProject(await copyFixture('site-basic'))
})
after(async () => {
  await browser?.close()
})

const col = (id: string, slot: Node['slot'] = {}, kids: Node[] = []): Node => ({
  id,
  kind: 'column',
  name: id,
  slot,
  style: { base: { maxWidth: { n: 600, unit: 'px' } } },
  children: [
    ...kids,
    {
      id: `${id}t`,
      kind: 'text',
      name: 'Text',
      slot: {},
      props: { level: 'p', runs: [{ text: 'Words' }] },
    },
  ],
})

/** The boxes of three max-width columns in a page root: none with an align, one with slot align start, one inside a box. */
async function boxes(centre: boolean) {
  const doc: SiteDocument = structuredClone(project.loaded.doc!)
  if (centre) doc.centreMaxWidth = true
  const home = doc.pages.find(p => p.id === 'home')!.root
  home.children = [
    col('plain'),
    col('start', { align: 'start' }),
    {
      id: 'blk',
      kind: 'box',
      name: 'Box',
      slot: {},
      children: [col('inbox')],
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
    await page.answer(async url =>
      new URL(url).pathname === '/'
        ? { type: 'text/html; charset=utf-8', body: out.html }
        : undefined,
    )
    assert.ok((await page.goto('https://site.culm.invalid/', 15000)).ok)
    await page.setViewport(1280, 900)
    const raw = await page.evaluate<{
      nodes: { id: string; box: { x: number; w: number } | null }[]
    }>(`(${PROBE_SCRIPT})(document, window, 1280)`)
    return (id: string) => raw.nodes.find(n => n.id === id)!.box!
  } finally {
    await page.close()
  }
}

test('with centreMaxWidth a max-width column with no slot align is centred at 1280, an explicit start align wins, and a block parent centres it too', async () => {
  const at = await boxes(true)
  for (const id of ['plain', 'inbox']) {
    const b = at(id)
    assert.equal(b.w, 600, id)
    assert.ok(Math.abs(b.x - (1280 - 600) / 2) <= 1, `${id} x ${b.x}`)
  }
  assert.ok(at('start').x < 100, `start x ${at('start').x}`)
})

test('without it the same column stays at the start, as sites made before it do', async () => {
  const at = await boxes(false)
  assert.ok(at('plain').x < 100, `x ${at('plain').x}`)
})

test('a written column with a max width and the default slot alignment is centred at 1280', async () => {
  const { createRegistry, emptySite } = await import('@culmjs/core')
  const { plan } = await import('@culmjs/core/ops')
  const { default: starter, LOOK, STYLES } = await import('@culmjs/starter')
  const { buildWrite } = await import('../src/jsx/write.ts')
  const registry = createRegistry()
  registry.use(starter)
  const doc0: SiteDocument = { ...emptySite('Ada', LOOK), styles: STYLES }
  const jsx =
    '<Column style={{width:"fill",maxWidth:936}}><Text>Our plans</Text></Column>'
  const b = buildWrite(doc0, registry, { page: 'home', jsx })
  assert.ok(b.ok, b.ok ? '' : JSON.stringify(b.problems))
  assert.deepEqual(b.errors, [])
  const planned = plan(doc0, registry, {
    site: 's',
    baseRevision: 0,
    key: 'k',
    ops: b.ops as never,
  })
  assert.ok(planned.ok, planned.ok ? '' : JSON.stringify(planned.problems))
  const doc = planned.doc
  assert.equal(doc.centreMaxWidth, true)
  const main = doc.pages[0]!.root.children![0]!
  assert.equal((main.slot as { align?: string }).align, 'stretch') // what the page really holds
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
    await page.setViewport(1280, 900)
    const raw = await page.evaluate<{
      nodes: { id: string; box: { x: number; w: number } | null }[]
    }>(`(${PROBE_SCRIPT})(document, window, 1280)`)
    const box = raw.nodes.find(n => n.id === main.id)!.box!
    assert.equal(box.w, 936)
    assert.ok(Math.abs(box.x - (1280 - 936) / 2) <= 1, `x ${box.x}`)
  } finally {
    await page.close()
  }
})
