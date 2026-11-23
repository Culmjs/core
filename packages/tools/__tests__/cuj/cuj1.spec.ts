import test from 'node:test'
import assert from 'node:assert/strict'
import { compileSite, emptySite } from '@culmjs/core'
import { LOOK, STYLES } from '@culmjs/starter'
import { edit, folderTarget, memoryTarget, type Target } from './kit.ts'

const home = { page: 'home' }
const HEADER_ROOT = { memory: 'header', folder: 'hdr' }

/** CUJ 1: a product builds a site from its catalogue: header, hero and card grid, the grid on `menu`. */
async function journey(t: Target, headerRoot: string) {
  const d = await t.call('describe')
  const n = d.json.revision as number

  const blocks = await t.call('catalogue', { what: 'blocks' })
  assert.equal(blocks.error, false)
  for (const b of ['page-header', 'hero', 'card-grid'])
    assert.ok(JSON.stringify(blocks.json).includes(`"${b}"`), b)
  const sources = await t.call('catalogue', { what: 'sources' })
  assert.ok(JSON.stringify(sources.json).includes('"menu"'))

  const ops = [
    {
      op: 'insertBlock',
      tree: 'header',
      parent: headerRoot,
      index: 0,
      block: 'page-header',
      look: 'bar',
      id: 'top1',
    },
    {
      op: 'insertBlock',
      tree: home,
      parent: 'homeroot',
      index: 0,
      block: 'hero',
      look: 'plain',
      id: 'hero1',
      settings: { title: 'Fresh bread' },
    },
    {
      op: 'insertBlock',
      tree: home,
      parent: 'homeroot',
      index: 1,
      block: 'card-grid',
      look: 'cards',
      id: 'grid1',
      settings: { heading: 'Our menu' },
    },
    {
      op: 'setBlockSetting',
      tree: home,
      id: 'grid1',
      key: 'source',
      value: 'menu',
    },
  ]
  const planned = await t.call('plan', { baseRevision: n, ops })
  assert.equal(planned.error, false, JSON.stringify(planned.json))
  const applied = await t.call('apply', { baseRevision: n, key: 'cuj1', ops })
  assert.equal(applied.error, false, JSON.stringify(applied.json))
  assert.equal(applied.json.revision, n + 1)
  const roots = applied.json.roots as string[]
  for (const r of ['header:top1', 'home:hero1', 'home:grid1'])
    assert.ok(roots.includes(r), `roots: ${r}`)
  const made = await t.call('diff', { from: n, to: n + 1 })
  const created = made.json.trees.flatMap(
    (x: { tree: unknown; added: string[] }) =>
      x.added.map(id => ({ tree: x.tree, id })),
  ) as { tree: unknown; id: string }[]
  assert.equal(created.length, applied.json.counts.created)

  // the site as it is now: within every ceiling, the base script only, and the grid shows the rows
  const doc = await t.doc()
  const compiled = compileSite(doc, {
    registry: t.registry,
    data: t.data,
    links: t.links,
  })
  assert.deepEqual(compiled.problems, [])
  assert.deepEqual(
    compiled.manifest.scripts.map(s => s.name),
    ['base'],
  )
  const page = compiled.files.find(f => f.path === 'index.html')!.content
  const rows = (t.data.rows as { menu: { name: string }[] }).menu
  assert.ok(rows.length > 0)
  for (const r of rows.slice(0, 6)) assert.ok(page.includes(r.name), r.name)

  // every created id is read back, and a second batch against the new revision is accepted
  for (const c of created) {
    const r = await t.call('read', { what: 'node', tree: c.tree, id: c.id })
    assert.equal(r.error, false, `${c.id}: ${JSON.stringify(r.json)}`)
  }
  const second = await t.call('apply', {
    baseRevision: n + 1,
    key: 'cuj1b',
    ops: created.map(c => ({
      op: 'setProps',
      tree: c.tree,
      id: c.id,
      props: {},
      name: `Changed ${c.id}`,
    })),
  })
  assert.equal(second.error, false, JSON.stringify(second.json))
  assert.equal(second.json.revision, n + 2)
  assert.equal(second.json.counts.changed, created.length)
  for (const c of created) {
    const r = await t.call('read', { what: 'node', tree: c.tree, id: c.id })
    assert.equal(r.error, false, `${c.id}: ${JSON.stringify(r.json)}`)
    assert.ok(JSON.stringify(r.json).includes(`Changed ${c.id}`), c.id)
  }
  return { n, doc }
}

test('CUJ 1 on the memory store with a registry built in code', async () => {
  const t = await memoryTarget(() => {
    const doc = emptySite('Bakery', LOOK)
    doc.styles = STYLES
    return doc
  })
  const { n } = await journey(t, HEADER_ROOT.memory)
  assert.equal(n, 0)
})

test('CUJ 1 on a folder made by init, with its pages emptied', async () => {
  const t = await folderTarget(async dir => {
    await edit(dir, 'site.json', ['header'], {
      id: 'hdr',
      kind: 'row',
      name: 'Header',
    })
    for (const p of ['home', 'menu', 'about', 'visit'])
      await edit(dir, `pages/${p}.json`, ['root', 'children'], [])
  })
  const { doc } = await journey(t, HEADER_ROOT.folder)
  const onDisk = await t.files!()
  assert.ok(onDisk['pages/home.json']!.includes('"id": "grid1"'))
  assert.equal(doc.pages.find(p => p.id === 'home')!.root.children!.length, 2)
})
