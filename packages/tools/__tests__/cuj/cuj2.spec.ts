import test from 'node:test'
import assert from 'node:assert/strict'
import { diffSites } from '@culmjs/core'
import { memoryTarget, folderTarget, type Target } from './kit.ts'

const home = { page: 'home' }

/** CUJ 2: the template at revision N, one component on three pages; a batch adds a page and changes the component; a second caller at N is refused; restore. */
async function journey(t: Target) {
  const before = await t.doc()
  const cid = before.components![0]!.id
  assert.equal(cid, 'visitcard')
  const n = (await t.call('describe')).json.revision as number

  const other = await t.another()
  const ops = [
    { op: 'addPage', title: 'News', slug: '/news', page: 'news', inMenu: true },
    {
      op: 'setText',
      tree: { component: cid },
      id: 'cardheading',
      text: 'Visit us today',
    },
  ]
  const first = await t.call('apply', { baseRevision: n, key: 'cuj2', ops })
  assert.equal(first.error, false, JSON.stringify(first.json))
  assert.equal(first.json.revision, n + 1)
  assert.deepEqual([...first.json.pages].sort(), [
    'about',
    'home',
    'menu',
    'news',
  ])
  assert.ok(first.json.changed.some((c: string) => c.endsWith(':cardheading')))
  assert.ok(
    first.json.roots.some((r: string) => r.startsWith('news:')),
    JSON.stringify(first.json.roots),
  )

  // diff: the menu entry is a site-level change; the trees are the new page and the component only
  const diff = await t.call('diff', { from: n })
  assert.equal(diff.error, false)
  assert.deepEqual(diff.json.site, ['pages.news'])
  assert.deepEqual([...diff.json.pages].sort(), [
    'about',
    'home',
    'menu',
    'news',
  ])
  assert.deepEqual(
    diff.json.trees.map((x: { tree: unknown }) => x.tree),
    [{ page: 'news' }, { component: cid }],
  )
  assert.deepEqual(
    diff.json.trees[1].changed.map((c: { id: string }) => c.id),
    ['cardheading'],
  )
  const touched = diff.json.trees.flatMap(
    (x: {
      added: string[]
      removed: string[]
      moved: string[]
      changed: { id: string }[]
    }) => [...x.added, ...x.removed, ...x.moved, ...x.changed.map(c => c.id)],
  )
  assert.deepEqual(touched.sort(), ['cardheading', 'n1'])

  // a second caller still at N is refused, and the head stays at N+1
  const late = await other('apply', {
    baseRevision: n,
    key: 'late',
    ops: [{ op: 'setText', tree: home, id: 'homehero.title', text: 'Late' }],
  })
  assert.equal(late.error, true)
  assert.equal(late.json.problems[0].code, 'REVISION_CONFLICT')
  assert.equal((await t.call('describe')).json.revision, n + 1)

  // restore to N: revision N+2 whose content equals N
  const restored = await t.call('restore', {
    to: n,
    baseRevision: n + 1,
    key: 'back',
  })
  assert.equal(restored.error, false, JSON.stringify(restored.json))
  assert.equal(restored.json.revision, n + 2)
  const now = await t.doc()
  assert.deepEqual(now, before)
  const d = diffSites(before, now)
  assert.ok(
    d.ok && d.site.length === 0 && d.pages.length === 0 && d.trees.length === 0,
  )
}

test('CUJ 2 on the memory store with a registry built in code', async () => {
  const t = await memoryTarget(d => d)
  await journey(t)
})

test('CUJ 2 on a folder made by init', async () => {
  const t = await folderTarget()
  const before = await t.files!()
  await journey(t)
  assert.deepEqual(await t.files!(), before)
})
