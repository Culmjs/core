import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runChecks, type SiteDocument } from '@culmjs/core'
import { openProject } from '../../src/folder/project.ts'
import { starterFolder } from '../cuj/kit.ts'

/** The trees the template's starter-chrome names on home, after `edit` has changed its document. */
async function templateFindings(edit: (d: SiteDocument) => void) {
  const p = await openProject(await starterFolder())
  const doc = p.loaded.doc!
  edit(doc)
  return doc.pages.flatMap(pg =>
    runChecks({
      revision: 1,
      page: pg.id,
      dir: 'ltr',
      layouts: [],
      contrast: [],
      doc,
      registry: p.registry,
      loaded: { fonts: true, assets: true },
    })
      .filter(f => f.check === 'starter-chrome' && pg.id === 'home')
      .map(f => f.nodes.join()),
  )
}
const addText = (d: SiteDocument) =>
  d.pages[0]!.root.children!.push({
    id: 'mine',
    kind: 'text',
    name: 'Mine',
    slot: {},
    props: { level: 'p', runs: [{ text: 'Mine' }] },
  })

test('the template site gives no starter-chrome: it is pristine', async () => {
  assert.deepEqual(await templateFindings(() => {}), [])
})

test('the template with one added text on home gives starter-chrome on header and on footer', async () => {
  const f = await templateFindings(addText)
  assert.deepEqual(f, ['header', 'footer'])
})

test('the same with the header padding changed gives starter-chrome on footer only', async () => {
  const f = await templateFindings(d => {
    addText(d)
    d.header!.style!.base!.padding = 40
  })
  assert.deepEqual(f, ['footer'])
})

test('a header with its button removed still gives starter-chrome; a changed look does not', async () => {
  const f = await templateFindings(d => {
    addText(d)
    d.header!.children![0]!.children = d.header!.children![0]!.children!.filter(
      c => c.id !== 'header.button',
    )
  })
  assert.deepEqual(f, ['header', 'footer'])
  const g = await templateFindings(d => {
    addText(d)
    d.header!.style!.base!.bg = 'brand'
  })
  assert.deepEqual(g, ['footer'])
})
