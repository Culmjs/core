import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import type { Node, SiteDocument } from '@culmjs/core'
import { compilePage } from '@culmjs/core/compile'
import { starterFolder } from '../__tests__/cuj/kit.ts'
import { fileHashes } from '../src/build/bundle.ts'
import { readAsset } from '../src/folder/files.ts'
import { openProject, type Project } from '../src/folder/project.ts'
import { openBrowser, type Browser } from '../src/measure/browser.ts'
import { runMeasure } from '../src/measure/run.ts'

let browser: Browser
let dir: string
let project: Project
before(async () => {
  const o = await openBrowser()
  assert.ok(o.ok, o.ok ? '' : JSON.stringify(o.problems))
  browser = o.browser
  dir = await starterFolder()
  project = await openProject(dir)
  assert.deepEqual(project.loaded.problems, [])
})
after(async () => {
  await browser?.close()
})

const find = (n: Node, id: string): Node | undefined =>
  n.id === id ? n : n.children?.map(c => find(c, id)).find(Boolean)

/** The site's own document with the header menu folded on phone. */
const folded = (): SiteDocument => {
  const doc: SiteDocument = structuredClone(project.loaded.doc!)
  const nav = find(doc.header, 'header.nav')!
  nav.props = { ...nav.props, foldOn: 'phone' }
  return doc
}

/** The page's HTML in the page itself, read at each width. */
async function inPage<T>(
  doc: SiteDocument,
  widths: number[],
  script: string,
  after?: string,
): Promise<Record<number, T>> {
  const out = compilePage(doc, 'home', {
    registry: project.registry,
    mode: 'measure',
    links: { page: slug => slug, file: id => `/assets/${id}` },
  })
  assert.ok(out.ok, out.ok ? '' : JSON.stringify(out.problems))
  const page = await browser.newPage()
  const got: Record<number, T> = {}
  try {
    const html = out.html
    await page.answer(async url =>
      new URL(url).pathname === '/'
        ? { type: 'text/html; charset=utf-8', body: html }
        : undefined,
    )
    assert.ok((await page.goto('https://site.culm.invalid/', 15000)).ok)
    for (const w of widths) {
      await page.setViewport(w, 900)
      got[w] = await page.evaluate<T>(script)
      if (after) got[-w] = await page.evaluate<T>(after)
    }
  } finally {
    await page.close()
  }
  return got
}

const NAV = `const nav = document.querySelector('header nav, nav');
  const vis = e => !!e && e.checkVisibility({ visibilityProperty: true });
  const links = [...nav.querySelectorAll('a')];
  const sum = nav.querySelector('summary');`

test('at 390 the summary shows and the links are hidden until it is clicked; at 1280 and 834 the links show in a row and the summary is not shown', async () => {
  const r = await inPage<{
    summary: boolean
    links: number
    h: number
    row: boolean
  }>(
    folded(),
    [1280, 834, 390],
    `(() => { ${NAV}
      const ys = new Set(links.map(a => Math.round(a.getBoundingClientRect().top)));
      const r = sum ? sum.getBoundingClientRect() : { height: 0 };
      return { summary: vis(sum), links: links.filter(vis).length, h: r.height, row: ys.size === 1 } })()`,
  )
  for (const w of [1280, 834]) {
    assert.equal(r[w].summary, false, `${w}: no summary`)
    assert.ok(r[w].links >= 1, `${w}: links show`)
    assert.ok(r[w].row, `${w}: in a row`)
  }
  assert.equal(r[390].summary, true)
  assert.equal(r[390].links, 0)
  assert.ok(r[390].h >= 44, `summary ${r[390].h}px`)

  // click opens it, and the links are then 44 px tall; the summary takes the keyboard
  const doc = folded()
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
    await page.setViewport(390, 900)
    const after = await page.evaluate<{
      shown: number
      min: number
    }>(`(() => { ${NAV}
      sum.click();
      const v = links.filter(vis);
      return { shown: v.length, min: Math.min(...v.map(a => a.getBoundingClientRect().height)) } })()`)
    assert.ok(after.shown >= 1, 'links show once opened')
    assert.ok(after.min >= 44, `link ${after.min}px`)
    const kb = await page.evaluate<boolean>(
      `(() => { const s = document.querySelector('nav summary'); s.focus(); return document.activeElement === s })()`,
    )
    assert.ok(kb, 'the summary takes focus')
  } finally {
    await page.close()
  }
})

test('the folded template gives no class 1 or 2 finding at 1280, 834 and 390, light and dark, ltr and rtl', async () => {
  const doc = folded()
  doc.languages = [{ code: 'en' }, { code: 'ar', dir: 'rtl' }]
  const r = await runMeasure({
    doc,
    registry: project.registry,
    data: project.loaded.data,
    revision: 0,
    files: await fileHashes(dir),
    assets: p => readAsset(dir, p),
    executable: process.env.CULM_CHROME,
  })
  assert.deepEqual(r.incomplete, [])
  assert.deepEqual(
    [...new Set(r.measured.map(m => `${m.width} ${m.theme} ${m.dir}`))].sort()
      .length,
    12,
  )
  assert.deepEqual(
    r.findings.map(
      f => `${f.check} ${f.nodes} ${f.width} ${f.theme} ${f.dir}: ${f.message}`,
    ),
    [],
  )
})

test('a block hidden on base and shown on tablet is visible at 834 and 390 and not at 1280', async () => {
  const doc: SiteDocument = structuredClone(project.loaded.doc!)
  const home = doc.pages.find(p => p.id === 'home')!.root
  home.children = [
    ...home.children!,
    {
      id: 'tabonly',
      kind: 'text',
      name: 'Tablet only',
      slot: {},
      props: { level: 'p', runs: [{ text: 'Only on tablet and phone' }] },
      style: { base: { hidden: true }, tablet: { hidden: false } },
    } as Node,
  ]
  const r = await inPage<boolean>(
    doc,
    [1280, 834, 390],
    `[...document.querySelectorAll('p')].some(p => p.textContent.includes('Only on tablet') && p.getClientRects().length > 0)`,
  )
  assert.deepEqual([r[1280], r[834], r[390]], [false, true, true])
})

test('a folded menu with icons on, rows lines and a linkHover pill keeps its look at desktop and on phone', async () => {
  const styled = (fold: boolean): SiteDocument => {
    const doc = fold ? folded() : structuredClone(project.loaded.doc!)
    const nav = find(doc.header, 'header.nav')!
    nav.props = { ...nav.props, icons: 'on', rows: 'lines' }
    nav.style = {
      ...nav.style,
      base: { ...nav.style?.base, linkHover: { pill: true, bg: 'brand' } },
    } as Node['style']
    return doc
  }
  const read = `(() => { const a = document.querySelector('nav a'); const c = getComputedStyle(a);
    return { display: c.display, dir: c.flexDirection, pl: c.paddingLeft, pt: c.paddingTop, bb: c.borderBottomWidth, r: c.borderRadius } })()`
  type Look = Record<string, string>
  const plain = await inPage<Look>(styled(false), [1280], read)
  const fold = await inPage<Look>(styled(true), [1280], read)
  assert.deepEqual(
    fold[1280],
    plain[1280],
    'desktop: the same as the unfolded menu',
  )
  assert.equal(fold[1280].bb, '1px')
  // on phone the links sit in the opened panel and still carry the rows and the pill room
  const out = compilePage(styled(true), 'home', {
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
    await page.setViewport(390, 900)
    const ph = await page.evaluate<Look>(
      `(() => { document.querySelector('nav summary').click(); return ${read} })()`,
    )
    assert.equal(ph.bb, '1px')
    assert.equal(ph.pl, plain[1280].pl)
    assert.equal(ph.dir, plain[1280].dir)
  } finally {
    await page.close()
  }
})

test('a fetched icon takes the text colour in light and in dark', async () => {
  const doc: SiteDocument = structuredClone(project.loaded.doc!)
  doc.look.dark = 'auto'
  const home = doc.pages.find(p => p.id === 'home')!.root
  home.children = [
    ...home.children!,
    {
      id: 'fetched',
      kind: 'icon',
      name: 'Fetched',
      slot: {},
      props: { name: 'lucide:camera' },
    } as Node,
  ]
  const icons = {
    'lucide:camera':
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h3l2-3h6l2 3h3v13H4z"/></g></svg>',
  }
  const out = compilePage(doc, 'home', {
    registry: project.registry,
    mode: 'measure',
    links: { page: slug => slug, file: id => `/assets/${id}` },
    icons,
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
    const read = `(() => { const s = document.querySelector('span svg g path, a svg g path');
      const svg = s.closest('svg'); const box = svg.getBoundingClientRect();
      return { stroke: getComputedStyle(s).stroke, color: getComputedStyle(svg).color, w: box.width, h: box.height } })()`
    const seen: Record<
      string,
      { stroke: string; color: string; w: number; h: number }
    > = {}
    for (const scheme of ['light', 'dark'] as const) {
      await page.setScheme(scheme)
      seen[scheme] = await page.evaluate(read)
      assert.equal(seen[scheme]!.stroke, seen[scheme]!.color, scheme)
      assert.ok(seen[scheme]!.w > 0 && seen[scheme]!.h > 0, scheme)
    }
    assert.notEqual(seen.light!.color, seen.dark!.color)
  } finally {
    await page.close()
  }
})

test('a fetched icon with no fill is drawn in the text colour in dark mode', async () => {
  const doc: SiteDocument = structuredClone(project.loaded.doc!)
  doc.look.dark = 'auto'
  const home = doc.pages.find(p => p.id === 'home')!.root
  home.children = [
    ...home.children!,
    {
      id: 'nofill',
      kind: 'icon',
      name: 'No fill',
      slot: {},
      props: { name: 'fa6-brands:github' },
    } as Node,
  ]
  const out = compilePage(doc, 'home', {
    registry: project.registry,
    mode: 'measure',
    links: { page: slug => slug, file: id => `/assets/${id}` },
    icons: {
      'fa6-brands:github':
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M2 2h20v20H2z"/></svg>',
    },
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
    await page.setScheme('dark')
    const r = await page.evaluate<{ fill: string; color: string }>(
      `(() => { const p = document.querySelector('svg path[d="M2 2h20v20H2z"]'); const s = p.closest('svg');
        return { fill: getComputedStyle(p).fill, color: getComputedStyle(s).color } })()`,
    )
    assert.equal(r.fill, r.color)
    assert.notEqual(r.fill, 'rgb(0, 0, 0)')
  } finally {
    await page.close()
  }
})
