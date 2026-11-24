import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { parse } from 'jsonc-parser'
import { find } from '@culmjs/core'
import { copyFixture } from '../fixtures.ts'
import { folderMcpOptions, main } from '../../src/cli/main.ts'
import { openProject } from '../../src/folder/project.ts'
import { createMcpServer } from '../../src/mcp/server.ts'
import { connectClient, files, serve } from './serve.ts'

const tree = { page: 'home' }
const rise = {
  trigger: 'enter-view',
  effect: 'rise',
  settings: { distance: 24 },
}
const step = {
  target: 'self',
  from: { opacity: 0 },
  to: { opacity: 1 },
  durationMs: 300,
}
const sequence = { trigger: 'load', steps: [step] }
type Call = Awaited<ReturnType<typeof connectClient>>
const ok = async (
  call: Call,
  name: string,
  args: Record<string, unknown> = {},
) => {
  const r = await call(name, args)
  assert.equal(r.error, false, JSON.stringify(r.json))
  return r.json
}
const compact = async (dir: string) =>
  connectClient(
    createMcpServer({
      ...(await folderMcpOptions(dir, await openProject(dir))),
      jsonOps: true,
    }),
  )
const readNode = async (call: Call, id: string) =>
  (await ok(call, 'read', { what: 'node', tree, id })).node

test('compact insert and update round-trip canonical motion; omission preserves, null unsets and restore recovers it', async () => {
  const dir = await copyFixture('site-basic')
  const call = await compact(dir)
  const { revision } = await ok(call, 'describe')
  const node = {
    id: 'title',
    kind: 'text',
    level: 'h1',
    text: 'Open studio',
    motion: sequence,
  }
  const write = (baseRevision: number, ops: object[]) =>
    ok(call, 'write', { baseRevision, page: 'home', ops })
  const a = await write(revision, [{ op: 'insert', node }])
  const reopened = (await serve(dir)).call
  assert.deepEqual((await readNode(reopened, 'title')).motion, sequence)
  const b = await write(a.revision, [
    { op: 'update', id: 'title', motion: rise },
  ])
  const c = await write(b.revision, [
    { op: 'update', id: 'title', text: 'Reed Ledger' },
  ])
  const read = await readNode(reopened, 'title')
  assert.deepEqual(
    (await ok(call, 'find', { id: 'title', full: true })).matches[0].node
      .motion,
    rise,
  )
  assert.deepEqual(read.motion, rise)
  assert.deepEqual(read.props.runs, [{ text: 'Reed Ledger' }])
  const built = await ok(call, 'build')
  assert.ok(built.scripts.some((s: { name: string }) => s.name === 'timeline'))
  const d = await write(c.revision, [
    { op: 'update', id: 'title', motion: null },
  ])
  assert.equal(
    Object.hasOwn(await readNode(reopened, 'title'), 'motion'),
    false,
  )
  await ok(reopened, 'restore', {
    to: c.revision,
    baseRevision: d.revision,
    key: 'restore',
  })
  const project = await openProject(dir)
  assert.deepEqual(project.loaded.problems, [])
  assert.deepEqual(
    find(project.loaded.doc!.pages.find(p => p.id === 'home')!.root, 'title')!
      .motion,
    rise,
  )
})

test('a bad second compact edit has its node and duration path; no revision or source file changes', async () => {
  const dir = await copyFixture('site-basic')
  const call = await compact(dir)
  const head = await ok(call, 'describe')
  const before = await files(dir)
  const r = await call('write', {
    baseRevision: head.revision,
    ops: [
      { op: 'insert', node: { kind: 'text', id: 'title', text: 'Title' } },
      {
        op: 'update',
        id: 'title',
        motion: { ...sequence, steps: [{ ...step, durationMs: -1 }] },
      },
    ],
  })
  assert.equal(r.error, true)
  assert.equal((await ok(call, 'describe')).revision, head.revision)
  assert.deepEqual(await files(dir), before)
  assert.equal(r.json.problems[0].nodeId, 'title')
  assert.equal(r.json.problems[0].op, 1)
  assert.match(r.json.problems[0].path, /^ops\[1\]\.motion.*durationMs$/)
})

test('full plan, apply, replay, diff and restore for setMotion', async () => {
  const dir = await copyFixture('site-basic')
  const { call } = await serve(dir)
  const { revision } = await ok(call, 'describe')
  const before = await files(dir)
  const at = { op: 'setMotion', tree, id: 'intro' }
  const args = {
    baseRevision: revision,
    key: 'motion',
    ops: [{ ...at, motion: rise }],
  }
  const planned = await ok(call, 'plan', args)
  assert.deepEqual(planned.changed, ['home:intro'])
  assert.deepEqual(await files(dir), before)
  const saved = await ok(call, 'apply', args)
  assert.equal(saved.revision, revision + 1)
  assert.deepEqual(await ok(call, 'apply', args), saved)
  const diff = await ok(call, 'diff', { from: revision })
  assert.deepEqual(diff.trees[0].changed, [{ id: 'intro', paths: ['motion'] }])
  const bad = await call('apply', {
    baseRevision: saved.revision,
    key: 'unknown',
    ops: [{ ...at, motion: { ...rise, effect: 'not-registered' } }],
  })
  assert.equal(bad.error, true)
  assert.equal(bad.json.problems[0].path, 'motion.effect')
  await ok(call, 'restore', {
    to: revision,
    baseRevision: saved.revision,
    key: 'undo',
  })
  assert.deepEqual(await files(dir), before)
})

test('compact write and full apply resolve motion against the same final moves', async () => {
  const motion = { ...sequence, steps: [{ ...step, target: { id: 'intro' } }] }
  for (const full of [true, false]) {
    const dir = await copyFixture('site-basic')
    const writer = await compact(dir),
      call = (await serve(dir)).call
    const head = await ok(writer, 'describe')
    const { revision } = await ok(writer, 'write', {
      baseRevision: head.revision,
      ops: [{ op: 'insert', node: { id: 'owner', kind: 'box' } }],
    })
    const move = { op: 'move', id: 'intro', parent: 'owner', index: 0 }
    const saved = full
      ? await ok(call, 'apply', {
          key: 'both',
          baseRevision: revision,
          ops: [
            { op: 'setMotion', tree, id: 'owner', motion },
            { ...move, tree },
          ],
        })
      : await ok(writer, 'write', {
          baseRevision: revision,
          ops: [{ op: 'update', id: 'owner', motion }, move],
        })
    const read = await readNode(call, 'owner')
    assert.deepEqual(read.motion, motion)
    assert.equal(
      find((await openProject(dir)).loaded.doc!.pages[0].root, 'owner')!
        .children![0].id,
      'intro',
    )
    const before = await files(dir)
    const invalid = await writer('write', {
      baseRevision: saved.revision,
      ops: [
        { op: 'update', id: 'intro', text: 'Not saved' },
        {
          op: 'update',
          id: 'owner',
          motion: { ...motion, steps: [{ ...step, target: { id: 'absent' } }] },
        },
        { op: 'update', id: 'owner', style: { opacity: 0.8 } },
      ],
    })
    assert.equal(invalid.error, true)
    const p = invalid.json.problems[0]
    assert.deepEqual(
      [p.op, p.nodeId, p.path],
      [1, 'owner', 'ops[1].motion.steps.0.target'],
    )
    assert.deepEqual(await files(dir), before)
    assert.equal((await ok(writer, 'describe')).revision, saved.revision)
  }
})

for (const phase of ['diagnose', 'apply'] as const)
  test(`compact ${phase} veto identifies the source edit rather than its second core operation`, async () => {
    const dir = await copyFixture('site-basic')
    const options = await folderMcpOptions(dir, await openProject(dir))
    let seen = 0
    const call = await connectClient(
      createMcpServer({
        ...options,
        jsonOps: true,
        allow(op) {
          if (
            op.op === 'setMotion' &&
            ++seen === (phase === 'diagnose' ? 1 : 2)
          )
            return {
              code: 'POLICY_VIOLATION',
              message: 'Motion locked',
              nodeId: op.id,
              path: 'motion',
            }
        },
      }),
    )
    const { revision } = await ok(call, 'describe')
    const before = await files(dir)
    const r = await call('write', {
      baseRevision: revision,
      ops: [{ op: 'update', id: 'intro', text: 'New title', motion: rise }],
    })
    assert.equal(r.error, true)
    assert.equal(seen, phase === 'diagnose' ? 1 : 2)
    assert.equal((await ok(call, 'describe')).revision, revision)
    assert.deepEqual(await files(dir), before)
    const p = r.json.problems[0]
    assert.deepEqual(
      [p.code, p.nodeId, p.path, p.op],
      ['POLICY_VIOLATION', 'intro', 'motion', 0],
    )
  })

test('compact implicit page creation belongs to the insert requesting the page', async () => {
  const dir = await copyFixture('site-basic')
  const options = await folderMcpOptions(dir, await openProject(dir))
  const call = await connectClient(
    createMcpServer({
      ...options,
      jsonOps: true,
      allow(op) {
        if (op.op === 'addPage')
          return {
            code: 'POLICY_VIOLATION',
            message: 'Page locked',
            path: 'page',
          }
      },
    }),
  )
  const { revision } = await ok(call, 'describe')
  const before = await files(dir)
  const r = await call('write', {
    page: 'studio',
    baseRevision: revision,
    ops: [
      { op: 'theme', value: { brand: '#a04030' } },
      { op: 'insert', node: { kind: 'text', id: 'title', text: 'Studio' } },
    ],
  })
  assert.equal(r.error, true)
  assert.equal((await ok(call, 'describe')).revision, revision)
  assert.deepEqual(await files(dir), before)
  const p = r.json.problems[0]
  assert.deepEqual([p.code, p.path, p.op], ['POLICY_VIOLATION', 'page', 1])
})

test('full plan and apply report the core operation index for the same motion veto', async () => {
  const dir = await copyFixture('site-basic')
  const options = await folderMcpOptions(dir, await openProject(dir))
  const call = await connectClient(
    createMcpServer({
      ...options,
      allow(op) {
        if (op.op === 'setMotion')
          return {
            code: 'POLICY_VIOLATION',
            message: 'Motion locked',
            nodeId: op.id,
          }
      },
    }),
  )
  const { revision } = await ok(call, 'describe')
  for (const name of ['plan', 'apply']) {
    const r = await call(name, {
      baseRevision: revision,
      key: 'veto',
      ops: [
        { op: 'setText', tree, id: 'intro', text: 'New title' },
        { op: 'setMotion', tree, id: 'intro', motion: rise },
      ],
    })
    assert.equal(r.error, true)
    const p = r.json.problems[0]
    assert.deepEqual([p.code, p.nodeId, p.op], ['POLICY_VIOLATION', 'intro', 1])
  }
  assert.equal((await ok(call, 'describe')).revision, revision)
})

test('full subtree replacement reconciles motion on retained ids, including an omitted field', async () => {
  const dir = await copyFixture('site-basic')
  const { call } = await serve(dir)
  const { revision } = await ok(call, 'describe')
  const replace = (baseRevision: number, extras: object) =>
    ok(call, 'write', {
      target: 'intro',
      baseRevision,
      json: { kind: 'text', id: 'intro', text: 'Intro', ...extras },
    })
  const a = await replace(revision, { motion: rise })
  assert.deepEqual((await readNode(call, 'intro')).motion, rise)
  const b = await replace(a.revision, { motion: sequence })
  assert.deepEqual((await readNode(call, 'intro')).motion, sequence)
  await replace(b.revision, {})
  assert.equal(Object.hasOwn(await readNode(call, 'intro'), 'motion'), false)
})

test('an edited short block expands; editing one use is refused without touching the piece or any instance', async () => {
  const dir = await copyFixture('site-basic')
  const call = await compact(dir)
  const { revision } = await ok(call, 'describe')
  const before = await files(dir)
  const update = (baseRevision: number, id: string) =>
    call('write', { baseRevision, ops: [{ op: 'update', id, motion: rise }] })
  const expanded = await update(revision, 'hero1.title')
  assert.equal(expanded.error, false, JSON.stringify(expanded.json))
  const after = await files(dir)
  const hero = parse(after['pages/home.json']!).root.children[0]
  assert.equal(hero.block, undefined)
  assert.deepEqual(find(hero, 'hero1.title')!.motion, rise)
  assert.equal(after['blocks/hero.json'], before['blocks/hero.json'])
  const refused = await update(expanded.json.revision, 'visit1')
  assert.equal(refused.error, true)
  assert.equal(refused.json.problems[0].code, 'SOURCE_CONFLICT')
  assert.ok(
    refused.json.problems.some(
      (p: { message: string; file?: string }) =>
        /visit1 is a use of a piece/.test(p.message) &&
        p.file === 'pages/home.json',
    ),
  )
  assert.deepEqual(await files(dir), after)
  assert.equal((await ok(call, 'describe')).revision, expanded.json.revision)
})

test('culm schema exposes plain node motion; build locates a malformed hand-edited program', async () => {
  const dir = await copyFixture('site-basic')
  assert.equal(await main(['schema'], { cwd: dir, out() {} }), 0)
  const schema = JSON.parse(
    await readFile(join(dir, 'culm.schema.json'), 'utf8'),
  )
  assert.ok(schema.$defs.plainNode.properties.motion)
  const { call } = await serve(dir)
  const file = 'pages/home.json'
  const disk = parse(await readFile(join(dir, file), 'utf8'))
  disk.root.children[1].motion = {
    ...sequence,
    steps: [{ ...step, durationMs: 0 }],
  }
  await writeFile(join(dir, file), JSON.stringify(disk, null, 2))
  const r = await call('build')
  assert.equal(r.error, true)
  const p = r.json.problems[0]
  assert.deepEqual(
    [p.file, p.nodeId, p.path],
    [file, 'intro', 'motion.steps.0.durationMs'],
  )
  assert.ok(p.line > 1)
})

test('effects catalogue pages registered numeric settings and provides a runnable rise operation', async () => {
  const dir = await copyFixture('site-basic')
  const home = join(dir, 'pages/home.json')
  const page = parse(await readFile(home, 'utf8'))
  page.id = 'studio-index'
  page.root.id = 'studio'
  await writeFile(home, JSON.stringify(page))
  const project = await openProject(dir)
  const settings = Object.fromEntries(
    Array.from({ length: 450 }, (_, i) => [
      `param${i}`,
      { min: 0, max: 1, default: 0.5 },
    ]),
  )
  project.registry.use({
    name: 'waves',
    version: 1,
    api: [1],
    runs: ['build'],
    trust: 'declarative',
    effects: [
      {
        name: 'wave',
        tier: 2,
        settings,
        steps: () => [{ ...step, target: 'self' }],
      },
    ],
  })
  const call = await connectClient(
    createMcpServer(await folderMcpOptions(dir, project)),
  )
  const query = (args: object = {}) =>
    ok(call, 'catalogue', { what: 'effects', ...args })
  const list = await query()
  assert.deepEqual(list.rows, [
    { name: 'rise', tier: 1 },
    { name: 'wave', tier: 2 },
  ])
  const first = await query({ id: 'wave' })
  assert.equal(first.tier, 2)
  assert.ok(first.cut && first.cursor)
  const rows = [...first.rows]
  let cursor = first.cursor
  while (cursor) {
    const next = await query({ id: 'wave', cursor })
    assert.deepEqual(next.example, first.example)
    rows.push(...next.rows)
    cursor = next.cursor
  }
  assert.deepEqual(
    rows.map(r => r.key),
    Object.keys(settings),
  )
  const detail = await query({ id: 'rise' })
  assert.deepEqual(detail.rows, [
    { key: 'distance', type: 'number', min: 0, max: 100, default: 16 },
  ])
  assert.equal(detail.example.op, 'setMotion')
  assert.equal(detail.example.motion.effect, 'rise')
  assert.deepEqual(detail.example.tree, { page: 'studio-index' })
  assert.equal(detail.example.id, 'studio')
  const { revision } = await ok(call, 'describe')
  await ok(call, 'plan', { baseRevision: revision, ops: [detail.example] })
  const missing = await call('catalogue', { what: 'effects', id: 'missing' })
  assert.equal(missing.error, true)
  assert.deepEqual(missing.json.problems[0].allowed, ['rise', 'wave'])
  await ok(call, 'apply', {
    key: 'reorder',
    baseRevision: revision,
    ops: [{ op: 'movePage', page: 'about', index: 0 }],
  })
  assert.deepEqual((await query({ id: 'wave' })).example.tree, {
    page: 'about',
  })
  const stale = await call('catalogue', {
    what: 'effects',
    id: 'wave',
    cursor: first.cursor,
  })
  assert.equal(stale.error, true)
  assert.equal(stale.json.problems[0].code, 'REVISION_CONFLICT')
})

test('effect list continuation covers every name at one revision and refuses a stale cursor', async () => {
  const dir = await copyFixture('site-basic')
  const project = await openProject(dir)
  const riseDef = project.registry.effect('rise')!
  const names = Array.from(
    { length: 300 },
    (_, i) => `${'wave'.repeat(10)}${i}`,
  )
  project.registry.use({
    name: 'waves',
    version: 1,
    api: [1],
    runs: ['build'],
    trust: 'declarative',
    effects: names.map(name => ({ ...riseDef, name })),
  })
  const call = await connectClient(
    createMcpServer(await folderMcpOptions(dir, project)),
  )
  const { revision } = await ok(call, 'describe')
  const first = await ok(call, 'catalogue', { what: 'effects' })
  assert.ok(first.cut && first.cursor)
  const rows = [...first.rows]
  let cursor = first.cursor
  while (cursor) {
    const next = await ok(call, 'catalogue', { what: 'effects', cursor })
    rows.push(...next.rows)
    cursor = next.cursor
  }
  assert.deepEqual(
    rows.map(r => r.name),
    ['rise', ...names],
  )
  await ok(call, 'apply', {
    key: 'reorder',
    baseRevision: revision,
    ops: [{ op: 'movePage', page: 'about', index: 0 }],
  })
  const stale = await call('catalogue', {
    what: 'effects',
    cursor: first.cursor,
  })
  assert.equal(stale.error, true)
  assert.equal(stale.json.problems[0].code, 'REVISION_CONFLICT')
})
