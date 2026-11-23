import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { walk, type SiteDocument } from '@culmjs/core'
import { plan } from '@culmjs/core/ops'
import { GUIDE } from '../../core/src/ops/guide.ts'
import { RECIPES } from '../../core/src/ops/recipes.ts'
import { starterFolder } from '../__tests__/cuj/kit.ts'
import { fileHashes } from '../src/build/bundle.ts'
import { readAsset } from '../src/folder/files.ts'
import { copyFixture } from '../__tests__/fixtures.ts'
import { openProject, type Project } from '../src/folder/project.ts'
import { openBrowser, type Browser } from '../src/measure/browser.ts'
import { runMeasure } from '../src/measure/run.ts'

let browser: Browser
let project: Project
let dir: string
let sites: Record<string, { project: Project; dir: string }>
before(async () => {
  const o = await openBrowser()
  assert.ok(o.ok, o.ok ? '' : JSON.stringify(o.problems))
  browser = o.browser
  dir = await copyFixture('site-basic')
  project = await openProject(dir)
  const tdir = await starterFolder()
  sites = {
    'site-basic': { project, dir },
    template: { project: await openProject(tdir), dir: tdir },
  }
})
after(async () => {
  await browser?.close()
})

const ids = (doc: SiteDocument) => {
  const out = new Set<string>()
  for (const p of doc.pages) walk(p.root, n => void out.add(n.id))
  return out
}

// Review Focus 4: each recipe in light and dark, left to right and right to left, at the three widths.
for (const site of ['site-basic', 'template'] as const)
  for (const recipe of RECIPES)
    test(`${site}: ${recipe.id} at 1280, 834 and 390, light and dark, ltr and rtl: no class 1 or 2 finding on its nodes`, async () => {
      const sd = sites[site]!
      const { project, dir } = sd
      const base: SiteDocument = structuredClone(project.loaded.doc!)
      // the site's own header and footer, so starter-chrome is not the recipe's
      if (site === 'template')
        for (const n of [base.header, base.footer])
          n.style = {
            ...n.style,
            base: { ...n.style?.base, padding: [20, 16, 20, 16] },
          }
      base.languages = [{ code: 'en' }, { code: 'ar', dir: 'rtl' }]
      const first = base.pages[0]!
      const p = plan(base, project.registry, {
        site: 's',
        baseRevision: 0,
        key: 'k',
        ops: structuredClone(recipe.ops).map((o, i) =>
          i ? o : { ...o, tree: { page: first.id }, parent: first.root.id },
        ) as never,
      } as never)
      assert.ok(p.ok, p.ok ? '' : JSON.stringify(p.problems))
      const before = ids(base)
      const mine = [...ids(p.doc)].filter(x => !before.has(x))
      assert.ok(mine.length > 0)
      const measure = (doc: SiteDocument) =>
        runMeasure({
          doc,
          registry: project.registry,
          data: project.loaded.data,
          revision: 0,
          browser,
          pages: [first.id],
          assets: async a => readFile(join(dir, a)).catch(() => undefined),
        })
      const r = await measure(p.doc)
      const baseline = await measure(base)
      assert.deepEqual(r.incomplete, [])
      assert.equal(r.measured.length, 3 * 2 * 2)
      // Any class 1 or 2 finding the page did not already have, even one with no node (h-scroll).
      const sig = (f: (typeof r.findings)[number]) =>
        `${f.check} ${f.nodes} ${f.width} ${f.theme} ${f.dir}`
      const had = new Set(baseline.findings.map(sig))
      // site-basic's own top bar sits at 0 px, so its header-edge is the fixture's, not the recipe's
      const bad = r.findings.filter(
        f =>
          f.class <= 2 &&
          !had.has(sig(f)) &&
          !(site === 'site-basic' && f.check === 'header-edge'),
      )
      assert.deepEqual(
        bad.map(f => `${sig(f)} ${f.message}`),
        [],
      )
    })

// The template as `culm init` makes it, with a batch applied to its home page (or a change made to its document first).
async function onTemplate(
  ops: unknown[],
  change: (d: SiteDocument) => void = () => {},
) {
  const tdir = await starterFolder()
  const tp = await openProject(tdir)
  const base: SiteDocument = structuredClone(tp.loaded.doc!)
  // the site's own header and footer, so starter-chrome is not the batch's to answer for
  for (const n of [base.header, base.footer])
    n.style = {
      ...n.style,
      base: { ...n.style?.base, padding: [20, 16, 20, 16] },
    }
  base.languages = [{ code: 'en' }, { code: 'ar', dir: 'rtl' }]
  change(base)
  const first = base.pages[0]!
  const batch = (extra: unknown[]) => ({
    site: 's',
    baseRevision: 0,
    key: 'k',
    ops: extra as never,
  })
  const measure = async (doc: SiteDocument) =>
    runMeasure({
      doc,
      registry: tp.registry,
      data: tp.loaded.data,
      revision: 0,
      files: await fileHashes(tdir),
      assets: p => readAsset(tdir, p),
      executable: process.env.CULM_CHROME,
    })
  const p = plan(base, tp.registry, batch(ops) as never)
  assert.ok(p.ok, p.ok ? '' : JSON.stringify(p.problems))
  return {
    first,
    before: await measure(base),
    after: await measure(p.doc),
  }
}
const low = (r: {
  findings: { class: number; check: string; message: string; nodes: unknown }[]
}) =>
  r.findings
    .filter(f => f.class <= 2)
    .map(f => `${f.check} ${f.nodes} ${f.message}`)
const recipe = (id: string) =>
  structuredClone(RECIPES.find(r => r.id === id)!.ops)
const atHome = (ops: unknown[]) =>
  (ops as Record<string, unknown>[]).map((o, i) =>
    i ? o : { ...o, tree: { page: 'home' }, parent: 'homeroot' },
  )

test('hero as the first section of a template page gives no hero-bare, bleed-gutter or orphan-heading', async () => {
  const r = await onTemplate(atHome(recipe('hero')))
  assert.deepEqual(low(r.before), [])
  assert.deepEqual(low(r.after), [])
})

test('split on an all-stacked page clears all-stacked', async () => {
  const stack = (d: SiteDocument) => {
    const col = (id: string) => ({
      id,
      kind: 'column',
      name: 'Band',
      slot: {},
      style: { base: { padding: [48, 16, 48, 16] } },
      children: [
        {
          id: `${id}t`,
          kind: 'text',
          name: 'Text',
          slot: {},
          props: { level: 'p', runs: [{ text: 'A few plain words.' }] },
        },
      ],
    })
    d.pages[0]!.root.children = [col('sa'), col('sb'), col('sc')] as never
  }
  const at = atHome(recipe('split')) as { index: number }[]
  at[0]!.index = 1 // below the first section, where no-accent reads
  const r = await onTemplate(at, stack)
  assert.ok(
    low(r.before).some(m => m.startsWith('all-stacked')),
    'all-stacked is there to clear',
  )
  assert.deepEqual(
    low(r.after).filter(m => m.startsWith('all-stacked')),
    [],
  )
  assert.deepEqual(low(r.after), [])
})

test("the guide's shortest hero batch, applied to a template page, gives no class 1 or 2 finding", async () => {
  const row = GUIDE.find(g => g.startsWith('Shortest shape behind a hero'))!
  // verbatim: only the page root id is filled in
  const batch = row
    .slice(row.indexOf('{op:"add"'), row.lastIndexOf('}}.') + 2)
    .replace(/([{,])([a-zA-Z]+):/g, '$1"$2":')
    .replace('<page root id>', 'homeroot')
  const op = JSON.parse(batch)
  const r = await onTemplate([op])
  assert.equal(r.after.measured.length, 4 * 12) // four pages, 12 cells each
  assert.deepEqual(low(r.after), [])
})

test('hero, split and cta-band together on the template: no class 1 or 2 finding at 12 cells', async () => {
  const ops = ['hero', 'split', 'cta-band'].flatMap((id, i) =>
    (recipe(id) as Record<string, unknown>[]).map(o => ({
      ...o,
      tree: { page: 'home' },
      parent: 'homeroot',
      index: i,
    })),
  )
  const r = await onTemplate(ops)
  assert.deepEqual(low(r.after), [])
})
