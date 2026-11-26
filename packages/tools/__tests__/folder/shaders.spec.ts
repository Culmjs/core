import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import {
  mkdir,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { apply, restore } from '@culmjs/core/ops'
import { main } from '../../src/cli/main.ts'
import { openProject } from '../../src/folder/project.ts'
import { fileStore } from '../../src/folder/store.ts'
import { copyFixture } from '../fixtures.ts'
import { attach, define, gpuFolder, invalid, mist } from '../fixtures/shader.ts'
import { files } from '../mcp/serve.ts'

for (const action of [
  'remove',
  'rewrite',
  'remove intermediate',
  'remove referenced target',
  'stable target',
  'independent links',
]) {
  test(`restore verifies kept shader link: ${action}`, async () => {
    const dir = await copyFixture('site-basic')
    await gpuFolder(dir, true)
    const initial = await files(dir)
    const { registry } = await openProject(dir)
    const steps: number[] = []
    const store = await fileStore(dir, registry, { after: n => steps.push(n) })
    const first = await store.head('s')
    assert.ok('doc' in first)
    const cloud = {
      ...mist,
      name: 'cloud',
      source: '// original cloud\n' + mist.source,
    }
    const saved = await apply(store, registry, {
      site: 's',
      key: 'target',
      baseRevision: first.revision,
      ops:
        action === 'rewrite'
          ? [{ ...define, effect: cloud }, attach]
          : [attach],
    })
    assert.ok(saved.ok)
    const expected = await store.get('s', saved.revision)
    const effects = join(dir, 'effects')
    // Hand-save a head that lists cloud. Its source now has mist's target
    // bytes; the retained mist source is a real, contained file link.
    const refs =
      action === 'remove referenced target'
        ? ['effects/mist.json', 'effects/cloud.json']
        : ['effects/cloud.json']
    await writeFile(
      join(dir, 'site.json'),
      initial['site.json']!.replace(
        '["effects/mist.json"]',
        JSON.stringify(refs),
      ),
    )
    await writeFile(join(dir, 'pages/home.json'), initial['pages/home.json']!)
    await writeFile(
      join(effects, 'cloud.json'),
      JSON.stringify({
        name: 'cloud',
        settings: mist.settings,
        sourceFile: 'cloud.frag',
      }),
    )
    await writeFile(join(effects, 'held.frag'), mist.source)
    if (action === 'remove intermediate' || action === 'independent links')
      await symlink('held.frag', join(effects, 'cloud.frag'))
    else await writeFile(join(effects, 'cloud.frag'), mist.source)
    const stable = action === 'stable target' || action === 'independent links'
    const link = stable ? 'held.frag' : 'cloud.frag'
    await rm(join(effects, 'mist.frag'))
    await symlink(link, join(effects, 'mist.frag'))
    const outside = await apply(store, registry, {
      site: 's',
      key: 'outside',
      baseRevision: saved.revision,
      ops: [{ op: 'setSite', name: 'Outside' }],
    })
    assert.ok(!outside.ok && outside.problems[0].code === 'REVISION_CONFLICT')
    const before = await files(dir)
    steps.length = 0
    const r = await restore(store, registry, {
      site: 's',
      key: 'restore',
      to: saved.revision,
      baseRevision: saved.revision + 1,
    })
    if (stable) {
      assert.ok(r.ok, JSON.stringify(r))
      const { loaded } = await openProject(dir)
      assert.deepEqual(loaded.problems, [])
      assert.deepEqual(loaded.doc, expected)
      assert.deepEqual(await store.get('s', r.revision), expected)
    } else {
      assert.ok(
        !r.ok && r.problems[0].code === 'SOURCE_CONFLICT',
        JSON.stringify(r),
      )
      assert.ok(!steps.includes(5), 'refused before journaling')
      assert.deepEqual(await files(dir), before)
      const reopened = await fileStore(dir, registry)
      const h = await reopened.head('s')
      assert.ok('doc' in h)
      assert.equal(h.revision, saved.revision + 1)
      assert.deepEqual(await reopened.get('s', h.revision), h.doc)
      assert.equal(await reopened.replay('s', 'restore'), undefined)
    }
    assert.equal(await readlink(join(effects, 'mist.frag')), link)
  })
}

for (const comma of ['', ','])
  test(`commented reference append (${comma ? 'trailing comma' : 'no comma'}) reloads both shaders and the attachment`, async () => {
    const dir = await copyFixture('site-basic')
    await gpuFolder(dir, true)
    const site = join(dir, 'site.json')
    await writeFile(
      site,
      (await readFile(site, 'utf8')).replace(
        '"effects/mist.json"]',
        `"effects/mist.json"${comma} // keep mist\r\n  ]`,
      ),
    )
    const { registry } = await openProject(dir)
    const store = await fileStore(dir, registry)
    const h = await store.head('s')
    assert.ok('doc' in h)
    const cloud = { ...mist, name: 'cloud' },
      motion = { ...attach.motion, gpu: cloud.name }
    const result = await apply(store, registry, {
      site: 's',
      key: 'append',
      baseRevision: h.revision,
      ops: [
        { ...define, effect: cloud },
        { ...attach, motion },
      ],
    })
    assert.ok(result.ok, JSON.stringify(result))
    const { loaded } = await openProject(dir)
    assert.deepEqual(loaded.problems, [])
    assert.deepEqual(loaded.doc?.customEffects, [mist, cloud])
    assert.deepEqual(loaded.doc?.pages[0]!.root.motion, motion)
    assert.match(await readFile(site, 'utf8'), /\/\/ keep mist\r\n/)
  })

for (const crash of [0, 6, 8])
  test(`restore reuses exact unreferenced sidecars and journals only mutations (crash ${crash})`, async () => {
    const dir = await copyFixture('site-basic')
    await gpuFolder(dir)
    const initial = await files(dir)
    const { registry } = await openProject(dir)
    let armed = false
    const store = await fileStore(dir, registry, {
      after(n) {
        if (armed && n === crash) throw Error('interrupted')
      },
    })
    const first = await store.head('s')
    assert.ok('doc' in first)
    const a = await apply(store, registry, {
      site: 's',
      key: 'define',
      baseRevision: first.revision,
      ops: [define, attach],
    })
    assert.ok(a.ok)
    const target = await files(dir)
    for (const p of ['site.json', 'pages/home.json'])
      await writeFile(join(dir, p), initial[p]!)
    // Record the hand save. Both shader files still exist but are no longer inputs.
    const r = await apply(store, registry, {
      site: 's',
      key: 'outside',
      baseRevision: a.revision,
      ops: [{ op: 'setSite', name: 'Outside' }],
    })
    assert.ok(!r.ok && r.problems[0].code === 'REVISION_CONFLICT')
    const outside = await files(dir)
    const req = {
      site: 's',
      key: 'back',
      baseRevision: a.revision + 1,
      to: a.revision,
    }
    for (const p of ['effects/mist.json', 'effects/mist.frag']) {
      await writeFile(join(dir, p), target[p] + ' ')
      const changed = await restore(store, registry, req)
      assert.ok(!changed.ok && changed.problems[0].code === 'SOURCE_CONFLICT')
      assert.deepEqual(await files(dir), { ...outside, [p]: target[p] + ' ' })
      await writeFile(join(dir, p), target[p]!)
    }
    armed = true
    if (crash)
      await assert.rejects(restore(store, registry, req), /interrupted/)
    else assert.ok((await restore(store, registry, req)).ok)
    const recovered = await fileStore(dir, registry)
    assert.deepEqual(await files(dir), crash === 6 ? outside : target)
    const redo = await restore(recovered, registry, req)
    assert.ok(redo.ok)
    assert.deepEqual(await files(dir), target)
    assert.deepEqual((await recovered.get('s', redo.revision))?.customEffects, [
      mist,
    ])
  })

test('unused shader: CLI check and build locate the authored source line and keep last good files', async () => {
  const dir = await copyFixture('site-basic')
  await gpuFolder(dir, true)
  const run = async (cmd: string) => {
    let output = ''
    const status = await main([cmd], {
      cwd: dir,
      out: m => {
        output += m
      },
      err: m => {
        output += m
      },
    })
    return { status, output }
  }
  assert.deepEqual((await openProject(dir)).loaded.doc?.customEffects, [mist])
  assert.equal((await run('build')).status, 0)
  const good = await files(join(dir, 'dist'))
  for (const source of [invalid, invalid.replaceAll('\r\n', '\n')]) {
    await writeFile(join(dir, 'effects/mist.frag'), source)
    for (const cmd of ['check', 'build']) {
      const r = await run(cmd)
      assert.notEqual(r.status, 0)
      assert.match(
        r.output,
        /effects\/mist\.frag:3:1 INVALID_DOCUMENT .*shader\.input/,
      )
    }
    const p = (await openProject(dir)).loaded.problems[0]!
    assert.deepEqual(
      [p.file, p.line, p.rule, p.shaderLine],
      ['effects/mist.frag', 3, 'shader.input', 3],
    )
    assert.deepEqual(await files(join(dir, 'dist')), good)
  }
})

for (const step of [1, 2, 3])
  for (const input of ['effects/mist.frag', 'effects/mist.json'])
    test(`an unedited ${input} changing at step ${step} refuses the batch before publication`, async () => {
      const dir = await copyFixture('site-basic')
      await gpuFolder(dir, true)
      const initial = await files(dir)
      const edit = '// external\r\n' + initial[input]
      const { registry } = await openProject(dir)
      const store = await fileStore(dir, registry, {
        after(n) {
          if (n === step) writeFileSync(join(dir, input), edit)
        },
      })
      const before = await store.head('site')
      assert.ok('doc' in before)
      const r = await apply(store, registry, {
        site: 'site',
        key: 'race',
        baseRevision: before.revision,
        ops: [{ ...define, effect: { ...mist, name: 'cloud' } }, attach],
      })
      assert.ok(!r.ok)
      assert.equal(r.problems[0].code, 'SOURCE_CONFLICT')
      assert.deepEqual(await files(dir), { ...initial, [input]: edit })
      assert.equal(await store.replay('site', 'race'), undefined)
    })

for (const step of [6, 8])
  test(`recovery at step ${step} reconciles descriptor, source and attachment together`, async () => {
    const dir = await copyFixture('site-basic')
    await gpuFolder(dir)
    const initial = await files(dir)
    const { registry } = await openProject(dir)
    const store = await fileStore(dir, registry, {
      after(n) {
        if (n === step) throw Error('interrupted')
      },
    })
    const before = await store.head('site')
    assert.ok('doc' in before)
    await assert.rejects(
      apply(store, registry, {
        site: 'site',
        key: 'atomic',
        baseRevision: before.revision,
        ops: [define, attach],
      }),
      /interrupted/,
    )
    const reopened = await fileStore(dir, registry)
    const after = await reopened.head('site')
    assert.ok('doc' in after)
    assert.equal(after.revision, before.revision + (step === 8 ? 1 : 0))
    if (step === 6) assert.deepEqual(await files(dir), initial)
    else {
      assert.deepEqual(after.doc.customEffects, [mist])
      assert.deepEqual(after.doc.pages[0]!.root.motion, attach.motion)
    }
  })

test('bad descriptor fields, missing, duplicate and escaped references are located and refused', async () => {
  const dir = await copyFixture('site-basic')
  await gpuFolder(dir, true)
  const site = join(dir, 'site.json'),
    desc = join(dir, 'effects/mist.json'),
    frag = join(dir, 'effects/mist.frag')
  const original = await readFile(site, 'utf8'),
    descriptor = await readFile(desc, 'utf8')
  for (const [from, to, key] of [
    ['mist.frag', '../mist.frag', 'sourceFile'],
    ['#abcdef', 'red', 'settings'],
    ['"settings"', '"reviewed":true, "settings"', 'reviewed'],
  ] as const) {
    const changed = descriptor.replace(from, to)
    await writeFile(desc, changed)
    const p = (await openProject(dir)).loaded.problems[0]
    assert.equal(p?.file, 'effects/mist.json')
    assert.equal(
      p?.line,
      changed.split('\n').findIndex(l => l.includes('"' + key + '"')) + 1,
    )
  }
  await writeFile(desc, descriptor)
  for (const refs of [
    ['effects/mist.json', 'effects/mist.json'],
    ['effects/absent.json'],
    ['../effects/mist.json'],
  ]) {
    await writeFile(
      site,
      original.replace('["effects/mist.json"]', JSON.stringify(refs)),
    )
    assert.equal((await openProject(dir)).loaded.problems[0]?.file, 'site.json')
  }
  await writeFile(site, original)
  await rm(frag)
  assert.equal(
    (await openProject(dir)).loaded.problems[0]?.file,
    'effects/mist.json',
  )
  const other = await copyFixture('site-basic')
  await symlink(join(other, 'site.json'), frag)
  assert.equal(
    (await openProject(dir)).loaded.problems[0]?.code,
    'POLICY_VIOLATION',
  )
})

test('oversized sidecars, invalid UTF-8 and deeply nested descriptors refuse even when unused', async () => {
  const dir = await copyFixture('site-basic')
  await gpuFolder(dir, true)
  const frag = join(dir, 'effects/mist.frag')
  for (const bytes of [Buffer.alloc(2 ** 20, 32), Buffer.from([0xff])]) {
    await writeFile(frag, bytes)
    const { loaded } = await openProject(dir)
    assert.ok(loaded.problems.length)
    assert.ok(!loaded.files.some(f => f.path === 'effects/mist.frag'))
  }
  await writeFile(frag, mist.source)
  await writeFile(
    join(dir, 'effects/mist.json'),
    '['.repeat(10000) + ']'.repeat(10000),
  )
  assert.equal(
    (await openProject(dir)).loaded.problems[0]?.file,
    'effects/mist.json',
  )
})

test('folder feature opt-in grants no host permissions, and effects/ is a protected output name', async () => {
  const dir = await copyFixture('site-basic')
  await gpuFolder(dir, true)
  const config = join(dir, 'culm.json')
  for (const features of [
    undefined,
    { gpu: false },
    { gpu: { enabled: true, reviewed: [mist] } },
  ]) {
    await writeFile(config, JSON.stringify({ features, reviewed: [mist] }))
    const p = await openProject(dir)
    assert.equal(p.registry.gpu, undefined)
    assert.ok(p.loaded.problems.some(p => p.code === 'UNSUPPORTED_CAPABILITY'))
  }
  await writeFile(
    config,
    JSON.stringify({
      features: { gpu: true },
      reviewed: [mist],
      approvedWasmPlugins: [{ name: 'self', version: 1 }],
    }),
  )
  const enabled = await openProject(dir)
  assert.deepEqual(enabled.loaded.problems, [])
  assert.equal(enabled.registry.gpu?.isReviewed(mist), false)
  assert.throws(() =>
    enabled.registry.use({
      name: 'self',
      version: 1,
      api: [1],
      runs: ['build'],
      trust: 'declarative',
      effects: [
        { ...mist, tier: 3, wasm: { abi: 'field-v1', bytesBase64: 'AA==' } },
      ],
    }),
  )
  await writeFile(config, '{"out":"effects/build","features":{"gpu":true}}')
  assert.ok(
    (await openProject(dir)).loaded.problems.some(
      p => p.file === 'culm.json' && p.code === 'POLICY_VIOLATION',
    ),
  )
})

test('only own JSON fields can enable GPU or supply a shader descriptor', async () => {
  const dir = await copyFixture('site-basic')
  await gpuFolder(dir, true)
  const config = join(dir, 'culm.json')
  for (const json of [
    '{"__proto__":{"features":{"gpu":true}}}',
    '{"features":{"__proto__":{"gpu":true}}}',
  ]) {
    await writeFile(config, json)
    assert.equal((await openProject(dir)).registry.gpu, undefined)
  }
  await writeFile(config, '{"features":{"gpu":true}}')
  const file = join(dir, 'effects/mist.json')
  await writeFile(
    file,
    '{"__proto__":{"name":"mist","settings":{},"sourceFile":"mist.frag"}}',
  )
  assert.equal(
    (await openProject(dir)).loaded.problems[0]?.file,
    'effects/mist.json',
  )
})

test('unlisted sidecar bytes and linked-out output directories cannot be overwritten on creation', async () => {
  for (const link of [false, true]) {
    const dir = await copyFixture('site-basic'),
      other = await copyFixture('site-basic')
    await gpuFolder(dir)
    const parent = join(dir, 'effects')
    if (link) await symlink(other, parent, 'dir')
    else await mkdir(parent)
    await writeFile(join(parent, 'mist.frag'), 'keep')
    const { registry } = await openProject(dir)
    const store = await fileStore(dir, registry)
    const before = await store.head('site')
    assert.ok('doc' in before)
    const r = await apply(store, registry, {
      site: 'site',
      key: 'collision',
      baseRevision: before.revision,
      ops: [define, attach],
    })
    assert.ok(!r.ok)
    assert.equal(r.problems[0].code, 'SOURCE_CONFLICT')
    assert.equal(await readFile(join(parent, 'mist.frag'), 'utf8'), 'keep')
    assert.equal(await store.replay('site', 'collision'), undefined)
    assert.deepEqual((await openProject(dir)).loaded.doc, before.doc)
  }
})

test('an edit already visible at the apply head is an outside revision, including descriptor comments and unused source', async () => {
  const dir = await copyFixture('site-basic')
  await gpuFolder(dir, true)
  const { registry } = await openProject(dir)
  const store = await fileStore(dir, registry)
  const h = await store.head('site')
  assert.ok('doc' in h)
  const first = await apply(store, registry, {
    site: 'site',
    baseRevision: h.revision,
    key: 'init',
    ops: [{ op: 'setSite', name: 'Project' }],
  })
  assert.ok(first.ok)
  const file = join(dir, 'effects/mist.json')
  const descriptor = '// personal note\r\n' + (await readFile(file, 'utf8'))
  await writeFile(file, descriptor)
  const source = mist.source + '\r\n'
  await writeFile(join(dir, 'effects/mist.frag'), source)
  const outside = await apply(store, registry, {
    site: 'site',
    baseRevision: first.revision,
    key: 'attach',
    ops: [attach],
  })
  assert.ok(!outside.ok)
  assert.equal(outside.problems[0].code, 'REVISION_CONFLICT')
  const rec = JSON.parse(
    await readFile(
      join(dir, `.culm/revisions/${first.revision + 1}.json`),
      'utf8',
    ),
  )
  assert.equal(rec.by, 'outside')
  assert.equal(
    await readFile(
      join(dir, '.culm/blobs', rec.files['effects/mist.json']),
      'utf8',
    ),
    descriptor,
  )
  assert.equal(
    (await store.get('site', first.revision + 1))?.customEffects?.[0]?.source,
    source,
  )
})
