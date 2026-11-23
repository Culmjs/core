import test from 'node:test'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { copyFixture } from '../__tests__/fixtures.ts'
import { find } from '@culmjs/core'
import { files, lineOf, serve } from '../__tests__/mcp/serve.ts'
import {
  folderTarget,
  memoryTarget,
  type Target,
} from '../__tests__/cuj/kit.ts'

const home = { page: 'home' }
const title = 'homehero.title'
const TITLE = 'Fresh bread from our corner oven, daily!'

/** CUJ 3 on the starter: the home hero title is 40 characters at size 64 with `nowrap` on its base layer, written before the journey starts. */
async function journey(t: Target) {
  const { call } = t
  const setup = await call('apply', {
    baseRevision: (await call('describe')).json.revision,
    key: 'setup',
    ops: [
      { op: 'setText', tree: home, id: title, text: TITLE },
      {
        op: 'setStyle',
        tree: home,
        id: title,
        layer: 'base',
        // Pin tracking to keep this deliberately over-wide repair fixture stable across starter looks.
        decl: { size: 64, letterSpacing: 0, nowrap: true, balance: false },
      },
    ],
  })
  assert.equal(setup.error, false, JSON.stringify(setup.json))
  assert.equal(TITLE.length, 40)
  const n = (await call('describe')).json.revision as number
  const start = await t.files?.()
  const same = async () => {
    if (t.files) assert.deepEqual(await t.files(), start)
  }

  // measure: the title overflows at 390, with the observed px and the expected condition
  const m = await call('measure', {})
  assert.equal(m.error, false, JSON.stringify(m.json))
  assert.deepEqual(m.json.incomplete, [])
  const found = m.json.findings.filter(
    (f: { check: string; at: string[] }) =>
      f.check === 'overflow' && f.at.includes('390'),
  )
  assert.equal(found.length > 0, true, JSON.stringify(m.json.findings))
  assert.ok(found.every((f: { nodes: string[] }) => f.nodes.includes(title)))
  assert.equal(typeof found[0].message, 'string')
  assert.equal(typeof found[0].fix, 'string')

  /** A batch that is refused: the one problem, and the folder as it was. */
  const refused = async (key: string, ops: unknown[]) => {
    const r = await call('apply', { baseRevision: n, key, ops })
    assert.equal(r.error, true, JSON.stringify(r.json))
    assert.equal(r.json.problems.length, 1, JSON.stringify(r.json))
    assert.equal(r.json.problems[0].nodeId, title)
    assert.equal((await call('describe')).json.revision, n)
    await same()
    return r.json.problems[0]
  }

  // 1 remove the title
  const one = await refused('s1', [{ op: 'remove', tree: home, id: title }])
  assert.equal(one.rule, 'required')
  assert.equal(one.nodeId, title)
  // 2 hide it on a phone
  const two = await refused('s2', [
    { op: 'setHidden', tree: home, id: title, layout: 'phone', hidden: true },
  ])
  assert.equal(two.rule, 'required')
  assert.equal(two.path, 'hide.phone')
  // 3 a phone size of 8
  const three = await refused('s3', [
    {
      op: 'setStyle',
      tree: home,
      id: title,
      layer: 'phone',
      decl: { size: 8 },
    },
  ])
  assert.equal(three.rule, 'textRange')
  assert.equal(three.path, 'style.phone.size')
  assert.deepEqual(three.allowed, ['11', '240'])
  // 4 clear the mark and remove, in one batch
  const four = await refused('s4', [
    { op: 'setRequired', tree: home, id: title, required: null },
    { op: 'remove', tree: home, id: title },
  ])
  assert.equal(four.rule, 'protected')
  assert.equal(four.path, 'required')

  // 5 the repair: accepted, and the short form is written as nodes
  const five = await call('apply', {
    baseRevision: n,
    key: 's5',
    ops: [
      {
        op: 'setStyle',
        tree: home,
        id: title,
        layer: 'phone',
        decl: { nowrap: false, size: 28 },
      },
    ],
  })
  assert.equal(five.error, false, JSON.stringify(five.json))
  assert.equal(five.json.revision, n + 1)
  const doc = await t.doc()
  const hero = doc.pages.find(p => p.id === 'home')!.root.children![0]!
  assert.equal(hero.id, 'homehero')
  assert.deepEqual(hero.origin?.block, 'hero')
  assert.equal(find(hero, title)!.style!.phone!.size, 28)
  if (t.files) {
    const written = (await t.files())['pages/home.json']!
    // the form is nodes: `homehero` has a kind, and `block` is left only under its origin
    assert.ok(!/"id": "homehero",\s*"block"/.test(written))
    assert.ok(/"id": "homehero",\s*"kind"/.test(written))
    assert.ok(written.includes(`"id": "${title}"`))
  }

  // measure since n. The spec: "reports the finding as fixed and lists no new finding". The 390 overflow is fixed. The starter's
  // title is 1152 px wide, so it also overflows at 834 and 1280, where the phone layer does not apply: those two findings were
  // there at n and are still there, so they are `present` (not new). Nothing is added, and nothing else changes.
  const since = await call('measure', { since: n })
  assert.equal(since.error, false, JSON.stringify(since.json))
  // one row per page, check and nodes: the 834 and 1280 findings are still there, the 390 one is fixed, nothing is new
  const rows = since.json.findings as {
    check: string
    nodes: string[]
    at: string[]
    new?: true
  }[]
  // the 1152 px title also runs to the window edge at 1280: the bleed-gutter row of the same cause, present before and after
  assert.deepEqual(rows.map(r => r.check).sort(), ['bleed-gutter', 'overflow'])
  const over = rows.find(r => r.check === 'overflow')!
  assert.deepEqual(over.nodes, [title])
  assert.deepEqual([...over.at].sort(), ['1280', '834'])
  assert.ok(rows.every(r => r.new === undefined))
  const fixed = since.json.fixed as {
    check: string
    nodes: string[]
    at: string[]
    file?: string
    line?: number
  }[]
  assert.equal(fixed.length, 1)
  assert.equal(fixed[0]!.check, 'overflow')
  assert.deepEqual(fixed[0]!.nodes, [title])
  assert.deepEqual(fixed[0]!.at, ['390'])
  assert.equal(since.json.unchecked, 0)
  if (t.files) {
    assert.equal(fixed[0]!.file, 'pages/home.json')
    assert.equal(typeof fixed[0]!.line, 'number')
  }

  // a second hero is inserted; removing it is refused; restoring to before the insertion is accepted
  const before = await t.files?.()
  const second = await call('apply', {
    baseRevision: n + 1,
    key: 's6',
    ops: [
      {
        op: 'insertBlock',
        tree: home,
        parent: 'homeroot',
        index: 0,
        block: 'hero',
        look: 'plain',
        id: 'hero2',
      },
    ],
  })
  assert.equal(second.error, false, JSON.stringify(second.json))
  const rm = await call('apply', {
    baseRevision: n + 2,
    key: 's7',
    ops: [{ op: 'remove', tree: home, id: 'hero2' }],
  })
  assert.equal(rm.error, true)
  assert.equal(rm.json.problems[0].rule, 'required')
  assert.equal(rm.json.problems[0].nodeId, 'hero2.title')
  const back = await call('restore', {
    to: n + 1,
    baseRevision: n + 2,
    key: 's8',
  })
  assert.equal(back.error, false, JSON.stringify(back.json))
  assert.equal(back.json.revision, n + 3)
  if (t.files) assert.deepEqual(await t.files(), before)
}

test('CUJ 3 on the memory store with a registry built in code', async () => {
  await journey(await memoryTarget(d => d, process.env.CULM_CHROME))
})

test('CUJ 3 on a folder made by init', async () => {
  await journey(await folderTarget(async () => {}, process.env.CULM_CHROME))
})

test('a real finding and a validation problem on the folder each name the file and line', async () => {
  const dir = await copyFixture('site-basic')
  const { call } = await serve(dir, process.env.CULM_CHROME)
  const n = (await call('describe')).json.revision as number
  const text = (await files(dir))['pages/home.json']!

  // a real finding: the overflow on the title, at the short form's line
  const form = lineOf(text, '"block": "hero"') - 1
  const m = await call('measure', {})
  assert.equal(m.error, false, JSON.stringify(m.json))
  const found = m.json.findings.find(
    (x: { check: string }) => x.check === 'overflow',
  )
  assert.ok(found, JSON.stringify(m.json.findings))
  assert.equal(found.file, 'pages/home.json')
  assert.equal(found.line, form)

  // a refused removal of the required title inside the short form: the form's `{`, one line above its "block" key
  const remove = await call('plan', {
    baseRevision: n,
    ops: [{ op: 'remove', tree: home, id: 'hero1.title' }],
  })
  assert.equal(remove.error, true)
  const p = remove.json.problems[0]
  assert.equal(p.rule, 'required')
  assert.equal(p.file, 'pages/home.json')
  assert.equal(p.line, form)

  // a validation problem of an operation: the size is below the site's range
  const size = await call('plan', {
    baseRevision: n,
    ops: [
      {
        op: 'setStyle',
        tree: home,
        id: 'intro',
        layer: 'phone',
        decl: { size: 8 },
      },
    ],
  })
  assert.equal(size.error, true)
  assert.equal(size.json.problems[0].rule, 'textRange')
  assert.equal(size.json.problems[0].file, 'pages/home.json')
  // the size is set under `style`, so the line is the one of that key
  assert.equal(
    size.json.problems[0].line,
    lineOf(text, '"style": { "base": { "size": 18 } }'),
  )

  // after the title is expanded, a refusal names the node itself
  const fixed = await call('apply', {
    baseRevision: n,
    key: 'expand',
    ops: [
      {
        op: 'setStyle',
        tree: home,
        id: 'hero1.title',
        layer: 'phone',
        decl: { size: 28 },
      },
    ],
  })
  assert.equal(fixed.error, false, JSON.stringify(fixed.json))
  const expanded = (await files(dir))['pages/home.json']!
  const again = await call('plan', {
    baseRevision: n + 1,
    ops: [{ op: 'remove', tree: home, id: 'hero1.title' }],
  })
  assert.equal(again.json.problems[0].file, 'pages/home.json')
  assert.equal(
    again.json.problems[0].line,
    lineOf(expanded, '"id": "hero1.title"') - 1,
  )

  // a mistake made by hand in a file: the folder's own problem names the file and line
  const aboutText = (await files(dir))['pages/about.json']!.replace(
    '"kind": "text"',
    '"kind": "nope"',
  )
  await writeFile(join(dir, 'pages/about.json'), aboutText)
  const broken = await call('describe')
  assert.equal(broken.error, true)
  const q = broken.json.problems[0]
  assert.equal(q.file, 'pages/about.json')
  assert.equal(q.line, lineOf(aboutText, '"kind": "nope"'), JSON.stringify(q))
})
