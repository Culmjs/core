import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse } from 'jsonc-parser'
import { compileSite } from '@culmjs/core'
import { copyFixture } from '../fixtures.ts'
import { openProject } from '../../src/folder/project.ts'
import { buildSite } from '../../src/build/bundle.ts'
import { folderMcpOptions } from '../../src/cli/main.ts'
import { createMcpServer } from '../../src/mcp/server.ts'
import { startFake } from '../fakeSources.ts'
import { connectClient, files, serve } from './serve.ts'

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

  const { call } = await serve(dir)
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
  const roots = applied.json.roots as string[]
  for (const r of ['header:top1', 'home:hero1', 'home:grid1'])
    assert.ok(roots.includes(r), `roots: ${r}`)
  const made = await call('diff', { from: n, to: n + 1 })
  const created = made.json.trees.flatMap(
    (x: { tree: unknown; added: string[] }) =>
      x.added.map(id => ({ tree: x.tree, id })),
  ) as { tree: unknown; id: string }[]

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
        id: 'hero1.title',
        text: 'Warm from the oven',
      },
      { op: 'setText', tree: home, id: 'grid1.heading', text: 'Today' },
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
  assert.ok(first.json.changed.some((c: string) => c.endsWith(':heading')))

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

// ---- fetched fonts (a local fake of the Google Fonts endpoints; no network)
const fake = await startFake()
after(() => fake.close())
const slabOps = (look: Record<string, unknown>, extra: object = {}) => [
  { op: 'setFonts', fonts: [{ google: 'Roboto Slab', ...extra }] },
  { op: 'setLook', look: { ...look, headingFont: 'up:roboto-slab' } },
]
const isDir = (p: string) =>
  stat(p).then(
    s => s.isDirectory(),
    () => false,
  )

test('apply with a google font commits up:roboto-slab; plan with the same batch fetches and commits nothing', async () => {
  const dir = await copyFixture('site-basic')
  const { call, project } = await serve(dir, undefined, { hosts: fake.hosts })
  const look = project.loaded.doc!.look as unknown as Record<string, unknown>
  const n = (await call('describe')).json.revision as number
  const planned = await call('plan', { baseRevision: n, ops: slabOps(look) })
  assert.equal(planned.error, false, JSON.stringify(planned.json))
  assert.equal((await call('describe')).json.revision, n)
  assert.ok(await isDir(join(dir, 'fonts/roboto-slab')))
  assert.ok(!(await readFile(join(dir, 'site.json'), 'utf8')).includes('up:'))
  const r = await call('apply', {
    baseRevision: n,
    key: 'f1',
    ops: slabOps(look),
  })
  assert.equal(r.error, false, JSON.stringify(r.json))
  const site = parse(await readFile(join(dir, 'site.json'), 'utf8'))
  assert.deepEqual(site.fonts, ['up:roboto-slab'])
  assert.equal(site.look.headingFont, 'up:roboto-slab')
})

test('a failed fetch leaves the revision as it was, and the retry against a healthy fake succeeds', async () => {
  const dir = await copyFixture('site-basic')
  const { call, project } = await serve(dir, undefined, { hosts: fake.hosts })
  const look = project.loaded.doc!.look as unknown as Record<string, unknown>
  const n = (await call('describe')).json.revision as number
  const before = await files(dir)
  fake.fail('/gh/ofl/robotoslab/OFL.txt', 'drop')
  const bad = await call('apply', {
    baseRevision: n,
    key: 'f2',
    ops: slabOps(look),
  })
  assert.equal(bad.error, true)
  assert.equal(bad.json.problems[0].code, 'FETCH_FAILED')
  assert.equal((await call('describe')).json.revision, n)
  assert.deepEqual(await files(dir), before)
  assert.ok(!(await isDir(join(dir, 'fonts'))))
  fake.heal()
  const ok = await call('apply', {
    baseRevision: n,
    key: 'f2',
    ops: slabOps(look),
  })
  assert.equal(ok.error, false, JSON.stringify(ok.json))
  assert.equal(ok.json.revision, n + 1)
})

test('apply, restore to before, apply 400 and 700: restore keeps the files, build has no problem', async () => {
  const dir = await copyFixture('site-basic')
  const { call, project } = await serve(dir, undefined, { hosts: fake.hosts })
  const look = project.loaded.doc!.look as unknown as Record<string, unknown>
  const n = (await call('describe')).json.revision as number
  const a = await call('apply', {
    baseRevision: n,
    key: 'r1',
    ops: slabOps(look, { weights: [400] }),
  })
  assert.equal(a.error, false, JSON.stringify(a.json))
  const back = await call('restore', { to: n, baseRevision: n + 1, key: 'r2' })
  assert.equal(back.error, false, JSON.stringify(back.json))
  assert.deepEqual(
    await readdir(join(dir, 'fonts/roboto-slab')),
    ['400.woff2', 'LICENSE', 'font.json'].sort(),
  )
  fake.hits.length = 0
  const b = await call('apply', {
    baseRevision: n + 2,
    key: 'r3',
    ops: slabOps(look),
  })
  assert.equal(b.error, false, JSON.stringify(b.json))
  assert.match(
    fake.hits.find(h => h.startsWith('/css2'))!,
    /wght@0,400;0,700/,
  )
  assert.deepEqual((await readdir(join(dir, 'fonts/roboto-slab'))).sort(), [
    '400-700.woff2',
    'LICENSE',
    'font.json',
  ])
  assert.deepEqual(await readdir(join(dir, 'fonts')), ['roboto-slab'])
  const built = await buildSite(await openProject(dir))
  assert.ok(built.ok, JSON.stringify(built))
})

test('a server with no fetch hook refuses a {google} entry with the folder-site sentence', async () => {
  const dir = await copyFixture('site-basic')
  const project = await openProject(dir)
  const call = await connectClient(
    createMcpServer({
      ...(await folderMcpOptions(dir, project)),
      fetch: undefined,
    }),
  )
  const n = (await call('describe')).json.revision as number
  const r = await call('apply', {
    baseRevision: n,
    key: 'nf',
    ops: [{ op: 'setFonts', fonts: [{ google: 'Roboto Slab' }] }],
  })
  assert.equal(r.error, true)
  assert.match(
    JSON.stringify(r.json),
    /a folder site names a Google family as \{google\}/,
  )
  assert.ok(!(await isDir(join(dir, 'fonts'))))
})

test('apply with a stale base revision is REVISION_CONFLICT and fetches nothing', async () => {
  const dir = await copyFixture('site-basic')
  const { call } = await serve(dir, undefined, { hosts: fake.hosts })
  const n = (await call('describe')).json.revision as number
  fake.hits.length = 0
  const r = await call('apply', {
    baseRevision: n + 5,
    key: 'stale',
    ops: [{ op: 'setFonts', fonts: [{ google: 'Roboto Slab' }] }],
  })
  assert.equal(r.error, true)
  assert.equal(r.json.problems[0].code, 'REVISION_CONFLICT')
  assert.deepEqual(fake.hits, [])
})

test('the same apply retried with the same key after commit returns the original result, and a stale revision with a new key is still a conflict', async () => {
  const dir = await copyFixture('site-basic')
  const { call } = await serve(dir, undefined, { hosts: fake.hosts })
  const n = (await call('describe')).json.revision as number
  const ops = [{ op: 'setFonts', fonts: [{ google: 'Roboto Slab' }] }]
  const first = await call('apply', { baseRevision: n, key: 'again', ops })
  assert.equal(first.error, false, JSON.stringify(first.json))
  fake.hits.length = 0
  const retry = await call('apply', { baseRevision: n, key: 'again', ops })
  assert.equal(retry.error, false, JSON.stringify(retry.json))
  assert.deepEqual(retry.json, first.json)
  assert.deepEqual(fake.hits, [])
  const stale = await call('apply', { baseRevision: n, key: 'other', ops })
  assert.equal(stale.error, true)
  assert.equal(stale.json.problems[0].code, 'REVISION_CONFLICT')
  assert.deepEqual(fake.hits, [])
})

test('a seen key with different ops that name a new font makes no fetch and is refused; a true retry still replays with no fetch', async () => {
  const dir = await copyFixture('site-basic')
  const { call } = await serve(dir, undefined, { hosts: fake.hosts })
  const n = (await call('describe')).json.revision as number
  const slab = [{ op: 'setFonts', fonts: [{ google: 'Roboto Slab' }] }]
  const first = await call('apply', { baseRevision: n, key: 'seen', ops: slab })
  assert.equal(first.error, false, JSON.stringify(first.json))
  fake.hits.length = 0
  const other = [
    { op: 'setFonts', fonts: [{ google: 'Mono Only', weights: [400] }] },
  ]
  const r = await call('apply', { baseRevision: n, key: 'seen', ops: other })
  assert.equal(r.error, true)
  assert.match(r.json.problems[0].code, /REVISION_CONFLICT|KEY_CONFLICT/)
  assert.deepEqual(fake.hits, [])
  assert.ok(!(await readdir(join(dir, 'fonts'))).includes('mono-only'))
  const retry = await call('apply', { baseRevision: n, key: 'seen', ops: slab })
  assert.deepEqual(retry.json, first.json)
  assert.deepEqual(fake.hits, [])
})

test('a reused key with other ops is KEY_CONFLICT at the head revision with no request and no write; a non-integer baseRevision is refused before any fetch; the true retry still replays', async () => {
  const dir = await copyFixture('site-basic')
  const { call } = await serve(dir, undefined, { hosts: fake.hosts })
  const n = (await call('describe')).json.revision as number
  const slab = [{ op: 'setFonts', fonts: [{ google: 'Roboto Slab' }] }]
  const first = await call('apply', { baseRevision: n, key: 'k9', ops: slab })
  assert.equal(first.error, false, JSON.stringify(first.json))
  fake.hits.length = 0
  const other = [
    { op: 'setFonts', fonts: [{ google: 'Mono Only', weights: [400] }] },
  ]
  const r = await call('apply', { baseRevision: n + 1, key: 'k9', ops: other })
  assert.equal(r.json.problems[0].code, 'KEY_CONFLICT')
  assert.deepEqual(fake.hits, [])
  assert.ok(!(await readdir(join(dir, 'fonts'))).includes('mono-only'))
  for (const tool of ['plan', 'apply'])
    for (const baseRevision of [0.5, -1, '3', null, undefined]) {
      const x = await call(tool, { baseRevision, key: 'k10', ops: other })
      assert.equal(x.error, true, `${tool} ${baseRevision}`)
      assert.equal(x.json.problems[0].code, 'INVALID_OPERATION')
      assert.equal(x.json.problems[0].path, 'baseRevision')
    }
  assert.deepEqual(fake.hits, [])
  assert.ok(!(await readdir(join(dir, 'fonts'))).includes('mono-only'))
  const retry = await call('apply', { baseRevision: n, key: 'k9', ops: slab })
  assert.deepEqual(retry.json, first.json)
  assert.deepEqual(fake.hits, [])
})
