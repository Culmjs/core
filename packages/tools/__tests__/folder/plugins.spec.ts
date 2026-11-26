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

const fixtureEsm = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../fixtures/plugin-esm-pkg',
)
const fixture = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../fixtures/plugin-pkg',
)

// A temp project with plugin-pkg linked into its node_modules and any extra packages written there.
function project(extra: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'culm-plugins-'))
  mkdirSync(join(dir, 'node_modules'))
  symlinkSync(fixture, join(dir, 'node_modules/plugin-pkg'), 'dir')
  symlinkSync(fixtureEsm, join(dir, 'node_modules/plugin-esm-pkg'), 'dir')
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
        slot: {},
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
  const fns = r.problems.filter(p => p.code === 'POLICY_VIOLATION')
  assert.equal(fns.length, 2)
  assert.deepEqual(
    fns.map(p => [p.file, p.line]),
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

test('a package whose import throws is a problem at its line', async () => {
  const dir = project({ boom: 'throw new Error("boom")' })
  try {
    const r = await loadPlugins(
      dir,
      files({ 'culm.json': '{ "plugins": ["boom"] }' }),
    )
    assert.equal(r.problems.length, 1)
    assert.match(r.problems[0]!.message, /boom/)
    assert.equal(r.problems[0]!.line, 1)
  } finally {
    rmSync(dir, { recursive: true })
  }
})

test('only bare package names load; a path or an absolute path is a problem at its line', async () => {
  const dir = project()
  try {
    writeFileSync(
      join(dir, 'outside.js'),
      'globalThis.__ran = true; export default {}',
    )
    const r = await loadPlugins(
      dir,
      files({
        'culm.json':
          '{\n "plugins": [\n "../outside.js",\n "' +
          join(dir, 'outside.js') +
          '",\n "./outside.js"\n ]\n}',
      }),
    )
    assert.deepEqual(
      r.problems.map(p => p.line),
      [3, 4, 5],
    )
    assert.equal((globalThis as { __ran?: boolean }).__ran, undefined)
  } finally {
    rmSync(dir, { recursive: true })
  }
})

test('a package is looked up in the project only, never in a parent folder', async () => {
  const dir = project()
  try {
    mkdirSync(join(dir, 'sub'))
    const r = await loadPlugins(
      join(dir, 'sub'),
      files({ 'culm.json': '{ "plugins": ["plugin-pkg"] }' }),
    )
    assert.equal(r.problems.length, 1)
    assert.match(r.problems[0]!.message, /not installed in node_modules/)
  } finally {
    rmSync(dir, { recursive: true })
  }
})

test('a package with an import-only exports map loads', async () => {
  const dir = project()
  try {
    const r = await loadPlugins(
      dir,
      files({ 'culm.json': '{ "plugins": ["plugin-esm-pkg"] }' }),
    )
    assert.deepEqual(r.problems, [])
    assert.ok(r.registry.plugins().some(p => p.name === 'plugin-esm-pkg'))
  } finally {
    rmSync(dir, { recursive: true })
  }
})

test('a package with no usable entry is a problem', async () => {
  const dir = project()
  try {
    mkdirSync(join(dir, 'node_modules/noentry'))
    writeFileSync(
      join(dir, 'node_modules/noentry/package.json'),
      '{ "exports": { "require": "./x.cjs" } }',
    )
    const r = await loadPlugins(
      dir,
      files({ 'culm.json': '{ "plugins": ["noentry"] }' }),
    )
    assert.match(r.problems[0]!.message, /no entry for import/)
  } finally {
    rmSync(dir, { recursive: true })
  }
})

test('block files are checked: shape, tree, duplicates; a bad file is skipped alone', async () => {
  const bad = (o: object) => JSON.stringify({ ...block, ...o })
  const r = await loadPlugins(
    '/nowhere',
    files({
      'culm.json': '{}',
      'blocks/a-noid.json': '{\n "name": "noid"\n}',
      'blocks/b-looks.json': bad({ id: 'looks', looks: 'bad' }),
      'blocks/c-kind.json': bad({
        id: 'kind',
        looks: [
          {
            id: 'a',
            name: 'A',
            tree: { id: 'r', kind: 'nonsense', name: 'X', slot: {} },
          },
        ],
      }),
      'blocks/d-one.json': bad({ id: 'same' }),
      'blocks/e-two.json': bad({ id: 'same' }),
      'blocks/f-good.json': bad({ id: 'good' }),
    }),
  )
  const by = (f: string) => r.problems.filter(p => p.file === f)
  assert.ok(
    by('blocks/a-noid.json').length >= 1 &&
      by('blocks/a-noid.json').every(p => p.line !== undefined || p.message),
  )
  assert.equal(by('blocks/b-looks.json')[0]!.line, 1)
  assert.equal(by('blocks/c-kind.json')[0]!.code, 'UNKNOWN_KIND')
  assert.equal(by('blocks/e-two.json').length, 1)
  assert.match(by('blocks/e-two.json')[0]!.message, /d-one\.json/)
  assert.deepEqual(
    r.registry
      .blocks()
      .map(b => b.id)
      .sort(),
    ['good', 'same'],
  )
})

test('data files are checked: unknown field types; rows are left to the loader', async () => {
  const r = await loadPlugins(
    '/nowhere',
    files({
      'culm.json': '{}',
      'data/a.json': '{ "fields": { "n": "text" }, "rows": [{ "n": 1 }] }',
      'data/b.json': '{\n "fields": {\n "n": "texte" }\n}',
      'data/c.json': '{ "fields": { "n": "text" }, "rows": [{ "n": "ok" }] }',
    }),
  )
  assert.deepEqual(
    r.problems.map(p => p.file),
    ['data/b.json'],
  )
  assert.equal(r.problems[0]!.line, 3)
  // a source with bad rows is still declared, without them
  assert.deepEqual(
    r.registry.sources().map(s => [s.name, s.sample.length]),
    [
      ['a', 0],
      ['c', 1],
    ],
  )
})

test('a file with several syntax errors is one problem', async () => {
  const r = await loadPlugins(
    '/nowhere',
    files({
      'culm.json': '{ "plugins": [ , , ] , }}}',
      'data/a.json': '{ "fields": ] ] ] }',
    }),
  )
  assert.deepEqual(r.problems.map(p => p.file).sort(), [
    'culm.json',
    'data/a.json',
  ])
})

test('out naming a source folder is refused', async () => {
  for (const out of ['blocks', 'data/x', 'node_modules', '.culm', 'pages']) {
    const r = await loadPlugins(
      '/proj',
      files({ 'culm.json': JSON.stringify({ out }) }),
    )
    assert.equal(r.problems.length, 1, out)
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

test('a block or data file with a JSON syntax error is skipped, not registered', async () => {
  const r = await loadPlugins(
    '/nowhere',
    files({
      'culm.json': '{}',
      // a trailing garbage token: the parser still recovers the whole object
      'blocks/note.json': JSON.stringify(block).slice(0, -1) + ', }}',
      'data/menu.json':
        '{ "fields": { "name": "text" }, "rows": [{ "name": "Bread" }] ]',
    }),
  )
  assert.ok(r.problems.some(p => p.file === 'blocks/note.json'))
  assert.ok(r.problems.some(p => p.file === 'data/menu.json'))
  assert.equal(r.registry.block('note'), undefined)
  assert.equal(r.registry.source('menu'), undefined)
})

test('"." and ".." are refused as a part of a scoped package name', async () => {
  const r = await loadPlugins(
    '/nowhere',
    files({ 'culm.json': '{ "plugins": ["@scope/..", "@scope/.", "@../x"] }' }),
  )
  assert.equal(r.problems.length, 3)
  for (const p of r.problems) assert.match(p.message, /not a package name/)
})

for (const [name, setting, line] of [
  ['null', 'null', 'settings'],
  ['a number', '1', 'settings'],
  ['no key', '{ "label": "L", "type": "text", "actions": [] }', 'key'],
  [
    'an unknown type',
    '{ "key": "k", "label": "L", "type": "fancy", "actions": [] }',
    'type',
  ],
  [
    'a select with no options',
    '{ "key": "k", "label": "L", "type": "select", "actions": [] }',
    'options',
  ],
  ['no actions', '{ "key": "k", "label": "L", "type": "text" }', 'actions'],
] as const)
  test(`a block setting of ${name} is a located problem and the file is skipped alone`, async () => {
    const r = await loadPlugins(
      '/nowhere',
      files({
        'culm.json': '{}',
        'blocks/note.json': JSON.stringify(block),
        'blocks/bad.json': `{\n"id": "bad", "version": 1, "name": "B", "category": "c",\n"looks": ${JSON.stringify(block.looks)},\n"settings": [\n${setting}\n]\n}`,
      }),
    )
    const mine = r.problems.filter(p => p.file === 'blocks/bad.json')
    assert.equal(mine.length, 1, JSON.stringify(r.problems))
    assert.equal(mine[0]!.code, 'INVALID_DOCUMENT')
    assert.equal(mine[0]!.line, 5)
    assert.match(
      mine[0]!.message,
      new RegExp(line === 'settings' ? 'setting' : line),
    )
    assert.equal(r.registry.block('bad'), undefined)
    assert.ok(r.registry.block('note'))
  })

for (const [name, action] of [
  ['null', 'null'],
  ['a set with no path', '{ "do": "set" }'],
  ['a filter with no list', '{ "do": "filter" }'],
  ['a choose with no options', '{ "do": "choose" }'],
  ['a show with no nodes', '{ "do": "show" }'],
  ['an unknown do', '{ "do": "fly" }'],
] as const)
  test(`a setting action that is ${name} is a located problem and the file is skipped alone`, async () => {
    const r = await loadPlugins(
      '/nowhere',
      files({
        'culm.json': '{}',
        'blocks/note.json': JSON.stringify(block),
        'blocks/bad.json': `{\n"id": "bad", "version": 1, "name": "B", "category": "c",\n"looks": ${JSON.stringify(block.looks)},\n"settings": [\n{ "key": "k", "label": "L", "type": "text", "actions": [${action}] }\n]\n}`,
      }),
    )
    const mine = r.problems.filter(p => p.file === 'blocks/bad.json')
    assert.equal(mine.length, 1, JSON.stringify(r.problems))
    assert.equal(mine[0]!.code, 'INVALID_DOCUMENT')
    assert.equal(mine[0]!.line, 5)
    assert.match(mine[0]!.message, /action/)
    assert.equal(r.registry.block('bad'), undefined)
    assert.ok(r.registry.block('note'))
  })

for (const [endpoint, ok] of [
  ['http://example.com/x', false],
  ['https://example.com/x', true],
  ['http://127.0.0.1:8080/x', true],
  ['http://localhost:8080/x', true],
  ['http://[::1]:8080/x', true],
  ['http://localhost', true],
  ['http://localhost:@evil.com/x', false],
  ['http://localhost:8080@evil.com/x', false],
  ['http://127.0.0.1:x@evil.com/x', false],
  ['http://[::1]:1@evil.com/', false],
] as const)
  test(`images.endpoint ${endpoint} is ${ok ? 'accepted' : 'refused'}`, async () => {
    const r = await loadPlugins(
      '/nowhere',
      files({ 'culm.json': JSON.stringify({ images: { endpoint } }) }),
    )
    const mine = r.problems.filter(p => p.file === 'culm.json')
    if (ok) assert.equal(mine.length, 0, JSON.stringify(mine))
    else {
      assert.equal(mine.length, 1)
      assert.equal(mine[0]!.code, 'INVALID_DOCUMENT')
      assert.equal(
        mine[0]!.message,
        '"images.endpoint" must be an https:// URL (http:// only for this machine).',
      )
    }
  })
