import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  emptySite,
  migrate,
  MigrationError,
  previewMigration,
  SCHEMA_VERSION,
  type MigrationStep,
} from '../../src/document/index.ts'
import { LOOK } from '../kit.ts'

const v = (n: number, more = {}) => ({ schemaVersion: n, name: 'x', ...more })
const steps: MigrationStep[] = [
  { from: 1, migrate: (d: object) => ({ ...d, schemaVersion: 2, a: true }) },
  { from: 2, migrate: (d: object) => ({ ...d, schemaVersion: 3, b: true }) },
]

test('a current document comes back equal and is a different object', () => {
  const d = emptySite('x', LOOK)
  const r = migrate(d)
  assert.ok(r.ok)
  assert.deepEqual(r.doc, d)
  assert.notEqual(r.doc, d)
  assert.equal(r.from, 1)
})

test("steps run in order from the document's version to the target", () => {
  const r = migrate(v(1), steps, 3)
  assert.ok(r.ok)
  assert.deepEqual(r.doc, { schemaVersion: 3, name: 'x', a: true, b: true })
  assert.equal(r.from, 1)
})

test('the input is never changed, even by a step that writes to its argument', () => {
  const mutating: MigrationStep[] = [
    {
      from: 1,
      migrate: (d: unknown) => {
        const o = d as Record<string, unknown>
        o.a = true
        o.schemaVersion = 2
        return o
      },
    },
  ]
  const d = v(1)
  const r = migrate(d, mutating, 2)
  assert.ok(r.ok)
  assert.deepEqual(d, v(1))
  assert.ok(migrate(Object.freeze(v(1)), mutating, 2).ok)
})

test('a document that cannot be copied is refused, not thrown', () => {
  const r = migrate(v(1, { f: () => 1 }))
  assert.ok(!r.ok)
  assert.equal(r.problem.code, 'INVALID_DOCUMENT')
})

test('a step that returns a non-object or the wrong version is refused', () => {
  for (const out of [null, 5, { schemaVersion: 1 }, { schemaVersion: 3 }]) {
    const r = migrate(v(1), [{ from: 1, migrate: () => out }], 2)
    assert.ok(!r.ok)
    assert.equal(r.problem.code, 'INVALID_DOCUMENT')
    assert.match(r.problem.message, /version 1/)
  }
})

test('a thrown non-Error keeps its message', () => {
  const r = migrate(
    v(1),
    [
      {
        from: 1,
        migrate: () => {
          throw 'oops'
        },
      },
    ],
    2,
  )
  assert.ok(!r.ok)
  assert.match(r.problem.message, /oops/)
})

test('a newer document is refused', () => {
  const r = migrate(v(9))
  assert.ok(!r.ok)
  assert.equal(r.problem.code, 'INVALID_DOCUMENT')
  assert.match(r.problem.message, /newer/)
})

test('a missing or non-integer version, or a non-object, is refused', () => {
  for (const d of [null, 3, 'x', {}, v(1.5), v(0)]) {
    const r = migrate(d)
    assert.ok(!r.ok)
    assert.equal(r.problem.code, 'INVALID_DOCUMENT')
  }
})

test('a missing step is refused and names the version it stopped at', () => {
  const r = migrate(v(1), [steps[1]], 3)
  assert.ok(!r.ok)
  assert.match(r.problem.message, /1/)
})

test("a step that cannot migrate a node reports that node's path", () => {
  const bad: MigrationStep[] = [
    {
      from: 1,
      migrate: () => {
        throw new MigrationError('pages.0.root.children.2', 'no such kind')
      },
    },
  ]
  const r = migrate(v(1), bad, 2)
  assert.ok(!r.ok)
  assert.equal(r.problem.path, 'pages.0.root.children.2')
})

test('any other throw from a step becomes a problem with an empty path', () => {
  const bad: MigrationStep[] = [
    {
      from: 1,
      migrate: () => {
        throw new Error('boom')
      },
    },
  ]
  const r = migrate(v(1), bad, 2)
  assert.ok(!r.ok)
  assert.equal(r.problem.code, 'INVALID_DOCUMENT')
  assert.equal(r.problem.path, '')
})

test('previewMigration is migrate, and emptySite uses SCHEMA_VERSION', () => {
  assert.equal(previewMigration, migrate)
  assert.equal(emptySite('x', LOOK).schemaVersion, SCHEMA_VERSION)
})

test('a document whose schemaVersion throws, or a step that throws a bare object, is a problem and not a throw', () => {
  const trap = {
    get schemaVersion(): number {
      throw new Error('boom')
    },
  }
  const r = migrate(trap)
  assert.equal(r.ok, false)
  const bare = migrate(
    v(1),
    [
      {
        from: 1,
        migrate: () => {
          throw Object.create(null)
        },
      },
    ],
    2,
  )
  assert.equal(bare.ok, false)
})
