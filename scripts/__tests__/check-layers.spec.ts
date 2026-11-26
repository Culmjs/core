import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LAYERS, layerViolations, readFiles } from '../check-layers.ts'

test('a lower layer importing a higher one is a violation', () => {
  const v = layerViolations([
    {
      path: 'document/tree.ts',
      source: `import { x } from "../compile/page.ts";`,
    },
  ])
  assert.deepEqual(v, ['document/tree.ts imports compile (../compile/page.ts)'])
})
test('importing the same or a lower layer is allowed, type imports included', () => {
  assert.deepEqual(
    layerViolations([
      {
        path: 'compile/page.ts',
        source: `import type { Node } from "../document/types.ts";\nimport { a } from "./html.ts";`,
      },
    ]),
    [],
  )
})
test('a type-only import of a higher layer is still a violation', () => {
  assert.equal(
    layerViolations([
      {
        path: 'registry/rule.ts',
        source: `import type { P } from "../validate/problems.ts";`,
      },
    ]).length,
    1,
  )
})
test('a file outside the known layers is a violation', () => {
  assert.equal(layerViolations([{ path: 'misc/x.ts', source: '' }]).length, 1)
})
test('the root index is exempt', () => {
  assert.deepEqual(
    layerViolations([
      { path: 'index.ts', source: `export * from "./compile/index.ts";` },
    ]),
    [],
  )
})
test('the order is fixed', () => {
  assert.deepEqual(LAYERS, [
    'scripts',
    'document',
    'style',
    'layout',
    'registry',
    'validate',
    'data',
    'compile',
    'ops',
    'measure',
  ])
})
test('importing the root index or a path that leaves src is a violation', () => {
  for (const spec of [
    '../index.ts',
    '../../__tests__/kit.ts',
    '../../../../node_modules/foo/index.js',
  ]) {
    assert.equal(
      layerViolations([
        { path: 'document/x.ts', source: `import { a } from "${spec}";` },
      ]).length,
      1,
      spec,
    )
  }
})

test('a side-effect import, a dynamic import and an import type of a higher layer are violations', () => {
  const bad = (source: string) =>
    layerViolations([{ path: 'document/x.ts', source }])
  for (const source of [
    `import '../compile/page.ts'`,
    `import"../compile/page.ts"`,
    `await import('../compile/page.ts')`,
    `const m = await import( "../compile/page.ts" )`,
    `type T = import('../compile/page.ts').X`,
    `export type T = import("../compile/page.ts").X<string>`,
    'await import(`../compile/page.ts`)',
  ])
    assert.deepEqual(
      bad(source),
      ['document/x.ts imports compile (../compile/page.ts)'],
      source,
    )
})

test('the same forms into the same or a lower layer, and a package, are allowed', () => {
  const ok = (source: string) =>
    layerViolations([{ path: 'compile/x.ts', source }])
  for (const source of [
    `import './html.ts'`,
    `await import('../document/tree.ts')`,
    `type T = import('../style/index.ts').X`,
    `import 'node:fs'`,
    `const m = await import('node:fs')`,
  ])
    assert.deepEqual(ok(source), [], source)
})

test('readFiles returns every file under the root whatever its extension', () => {
  const dir = mkdtempSync(join(tmpdir(), 'layers-'))
  try {
    mkdirSync(join(dir, 'document'))
    writeFileSync(join(dir, 'document', 'a.ts'), 'a')
    writeFileSync(join(dir, 'document', 'b.mts'), 'b')
    writeFileSync(join(dir, 'document', 'c.js'), 'c')
    writeFileSync(join(dir, 'index.ts'), 'd')
    assert.deepEqual(
      readFiles(dir)
        .map(f => f.path)
        .sort(),
      ['document/a.ts', 'document/b.mts', 'document/c.js', 'index.ts'],
    )
  } finally {
    rmSync(dir, { recursive: true })
  }
})

test('compile may not import ops', () => {
  assert.deepEqual(
    layerViolations([
      { path: 'compile/x.ts', source: `import { plan } from '../ops/plan.ts'` },
    ]),
    ['compile/x.ts imports ops (../ops/plan.ts)'],
  )
})

test('the layers below compile may be imported by it, and ops may import compile and everything below', () => {
  const ok = (path: string, source: string) =>
    layerViolations([{ path, source }])
  assert.deepEqual(ok('ops/x.ts', `import { c } from '../compile/page.ts'`), [])
  assert.deepEqual(ok('measure/x.ts', `import { p } from '../ops/plan.ts'`), [])
  assert.deepEqual(ok('ops/x.ts', `import { p } from './plan.ts'`), [])
  assert.deepEqual(
    ok('compile/x.ts', `import { d } from '../data/rows.ts'`),
    [],
  )
})

test('ops importing measure, and compile importing measure, are violations', () => {
  for (const path of ['ops/x.ts', 'compile/x.ts'])
    assert.deepEqual(
      layerViolations([
        { path, source: `import { m } from '../measure/m.ts'` },
      ]),
      [`${path} imports measure (../measure/m.ts)`],
    )
})

test('semicolons in comments inside multiline imports and triple-slash references are caught', () => {
  assert.deepEqual(
    layerViolations([
      {
        path: 'document/x.ts',
        source: `import {\n  runChecks, // note; see measure\n} from '../measure/index.ts'`,
      },
    ]),
    ['document/x.ts imports measure (../measure/index.ts)'],
  )
  assert.deepEqual(
    layerViolations([
      {
        path: 'document/x.ts',
        source: `/// <reference path="../measure/index.ts" />\n`,
      },
    ]),
    ['document/x.ts imports measure (../measure/index.ts)'],
  )
})
