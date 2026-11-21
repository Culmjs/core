import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse } from 'jsonc-parser'
import { compileSite } from '@culmjs/core'
import { copyFixture } from '../fixtures.ts'
import { openProject } from '../../src/folder/project.ts'
import { files, serve } from './serve.ts'

const home = { page: 'home' }

test('CUJ 1 on a folder', async () => {
  const dir = await copyFixture('site-basic')
  // start: no header block and no children on the home page
  const site = await readFile(join(dir, 'site.json'), 'utf8')
  await writeFile(
    join(dir, 'site.json'),
    site.replace(
      '"header": { "block": "top" }',
      '"header": { "id": "hdr", "kind": "row", "name": "Header" }',
    ),
  )
  const homeText = await readFile(join(dir, 'pages/home.json'), 'utf8')
  const emptied = homeText.replace(
    /"children": \[[^]*\]\s*\}\s*\}\s*$/,
    '"children": []\n  }\n}\n',
  )
  assert.notEqual(emptied, homeText)
  await writeFile(join(dir, 'pages/home.json'), emptied)

  const { call, project } = await serve(dir)
  const d = await call('describe')
  const n = d.json.revision as number
  assert.equal(d.json.folder, true)

  const blocks = await call('catalogue', { what: 'blocks' })
  assert.equal(blocks.error, false)
  for (const b of ['top', 'hero', 'cards'])
    assert.ok(JSON.stringify(blocks.json).includes(`"${b}"`), b)
  const sources = await call('catalogue', { what: 'sources' })
  assert.ok(JSON.stringify(sources.json).includes('"menu"'))

  const ops = [
    {
      op: 'insertBlock',
      tree: 'header',
      parent: 'hdr',
      index: 0,
      block: 'top',
      look: 'plain',
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
      block: 'cards',
      look: 'plain',
      id: 'grid1',
      settings: { heading: 'Our menu' },
    },
    {
      op: 'bindData',
      tree: home,
      id: 'grid1.list',
      repeat: { source: 'menu', max: 4 },
    },
  ]
  const planned = await call('plan', { baseRevision: n, ops })
  assert.equal(planned.error, false, JSON.stringify(planned.json))
  const applied = await call('apply', { baseRevision: n, key: 'cuj1', ops })
  assert.equal(applied.error, false, JSON.stringify(applied.json))
  assert.equal(applied.json.revision, n + 1)
  const created = applied.json.created as { tree: unknown; id: string }[]
  for (const id of ['top1', 'hero1', 'grid1', 'grid1.list', 'hero1.title'])
    assert.ok(
      created.some(c => c.id === id),
      `created: ${id}`,
    )

  // the files: the header in site.json, the two blocks in home.json, each with a written id
  const onDisk = await files(dir)
  const header = parse(onDisk['site.json']!).header.children[0]
  const kids = parse(onDisk['pages/home.json']!).root.children
  assert.equal(kids.length, 2)
  for (const k of [header, ...kids]) {
    assert.equal(typeof k.id, 'string', JSON.stringify(k))
    assert.ok(typeof k.block === 'string' || typeof k.kind === 'string')
  }
  assert.deepEqual(
    [header.id, ...kids.map((k: { id: string }) => k.id)],
    ['top1', 'hero1', 'grid1'],
  )

  // the folder as it is now compiles within every ceiling, with the base script only
  const now = await openProject(dir)
  assert.deepEqual(now.loaded.problems, [])
  const compiled = compileSite(now.loaded.doc!, {
    registry: now.registry,
    data: now.loaded.data,
    links: now.links,
  })
  assert.deepEqual(compiled.problems, [])
  assert.deepEqual(
    compiled.manifest.scripts.map(s => s.name),
    ['base'],
  )
  const page = compiled.files.find(f => f.path === 'index.html')!.content
  for (const name of ['Sourdough', 'Croissant', 'Cinnamon bun', 'Lemon cake'])
    assert.ok(page.includes(name), name)
  assert.equal(project.loaded.doc !== undefined, true)

  // every created id is read back, and a second batch against the new revision is accepted
  for (const c of created) {
    const r = await call('read', { what: 'node', tree: c.tree, id: c.id })
    assert.equal(r.error, false, `${c.id}: ${JSON.stringify(r.json)}`)
  }
  const second = await call('apply', {
    baseRevision: n + 1,
    key: 'cuj1b',
    ops: [
      {
        op: 'setText',
        tree: home,
        id: 'hero1.lead',
        text: 'Warm from the oven',
      },
    ],
  })
  assert.equal(second.error, false, JSON.stringify(second.json))
  assert.equal(second.json.revision, n + 2)
})

test('CUJ 2 on a folder', async () => {
  const dir = await copyFixture('site-basic')
  const { call, project } = await serve(dir)
  const cid = project.loaded.doc!.components![0]!.id
  const n = (await call('describe')).json.revision as number
  const before = await files(dir)

  const ops = [
    { op: 'addPage', title: 'News', slug: '/news', page: 'news', inMenu: true },
    {
      op: 'setText',
      tree: { component: cid },
      id: 'heading',
      text: 'Visit us today',
    },
  ]
  const first = await call('apply', { baseRevision: n, key: 'cuj2', ops })
  assert.equal(first.error, false, JSON.stringify(first.json))
  assert.equal(first.json.revision, n + 1)
  assert.deepEqual([...first.json.pages].sort(), [
    'about',
    'home',
    'menu',
    'news',
  ])
  assert.ok(first.json.changed.some((c: { id: string }) => c.id === 'heading'))

  // diff: the menu entry is a site-level change; the trees are the new page and the component only
  const diff = await call('diff', { from: n })
  assert.equal(diff.error, false)
  assert.deepEqual(diff.json.site, ['pages.news'])
  assert.deepEqual([...diff.json.pages].sort(), [
    'about',
    'home',
    'menu',
    'news',
  ])
  const touched = diff.json.trees.flatMap(
    (t: {
      added: string[]
      removed: string[]
      moved: string[]
      changed: { id: string }[]
    }) => [...t.added, ...t.removed, ...t.moved, ...t.changed.map(c => c.id)],
  )
  assert.deepEqual(touched.sort(), ['heading', 'n1'])
  assert.deepEqual(
    diff.json.trees.map((t: { tree: unknown }) => t.tree),
    [{ page: 'news' }, { component: cid }],
  )
  assert.deepEqual(
    diff.json.trees[1].changed.map((c: { id: string }) => c.id),
    ['heading'],
  )

  // the files: the page is new, the piece changed, the three pages that use it are untouched
  const after1 = await files(dir)
  assert.ok('pages/news.json' in after1)
  assert.notEqual(
    after1['pieces/visit-card.json'],
    before['pieces/visit-card.json'],
  )
  for (const f of ['pages/home.json', 'pages/menu.json', 'pages/about.json'])
    assert.equal(after1[f], before[f], f)

  // a second client, still at N, is refused and the files stay as they are
  const other = await serve(dir)
  const late = await other.call('apply', {
    baseRevision: n,
    key: 'late',
    ops: [{ op: 'setText', tree: home, id: 'intro', text: 'Late' }],
  })
  assert.equal(late.error, true)
  assert.equal(late.json.problems[0].code, 'REVISION_CONFLICT')
  assert.deepEqual(await files(dir), after1)

  // restore to N: revision N+2, every file as at N
  const restored = await call('restore', {
    to: n,
    baseRevision: n + 1,
    key: 'back',
  })
  assert.equal(restored.error, false, JSON.stringify(restored.json))
  assert.equal(restored.json.revision, n + 2)
  assert.deepEqual(await files(dir), before)
})
