import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { memoryStore, type SiteStore } from '@culmjs/core/ops'
import { parse } from 'jsonc-parser'
import { folderMcpOptions } from '../../src/cli/main.ts'
import { openProject } from '../../src/folder/project.ts'
import { createMcpServer } from '../../src/mcp/server.ts'
import { copyFixture } from '../fixtures.ts'
import { startFake } from '../fakeSources.ts'
import {
  attach,
  define,
  gpuFolder,
  invalid,
  mist,
  motion,
} from '../fixtures/shader.ts'
import { connectClient, files, serve } from './serve.ts'

test('retained compact key replays after predecessor pruning and restart; changed input conflicts', async () => {
  const dir = await copyFixture('site-basic')
  await gpuFolder(dir)
  const open = async () =>
    connectClient(
      createMcpServer({
        ...(await folderMcpOptions(dir, await openProject(dir))),
        jsonOps: true,
      }),
    )
  const call = await open()
  const { revision } = (await call('describe')).json
  const update = { op: 'update', id: 'hero', motion }
  const args = {
    baseRevision: revision,
    key: 'retained',
    ops: [define, update],
  }
  const made = await call('write', args)
  assert.equal(made.error, false, JSON.stringify(made.json))
  const later = await call('write', {
    baseRevision: made.json.revision,
    key: 'later',
    ops: [{ op: 'insert', node: { id: 'later', kind: 'text', text: 'Later' } }],
  })
  assert.equal(later.error, false)
  assert.notDeepEqual(later.json.sections, made.json.sections)
  // Reach the same retained-record boundary without performing 199 unrelated transactions.
  await rm(join(dir, `.culm/revisions/${revision}.json`))
  const restarted = await open()
  assert.deepEqual(await restarted('write', args), made)
  assert.deepEqual(
    await restarted('write', {
      ...args,
      ops: [{ effect: mist, op: 'addCustomEffect' }, update],
    }),
    made,
  )
  // Explicit page and default page project to the same core ops, but the submitted input differs.
  for (const change of [
    { page: 'home' },
    { ops: [{ ...define, effect: { ...mist, source: invalid } }] },
  ]) {
    const r = await restarted('write', { ...args, ...change })
    assert.equal(r.json.problems[0].code, 'KEY_CONFLICT')
  }
  assert.equal((await restarted('describe')).json.revision, later.json.revision)
  const full = await serve(dir)
  const normalized = await full.call('apply', {
    ...args,
    ops: [define, attach],
  })
  assert.equal(normalized.error, false)
  assert.equal(normalized.json.revision, made.json.revision)
})

test('non-folder store without receipt metadata replays ordered writes from its retained base', async () => {
  const dir = await copyFixture('site-basic')
  await gpuFolder(dir)
  const { loaded, registry } = await openProject(dir)
  const memory = memoryStore({ s: loaded.doc! })
  const store: SiteStore = {
    ...memory,
    commit: (s, c) => memory.commit(s, { ...c, receipt: undefined }),
  }
  const call = await connectClient(
    createMcpServer({
      store,
      registry,
      site: 's',
      data: loaded.data,
      jsonOps: true,
    }),
  )
  const args = {
    baseRevision: 0,
    key: 'compat',
    ops: [define, { op: 'update', id: 'hero', motion }],
  }
  const first = await call('write', args)
  assert.equal(first.error, false, JSON.stringify(first.json))
  assert.equal((await store.replay('s', args.key))?.receipt, undefined)
  assert.deepEqual(await call('write', args), first)
})

for (const tool of ['plan', 'apply'])
  for (const bad of ['source', 'placement'])
    test(`mixed asset/shader ${tool} preflights ${bad} before publishing held assets`, async t => {
      const fake = await startFake()
      t.after(() => fake.close())
      const dir = await copyFixture('site-basic')
      await gpuFolder(dir)
      const { call } = await serve(dir, undefined, { hosts: fake.hosts })
      const initial = await files(dir)
      const { revision } = (await call('describe')).json
      const assets = [
        { op: 'setFonts', fonts: [{ google: 'Roboto Slab' }] },
        {
          op: 'add',
          tree: attach.tree,
          parent: 'hero',
          index: 0,
          node: {
            kind: 'icon',
            id: 'camera',
            props: { name: 'lucide:camera' },
          },
        },
      ]
      const r = await call(tool, {
        baseRevision: revision,
        key: 'bad',
        ops: [
          ...assets,
          { ...attach, id: bad === 'placement' ? 'intro' : 'hero' },
          {
            ...define,
            effect: bad === 'source' ? { ...mist, source: invalid } : mist,
          },
        ],
      })
      assert.equal(r.error, true, JSON.stringify(r.json))
      const p = r.json.problems[0]
      if (bad === 'source')
        assert.deepEqual([p.op, p.rule, p.shaderLine], [3, 'shader.input', 3])
      else assert.deepEqual([p.op, p.nodeId], [2, 'intro'])
      assert.deepEqual(await files(dir), initial)
      assert.deepEqual(fake.hits, [])
      assert.equal((await call('describe')).json.revision, revision)
      const good = await call(tool, {
        baseRevision: revision,
        key: 'good',
        ops: [...assets, attach, define],
      })
      assert.equal(good.error, false, JSON.stringify(good.json))
      assert.equal(good.json.revision, revision + (tool === 'apply' ? 1 : 0))
      const after = await files(dir)
      assert.ok(after['fonts/roboto-slab/font.json'])
      assert.ok(after['assets/icons/lucide/camera.svg'])
    })

test('a running folder writer cannot use its startup GPU grant after opt-out', async () => {
  const dir = await copyFixture('site-basic')
  await gpuFolder(dir)
  const options = await folderMcpOptions(dir, await openProject(dir))
  const call = await connectClient(
    createMcpServer({ ...options, jsonOps: true }),
  )
  const { revision } = (await call('describe')).json
  writeFileSync(join(dir, 'culm.json'), '{"features":{"gpu":false}}')
  const before = await files(dir)
  const r = await call('write', {
    baseRevision: revision,
    key: 'off',
    ops: [define],
  })
  assert.equal(r.json.problems[0].code, 'UNSUPPORTED_CAPABILITY')
  assert.deepEqual(await files(dir), before)
})

for (const compact of [true, false])
  test(`${compact ? 'compact' : 'full'} define and attach is one replayable folder transaction`, async () => {
    const dir = await copyFixture('site-basic')
    await gpuFolder(dir)
    const project = await openProject(dir)
    const options = await folderMcpOptions(dir, project)
    const full = await connectClient(createMcpServer(options))
    const writer = compact
      ? await connectClient(createMcpServer({ ...options, jsonOps: true }))
      : full
    const tool = compact ? 'write' : 'apply'
    const initial = await files(dir)
    const before = (await writer('describe')).json
    const second = compact ? { op: 'update', id: 'hero', motion } : attach
    const args = {
      baseRevision: before.revision,
      key: 'shader',
      ops: [define, second],
    }
    const rejected = await writer(tool, {
      ...args,
      ops: [{ ...define, effect: { ...mist, source: invalid } }, second],
    })
    assert.equal(rejected.error, true)
    const p = rejected.json.problems[0]
    assert.deepEqual([p.op, p.rule, p.shaderLine], [0, 'shader.input', 3])
    assert.deepEqual(await files(dir), initial)
    assert.equal((await writer('describe')).json.revision, before.revision)
    const detail = await full('catalogue', {
      what: 'operations',
      id: 'addCustomEffect',
    })
    assert.equal(detail.error, false)
    const planned = await full('plan', { ...args, ops: [attach, define] })
    assert.deepEqual(planned.json.pages, ['home'], JSON.stringify(planned.json))
    assert.deepEqual(await files(dir), initial)
    const r = await writer(tool, args)
    assert.equal(r.error, false, JSON.stringify(r.json))
    const after = r.json
    assert.equal(after.revision, before.revision + 1)
    assert.deepEqual((await writer(tool, args)).json, after)
    const saved = await files(dir)
    assert.deepEqual(parse(saved['site.json']!).customEffects, [
      'effects/mist.json',
    ])
    assert.deepEqual(parse(saved['effects/mist.json']!), {
      name: 'mist',
      settings: mist.settings,
      sourceFile: 'mist.frag',
    })
    assert.equal(saved['effects/mist.frag'], mist.source)
    const { loaded } = await openProject(dir)
    assert.deepEqual(loaded.problems, [])
    assert.deepEqual(loaded.doc?.customEffects, [mist])
    assert.deepEqual(loaded.doc?.pages[0]?.root, {
      ...project.loaded.doc!.pages[0]!.root,
      motion,
    })
    assert.deepEqual(
      (await full('diff', { from: before.revision })).json.site,
      ['customEffects'],
    )
    assert.equal(
      (await full('catalogue', { what: 'effects', id: 'mist' })).json.tier,
      3,
    )
    const duplicate = await writer(tool, {
      ...args,
      baseRevision: after.revision,
      key: 'duplicate',
    })
    assert.equal(duplicate.json.problems[0].op, 0)
    assert.deepEqual(await files(dir), saved)
    const undo = await full('restore', {
      baseRevision: after.revision,
      to: before.revision,
      key: 'undo',
    })
    assert.deepEqual(await files(dir), initial)
    const redo = await full('restore', {
      baseRevision: undo.json.revision,
      to: after.revision,
      key: 'redo',
    })
    assert.equal(redo.error, false, JSON.stringify(redo.json))
    assert.deepEqual(await files(dir), saved)
  })

test('compact write keeps its original source read-set across projection and apply', async () => {
  const dir = await copyFixture('site-basic')
  await gpuFolder(dir, true)
  const initial = await files(dir)
  const input = 'effects/mist.frag'
  const edit = '// external\n' + mist.source
  const options = await folderMcpOptions(dir, await openProject(dir))
  const call = await connectClient(
    createMcpServer({
      ...options,
      jsonOps: true,
      allow(op) {
        if (op.op === 'addCustomEffect') writeFileSync(join(dir, input), edit)
        return undefined
      },
    }),
  )
  const { revision } = (await call('describe')).json
  const r = await call('write', {
    baseRevision: revision,
    key: 'race',
    ops: [
      { ...define, effect: { ...mist, name: 'cloud' } },
      { op: 'update', id: 'hero', motion },
    ],
  })
  assert.equal(
    r.json.problems?.[0].code,
    'SOURCE_CONFLICT',
    JSON.stringify(r.json),
  )
  assert.deepEqual(await files(dir), { ...initial, [input]: edit })
})

test('both profiles deliver bounded, parseable shader diagnostics and honor the host veto', async () => {
  const dir = await copyFixture('site-basic')
  await gpuFolder(dir)
  const options = await folderMcpOptions(dir, await openProject(dir))
  for (const compact of [true, false]) {
    const call = await connectClient(
      createMcpServer({
        ...options,
        jsonOps: compact,
        allow(op) {
          if (op.op === 'addCustomEffect' && op.effect.name === 'locked')
            return { code: 'POLICY_VIOLATION', message: 'Locked effect.' }
        },
      }),
    )
    const { revision } = (await call('describe')).json
    const update = compact
      ? { op: 'update', id: 'intro', text: 'Changed' }
      : { op: 'setText', tree: { page: 'home' }, id: 'intro', text: 'Changed' }
    for (const effect of [
      { ...mist, name: 'locked' },
      { ...mist, settings: { ['a'.repeat(18_000)]: {} } },
    ]) {
      const r = await call(compact ? 'write' : 'apply', {
        baseRevision: revision,
        key: 'bad',
        ops: [update, { ...define, effect }],
      })
      assert.equal(r.error, true)
      const p = r.json.problems[0]
      assert.equal(p.op, 1)
      if (effect.name === 'locked') assert.equal(p.code, 'POLICY_VIOLATION')
      else assert.equal(p.rule, 'shader.settings')
      assert.equal((await call('describe')).json.revision, revision)
    }
  }
})
