import test from 'node:test'
import assert from 'node:assert/strict'
import type { SiteDocument } from '@culmjs/core'
import { starterFolder, edit } from '../__tests__/cuj/kit.ts'
import { fileHashes } from '../src/build/bundle.ts'
import { readAsset } from '../src/folder/files.ts'
import { openProject } from '../src/folder/project.ts'
import { runMeasure } from '../src/measure/run.ts'

/** The template of a new site, measured as `culm check` measures it (class 1 and 2 findings). */
async function measure(
  dir: string,
  change: (doc: SiteDocument) => void = () => {},
  options: { widths?: number[] } = {},
) {
  const project = await openProject(dir)
  assert.deepEqual(project.loaded.problems, [])
  const doc = project.loaded.doc!
  change(doc)
  return runMeasure({
    doc,
    registry: project.registry,
    data: project.loaded.data,
    revision: 0,
    files: await fileHashes(dir),
    assets: p => readAsset(dir, p),
    executable: process.env.CULM_CHROME,
    ...options,
  })
}
const clean = (r: Awaited<ReturnType<typeof measure>>) => {
  assert.deepEqual(r.incomplete, [])
  assert.deepEqual(r.blocked, [])
  assert.deepEqual(
    r.findings.map(
      f => `${f.check} ${f.nodes} ${f.width} ${f.theme} ${f.dir}: ${f.message}`,
    ),
    [],
  )
}

test('the template has no class 1 or 2 finding at 1280, 834 and 390, in light and dark', async () => {
  const r = await measure(await starterFolder())
  assert.deepEqual(
    [...new Set(r.measured.map(m => `${m.width} ${m.theme}`))].sort(),
    [
      '1280 dark',
      '1280 light',
      '390 dark',
      '390 light',
      '834 dark',
      '834 light',
    ],
  )
  assert.equal(new Set(r.measured.map(m => m.page)).size, 4)
  clean(r)
})

test('with languages [{ code: "ar", dir: "rtl" }] it has none in either direction', async () => {
  // the site's own language stays: the run measures every direction the site declares
  const r = await measure(await starterFolder(), doc => {
    doc.languages = [{ code: 'en' }, { code: 'ar', dir: 'rtl' }]
  })
  assert.deepEqual([...new Set(r.measured.map(m => m.dir))].sort(), [
    'ltr',
    'rtl',
  ])
  clean(r)
  const only = await measure(await starterFolder(), doc => {
    doc.languages = [{ code: 'ar', dir: 'rtl' }]
  })
  assert.deepEqual([...new Set(only.measured.map(m => m.dir))], ['rtl'])
  clean(only)
})

test('with a 120-character hero title and a 60-character button label it has none at 390', async () => {
  const dir = await starterFolder()
  const title =
    'Sourdough and croissants and cinnamon buns and cake and rolls, baked fresh on the corner every single morning of the week'.slice(
      0,
      120,
    )
  const label =
    'Order your bread for tomorrow morning from the corner oven!!'.slice(0, 60)
  assert.equal(title.length, 120)
  assert.equal(label.length, 60)
  await edit(dir, 'pages/home.json', ['root', 'children', 0, 'title'], title)
  await edit(
    dir,
    'pages/home.json',
    ['root', 'children', 0, 'buttonLabel'],
    label,
  )
  const r = await measure(dir, () => {}, { widths: [390] })
  assert.deepEqual([...new Set(r.measured.map(m => m.width))], [390])
  clean(r)
})
