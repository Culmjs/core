import test from 'node:test'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { copyFixture } from '../__tests__/fixtures.ts'
import { files, lineOf, serve } from '../__tests__/mcp/serve.ts'

const home = { page: 'home' }
const title = 'hero1.title'

test('CUJ 3 on a folder', async () => {
  const dir = await copyFixture('site-basic')
  const { call } = await serve(dir, process.env.CULM_CHROME)
  const n = (await call('describe')).json.revision as number
  const start = await files(dir)

  // measure: the title overflows at 390, with the observed px and the expected condition
  const m = await call('measure', {})
  assert.equal(m.error, false, JSON.stringify(m.json))
  assert.deepEqual(m.json.incomplete, [])
  const found = m.json.findings.filter(
    (f: { check: string; width: number }) =>
      f.check === 'overflow' && f.width === 390,
  )
  assert.equal(found.length > 0, true, JSON.stringify(m.json.findings))
  assert.ok(found.every((f: { nodes: string[] }) => f.nodes.includes(title)))
  assert.equal(typeof found[0].observed, 'number')
  assert.ok(found[0].observed > 0, `observed ${found[0].observed}`)
  assert.equal(
    found[0].expected,
    'a block reaches at most 1 px past its parent',
  )

  /** A batch that is refused: the one problem, and the folder as it was. */
  const refused = async (key: string, ops: unknown[]) => {
    const r = await call('apply', { baseRevision: n, key, ops })
    assert.equal(r.error, true, JSON.stringify(r.json))
    assert.equal(r.json.problems.length, 1, JSON.stringify(r.json))
    assert.equal(r.json.problems[0].nodeId, title)
    assert.equal((await call('describe')).json.revision, n)
    assert.deepEqual(await files(dir), start)
    return r.json.problems[0]
  }

  // 1 remove the title
  const one = await refused('s1', [{ op: 'remove', tree: home, id: title }])
  assert.equal(one.rule, 'required')
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
  assert.deepEqual(three.allowed, ['11', '96'])
  // 4 clear the mark and remove, in one batch
  const four = await refused('s4', [
    { op: 'setRequired', tree: home, id: title, required: null },
    { op: 'remove', tree: home, id: title },
  ])
  assert.equal(four.rule, 'protected')

  // 5 the repair: accepted, and the short form is written as nodes
  assert.ok(start['pages/home.json']!.includes('"block": "hero"'))
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
  assert.ok(
    five.json.notes.some(
      (x: { kind: string; ids: string[] }) =>
        x.kind === 'expanded' && x.ids.includes('hero1'),
    ),
    JSON.stringify(five.json.notes),
  )
  const written = (await files(dir))['pages/home.json']!
  // the form is nodes now: `hero1` has a kind, and `block` is left only under its origin
  assert.ok(!/"id": "hero1",\s*"block"/.test(written))
  assert.ok(/"id": "hero1",\s*"kind"/.test(written))
  assert.ok(written.includes(`"id": "${title}"`))

  // measure since n: the finding is fixed and nothing is new
  const since = await call('measure', { since: n })
  assert.equal(since.error, false, JSON.stringify(since.json))
  assert.deepEqual(since.json.findings, [])
  assert.deepEqual(since.json.added, [])
  assert.equal(since.json.was.length, 1)
  assert.equal(since.json.was[0].status, 'fixed')
  assert.equal(since.json.was[0].finding.check, 'overflow')
  assert.deepEqual(since.json.was[0].finding.nodes, [title])

  // a second hero is inserted; removing it is refused; restoring to before the insertion is accepted
  const before = await files(dir)
  const hero = await call('apply', {
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
  assert.equal(hero.error, false, JSON.stringify(hero.json))
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
  assert.deepEqual(await files(dir), before)
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
  assert.equal(typeof found.column, 'number')

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
  await writeFile(
    join(dir, 'pages/about.json'),
    (await files(dir))['pages/about.json']!.replace(
      '"kind": "text"',
      '"kind": "nope"',
    ),
  )
  const broken = await call('describe')
  assert.equal(broken.error, true)
  const q = broken.json.problems[0]
  assert.equal(q.file, 'pages/about.json')
  assert.ok(q.line > 1, JSON.stringify(q))
})
