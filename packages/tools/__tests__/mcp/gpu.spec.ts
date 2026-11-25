import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { parse } from 'jsonc-parser'
import { folderMcpOptions } from '../../src/cli/main.ts'
import { openProject } from '../../src/folder/project.ts'
import { createMcpServer } from '../../src/mcp/server.ts'
import { copyFixture } from '../fixtures.ts'
import {
  attach,
  define,
  gpuFolder,
  invalid,
  mist,
  motion,
} from '../fixtures/shader.ts'
import { connectClient, files } from './serve.ts'

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
