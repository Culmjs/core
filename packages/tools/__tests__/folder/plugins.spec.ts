import test from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtempSync,
  mkdirSync,
  symlinkSync,
  writeFileSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadPlugins } from '../../src/folder/plugins.ts'

const fixture = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../fixtures/plugin-pkg',
)

// A temp project with plugin-pkg linked into its node_modules and any extra packages written there.
function project(extra: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'culm-plugins-'))
  mkdirSync(join(dir, 'node_modules'))
  symlinkSync(fixture, join(dir, 'node_modules/plugin-pkg'), 'dir')
  for (const [name, code] of Object.entries(extra)) {
    mkdirSync(join(dir, 'node_modules', name))
    writeFileSync(
      join(dir, 'node_modules', name, 'package.json'),
      `{"name":"${name}","type":"module","main":"index.js"}`,
    )
    writeFileSync(join(dir, 'node_modules', name, 'index.js'), code)
  }
  return dir
}
const files = (o: Record<string, string>) => new Map(Object.entries(o))
const block = {
  id: 'note',
  version: 1,
  name: 'Note',
  category: 'content',
  looks: [
    {
      id: 'a',
      name: 'A',
      tree: {
        id: 'r',
        kind: 'box',
        name: 'Box',
        slot: 'child',
        props: {},
        style: {},
        children: [],
      },
    },
  ],
  settings: [],
}

test('a package named in culm.json is imported from the project and its default export registered', async () => {
  const dir = project()
  try {
    const r = await loadPlugins(
      dir,
      files({ 'culm.json': '{ "plugins": ["plugin-pkg"] }' }),
    )
    assert.deepEqual(r.problems, [])
    assert.deepEqual(r.config, { plugins: ['plugin-pkg'], out: 'dist' })
    assert.ok(r.registry.plugins().some(p => p.name === 'plugin-pkg'))
  } finally {
    rmSync(dir, { recursive: true })
  }
})

test('blocks/*.json and data/*.json fields become the plug-in "local"; registry.plugins() lists it', async () => {
  const r = await loadPlugins(
    '/nowhere',
    files({
      'culm.json': '{}',
      'blocks/note.json': JSON.stringify(block),
      'data/menu.json':
        '{ "fields": { "name": "text" }, "rows": [{ "name": "Bread" }] }',
    }),
  )
  assert.deepEqual(r.problems, [])
  assert.deepEqual(r.registry.plugins(), [{ name: 'local', version: 1 }])
  assert.equal(r.registry.block('note')?.name, 'Note')
  assert.deepEqual(r.registry.source('menu')?.sample, [{ name: 'Bread' }])
})

test('a block file that names a function (onInsert, or a setting with fn) is refused with file and line', async () => {
  const r = await loadPlugins(
    '/nowhere',
    files({
      'culm.json': '{}',
      'blocks/a.json': '{\n  "id": "a",\n  // keep\n  "onInsert": "x"\n}',
      'blocks/b.json': `{ "id": "b",\n "settings": [\n {\n "fn": "f" } ] }`,
    }),
  )
  assert.equal(r.problems.length, 2)
  assert.ok(r.problems.every(p => p.code === 'POLICY_VIOLATION'))
  assert.deepEqual(
    r.problems.map(p => [p.file, p.line]),
    [
      ['blocks/a.json', 4],
      ['blocks/b.json', 4],
    ],
  )
  assert.equal(r.registry.block('a'), undefined)
})

test('a package that cannot be imported is a problem at the line of its name in culm.json', async () => {
  const dir = project()
  try {
    const r = await loadPlugins(
      dir,
      files({
        'culm.json': '{\n "plugins": [\n "plugin-pkg",\n "nope-pkg"\n ]\n}',
      }),
    )
    assert.equal(r.problems.length, 1)
    assert.equal(r.problems[0]!.file, 'culm.json')
    assert.equal(r.problems[0]!.line, 4)
    assert.ok(r.registry.plugins().some(p => p.name === 'plugin-pkg'))
  } finally {
    rmSync(dir, { recursive: true })
  }
})

test('a package whose default export is not a plug-in is a problem, and nothing of it is registered', async () => {
  const dir = project({
    notplug: 'export default { name: "x" }',
    throws:
      'export default { name: "t", version: 1, api: [1], runs: [], trust: "declarative", blocks: [{ id: "dup" }, { id: "dup" }] }',
  })
  try {
    const r = await loadPlugins(
      dir,
      files({ 'culm.json': '{ "plugins": ["notplug", "throws"] }' }),
    )
    assert.equal(r.problems.length, 2)
    assert.deepEqual(
      r.problems.map(p => p.line),
      [1, 1],
    )
    assert.deepEqual(r.registry.plugins(), [{ name: 'local', version: 1 }])
    assert.equal(r.registry.block('dup'), undefined)
  } finally {
    rmSync(dir, { recursive: true })
  }
})

test('out outside the project ("../x", an absolute path) is refused', async () => {
  for (const out of ['../x', '/tmp/x', '.', 'a/../../x']) {
    const r = await loadPlugins(
      '/proj',
      files({ 'culm.json': JSON.stringify({ out }) }),
    )
    assert.equal(r.problems.length, 1, out)
    assert.equal(r.problems[0]!.file, 'culm.json')
    assert.equal(r.config.out, 'dist')
  }
  const ok = await loadPlugins(
    '/proj',
    files({ 'culm.json': '{ "out": "build/site" }' }),
  )
  assert.equal(ok.config.out, 'build/site')
  assert.deepEqual(ok.problems, [])
})

test('a missing culm.json is one problem naming the file', async () => {
  const r = await loadPlugins('/proj', files({}))
  assert.equal(r.problems.length, 1)
  assert.equal(r.problems[0]!.file, 'culm.json')
})
